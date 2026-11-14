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
 * @typedef {{spendTier: "economy"|"standard"|"premium", parallel: number|null, triage: "auto"|"on"|"off", triageReady: boolean, triageEffort: Effort|null, effort: Effort|null}} PipelineSettings
 */

/** Claude Code's --effort levels (prescreen.mjs EFFORT_LEVELS). */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** @returns {Effort|null} */
const effortFrom = (value) => (EFFORTS.includes(value) ? /** @type {Effort} */ (value) : null);

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
  };
}

/** spend_tier names Claude models, so it only applies to the claude CLI. */
export function modelForRun(cliId, settings) {
  return cliId === "claude" && settings ? TIER_MODELS[settings.spendTier] : null;
}

/** pipeline.effort, for the same runs modelForRun picks a model for. Null = the CLI's default. */
export function effortForRun(cliId, settings) {
  return cliId === "claude" && settings ? settings.effort : null;
}

/** Same decision as resolve_triage in batch-runner.sh. */
export function triageEnabled(cliId, settings) {
  if (cliId !== "claude" || !settings || settings.triage === "off" || !settings.triageReady) return false;
  // At the economy tier the full evaluation already runs on that model.
  return settings.triage === "on" || settings.spendTier !== "economy";
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
 * @typedef {{skip: false, notes: string[]} | {skip: true, stage: "prescreen"|"triage", reason: string, notes: string[]}} GateResult
 *
 * @param {object} deps
 * @param {string} deps.url
 * @param {string|null} deps.jdText the prefetched JD, or null when the worker will fetch it
 * @param {string} deps.cliId
 * @param {PipelineSettings|null} deps.settings
 * @param {string} deps.discardLog absolute path of data/discard.log
 * @param {(script: string, args: string[]) => Promise<{code: number, stdout: string, timedOut?: boolean, spawnFailed?: boolean}>} deps.runCore
 * @param {(name: string, text: string) => string} deps.writeScratch writes a scratch file, returns its path
 * @param {(prompt: string, model: string, effort: Effort|null, systemFile?: string|null) => Promise<string>} deps.runTriage economy-model call; resolves to its stdout
 * @returns {Promise<GateResult>}
 */
export async function runPipelineGate({ url, jdText, cliId, settings, discardLog, runCore, writeScratch, runTriage }) {
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

    // Stage 2: triage on the economy model. Needs the JD in hand: it has no tools.
    if (!triageEnabled(cliId, settings)) return { skip: false, notes };
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
    const triage = parseTriage(await runTriage(prompt.user, TIER_MODELS.economy, settings?.triageEffort ?? null, prompt.systemFile));
    if (!triage) {
      notes.push("Triage gave no verdict; continuing to the evaluation.");
      return { skip: false, notes };
    }
    const score = triage.score === null ? "" : ` ${triage.score}/5`;
    if (triage.verdict === "FAIL" || triage.verdict === "MARGINAL") {
      return { skip: true, stage: "triage", reason: clip(`triage ${triage.verdict}${score}: ${triage.reason}`), notes };
    }
    notes.push(`Triage ${triage.verdict}${score}.`);
    return { skip: false, notes };
  } catch {
    notes.push("The cost gate failed; continuing to the evaluation.");
    return { skip: false, notes };
  }
}
