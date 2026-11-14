/**
 * pipeline-gate.mjs — the batch runner's cost gates, for web runs.
 *
 * batch-runner.sh never starts a full evaluation on a posting until two cheaper
 * checks have passed: prescreen.mjs (rules, zero tokens) and a triage pass on
 * the economy model (modes/triage.md + modes/_brief.md + the JD, no tools).
 * The dashboard skipped both and ran every shortlisted posting through the
 * full evaluation on the CLI's default model, whatever config/profile.yml's
 * spend_tier and pipeline block said.
 *
 * Everything here is dependency-injected and free of fs/child_process, so it is
 * testable as values. The route supplies the three effects: run a core script,
 * write a scratch file, call the economy model.
 *
 * A broken gate must never cost a real job (modes/batch.md): every failure of
 * the gate itself, a crash, an unreadable config, an empty model answer, reads
 * as "continue" and the full evaluation runs.
 */

/** Tier -> Claude model. Keep in sync with spend_tier_to_model in batch/batch-runner.sh. */
export const TIER_MODELS = Object.freeze({
  economy: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  premium: "claude-opus-5-5",
});

/** `prescreen.mjs --config` prints KEY=value lines. */
export function parseConfigLines(stdout) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * @typedef {"low"|"medium"|"high"|"xhigh"|"max"} Effort
 * @typedef {{model: string|null, effort: string|null, triageModel: string|null, triageEffort: string|null}} CodexSettings
 * @typedef {{spendTier: "economy"|"standard"|"premium", parallel: number|null, triage: "auto"|"on"|"off", triageReady: boolean, triageEffort: Effort|null, effort: Effort|null, codex: CodexSettings}} PipelineSettings
 */

/** Claude Code's --effort levels (prescreen.mjs EFFORT_LEVELS). */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** @returns {Effort|null} */
const effortFrom = (value) => (EFFORTS.includes(value) ? /** @type {Effort} */ (value) : null);
/** Codex's model_reasoning_effort values (prescreen.mjs CODEX_EFFORT_LEVELS). */
const CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const codexEffortFrom = (value) => (CODEX_EFFORTS.includes(value) ? value : null);
/** Same slug rule as prescreen.mjs: a value that could be read as a flag or config never reaches argv. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const modelFrom = (value) => (typeof value === "string" && MODEL_ID.test(value) ? value : null);

/** @returns {PipelineSettings} */
export function pipelineSettings(stdout) {
  const raw = parseConfigLines(stdout);
  const tier = raw.SPEND_TIER;
  const parallel = Number(raw.PARALLEL);
  return {
    spendTier: tier === "economy" || tier === "premium" ? tier : "standard",
    parallel: Number.isInteger(parallel) && parallel >= 1 ? parallel : null,
    triage: raw.TRIAGE === "on" || raw.TRIAGE === "off" ? raw.TRIAGE : "auto",
    triageReady: raw.TRIAGE_READY === "1",
    triageEffort: effortFrom(raw.TRIAGE_EFFORT),
    effort: effortFrom(raw.EFFORT),
    codex: {
      model: modelFrom(raw.CODEX_MODEL),
      effort: codexEffortFrom(raw.CODEX_EFFORT),
      triageModel: modelFrom(raw.CODEX_TRIAGE_MODEL),
      triageEffort: codexEffortFrom(raw.CODEX_TRIAGE_EFFORT),
    },
  };
}

/**
 * The model a run uses. spend_tier names Claude models, so it applies to the
 * claude CLI; codex reads pipeline.codex.model. Null = the CLI's own default.
 */
export function modelForRun(cliId, settings) {
  if (!settings) return null;
  if (cliId === "claude") return TIER_MODELS[settings.spendTier];
  if (cliId === "codex") return settings.codex?.model ?? null;
  return null;
}

/** The reasoning effort for the same runs modelForRun picks a model for. Null = the CLI's default. */
export function effortForRun(cliId, settings) {
  if (!settings) return null;
  if (cliId === "claude") return settings.effort;
  if (cliId === "codex") return settings.codex?.effort ?? null;
  return null;
}

/** The triage pass's model and effort on this CLI, or null when it has none. */
export function triageModelFor(cliId, settings) {
  if (!settings) return null;
  if (cliId === "claude") return { model: TIER_MODELS.economy, effort: settings.triageEffort ?? null };
  if (cliId === "codex" && settings.codex?.triageModel) return { model: settings.codex.triageModel, effort: settings.codex.triageEffort ?? null };
  return null;
}

/** Same decision as resolve_triage in batch-runner.sh, extended to codex. */
export function triageEnabled(cliId, settings) {
  if (!settings || settings.triage === "off" || !settings.triageReady || !triageModelFor(cliId, settings)) return false;
  if (settings.triage === "on") return true;
  // The full evaluation already runs on the triage model: a first pass saves nothing.
  if (cliId === "claude") return settings.spendTier !== "economy";
  return settings.codex.triageModel !== settings.codex.model;
}

/**
 * What the inbox Filter can do on this CLI. Pressing Filter asks for triage, so
 * it runs even where `auto` would leave it off (the economy tier, or a codex
 * triage model equal to the evaluation model); `off` and an unfilled brief
 * still stop it. Without triage the Filter runs the free rules alone.
 *
 * @param {string} cliId
 * @param {PipelineSettings|null} settings
 * @returns {{triage: boolean, model: string|null, effort: string|null, reason: string|null, settings: PipelineSettings|null}}
 */
export function filterPlan(cliId, settings) {
  const none = (reason) => ({ triage: false, model: null, effort: null, reason, settings });
  if (!settings) return none("config/profile.yml could not be read, so only the free rules run.");
  if (settings.triage === "off") return none("Triage is off (pipeline.triage: off in config/profile.yml), so only the free rules run.");
  if (!settings.triageReady) return none("modes/_brief.md is not filled in, so triage would score against placeholders. Only the free rules run.");
  const model = triageModelFor(cliId, settings);
  if (!model) {
    return none(cliId === "codex"
      ? "No codex triage model is set (pipeline.codex.triage_model), so only the free rules run."
      : `Triage is not available on ${cliId}, so only the free rules run.`);
  }
  return { triage: true, model: model.model, effort: model.effort, reason: null, settings: { ...settings, triage: "on" } };
}

/**
 * The triage prompt as `{user, systemFile}`. The split form (prescreen.mjs
 * --triage-system-file / --triage-user) needs a real .md path back; anything
 * else falls back to the single-message prompt with no system file.
 * @returns {Promise<{user: string, systemFile: string|null} | null>}
 */
export async function triagePrompt(runCore, inputFile, jdFile) {
  try {
    const system = await runCore("prescreen", ["--triage-system-file", "--input", inputFile]);
    const systemFile = system.code === 0 ? system.stdout.trim() : "";
    if (/^(?:[A-Za-z]:)?[\\/].+\.md$/.test(systemFile) && !/[\r\n]/.test(systemFile)) {
      const user = await runCore("prescreen", ["--triage-user", "--input", inputFile, "--jd-file", jdFile]);
      if (user.code === 0 && user.stdout.trim()) return { user: user.stdout, systemFile };
    }
  } catch { /* fall back below */ }
  const built = await runCore("prescreen", ["--triage-prompt", "--input", inputFile, "--jd-file", jdFile]);
  return built.code === 0 && built.stdout.trim() ? { user: built.stdout, systemFile: null } : null;
}

/** Last `TRIAGE: VERDICT | company | role | N/5 | reason` line. Mirrors parseTriageOutput in prescreen.mjs. */
export function parseTriage(output) {
  const lines = String(output ?? "").replace(/\r/g, "").split("\n")
    .map((l) => l.replace(/^[\s`*>]+|[\s`*]+$/g, ""))
    .filter((l) => /^TRIAGE:\s*(PASS|MARGINAL|FAIL|SKIP)\b/i.test(l));
  const line = lines.at(-1);
  if (!line) return null;
  const cells = line.replace(/^TRIAGE:\s*/i, "").split("|").map((c) => c.trim());
  const score = cells[3]?.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  return { verdict: cells[0].toUpperCase(), score: score ? Number(score[1]) : null, reason: cells.slice(4).join(" | ") };
}

const clip = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 600);

/**
 * `triage` is the verdict the triage model gave, when it ran; the inbox Filter
 * keeps it (inbox-triage-store.mjs) so a posting is not triaged twice.
 *
 * @typedef {{verdict: string, score: number|null, reason: string, model: string}} TriageVerdict
 * @typedef {{skip: false, notes: string[], triage?: TriageVerdict|null} | {skip: true, stage: "prescreen"|"triage", reason: string, notes: string[], triage?: TriageVerdict|null}} GateResult
 *
 * @param {object} deps
 * @param {string} deps.url
 * @param {string|null} deps.jdText the prefetched JD, or null when the worker will fetch it
 * @param {string} deps.cliId
 * @param {PipelineSettings|null} deps.settings
 * @param {string} deps.discardLog absolute path of data/discard.log
 * @param {(script: string, args: string[]) => Promise<{code: number, stdout: string, timedOut?: boolean, spawnFailed?: boolean}>} deps.runCore
 * @param {(name: string, text: string) => string} deps.writeScratch writes a scratch file, returns its path
 * @param {(prompt: string, model: string, effort: string|null, systemFile?: string|null) => Promise<string>} deps.runTriage cheap-model call on deps.cliId; resolves to its answer
 * @param {{score: number|null, model: string|null}|null} [deps.priorPass] a recent PASS for this posting: triage is not run again
 * @returns {Promise<GateResult>}
 */
export async function runPipelineGate({ url, jdText, cliId, settings, discardLog, runCore, writeScratch, runTriage, priorPass = null }) {
  /** @type {string[]} */
  const notes = [];
  let jdFile = null;
  try {
    const inputFile = writeScratch("input.json", JSON.stringify({ url }));
    if (jdText) jdFile = writeScratch("jd.txt", jdText);

    // Stage 1: rules. Exit 2 is a skip, 0 continues, anything else is a broken gate.
    const args = ["--input", inputFile, "--log", discardLog, "--json", ...(jdFile ? ["--jd-file", jdFile] : [])];
    const pre = await runCore("prescreen", args);
    if (pre.code === 2) {
      let reason = "";
      try { reason = JSON.parse(pre.stdout).reason; } catch { /* fall through */ }
      return { skip: true, stage: "prescreen", reason: clip(reason) || "Skipped by your pre-screen rules.", notes };
    }
    if (pre.code !== 0) notes.push("Pre-screen could not run; continuing to the evaluation.");
    else notes.push("Pre-screen passed (blacklist, vetoed titles, years of experience).");

    // Stage 2: triage on the cheap model. Needs the JD in hand: it has no tools.
    if (!triageEnabled(cliId, settings)) return { skip: false, notes };
    if (priorPass) {
      notes.push(`Triage passed earlier${priorPass.score === null ? "" : ` (${priorPass.score}/5)`}; not run again.`);
      return { skip: false, notes };
    }
    const triageModel = /** @type {{model: string, effort: string|null}} */ (triageModelFor(cliId, settings));
    if (!jdFile) {
      notes.push("Triage skipped: the posting text was not available before the run.");
      return { skip: false, notes };
    }
    // Split prompt first: the posting-independent half as a system-prompt file
    // (a cached prefix shared by every triage), the JD as the message. An older
    // core without the split flags falls back to the one-message prompt.
    const prompt = await triagePrompt(runCore, inputFile, jdFile);
    if (!prompt) {
      notes.push("Triage prompt could not be built; continuing to the evaluation.");
      return { skip: false, notes };
    }
    const triage = parseTriage(await runTriage(prompt.user, triageModel.model, triageModel.effort, prompt.systemFile));
    if (!triage) {
      notes.push("Triage gave no verdict; continuing to the evaluation.");
      return { skip: false, notes };
    }
    const score = triage.score === null ? "" : ` ${triage.score}/5`;
    notes.push(`Triage model: ${triageModel.model}${triageModel.effort ? `, effort: ${triageModel.effort}` : ""}`);
    const verdict = { verdict: triage.verdict, score: triage.score, reason: clip(triage.reason), model: triageModel.model };
    if (triage.verdict === "FAIL" || triage.verdict === "MARGINAL") {
      return { skip: true, stage: "triage", reason: clip(`triage ${triage.verdict}${score}: ${triage.reason}`), notes, triage: verdict };
    }
    notes.push(`Triage ${triage.verdict}${score}.`);
    return { skip: false, notes, triage: verdict };
  } catch {
    notes.push("The cost gate failed; continuing to the evaluation.");
    return { skip: false, notes };
  }
}
