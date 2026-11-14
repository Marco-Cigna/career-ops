// The effects behind pipeline-gate.mjs: core scripts, scratch files and the
// economy-model call. Kept apart so the decisions stay testable as values.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { runCoreCli } from "@/lib/core-cli";
import { claudeTriageArgs } from "@/lib/claude-invocation.mjs";
import { codexTriageArgs } from "@/lib/run-cli-support.mjs";
import { setInboxSkip } from "@/lib/inbox-skip.mjs";
import { readTriageStore, recordTriage, reusablePass, triageEntryFromGate } from "@/lib/inbox-triage-store.mjs";
import { pipelineSettings, runPipelineGate, type GateResult, type PipelineSettings } from "@/lib/pipeline-gate.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";

const TRIAGE_TIMEOUT_MS = 300_000;

/**
 * One fixed, empty working directory for every triage call. Claude Code writes
 * its working directory into the system prompt, so the per-run scratch folder
 * this used to be made every triage prompt different from its first line and
 * none ever read the prompt cache (measured: 649 of ~10k tokens). With a fixed
 * folder, the system prompt, modes/triage.md and the brief are one shared,
 * cached prefix and only the JD at the end is new. Nothing is written to it.
 * Same folder name batch-runner.sh uses, so terminal and web triage share it.
 */
export const TRIAGE_CWD = path.join(os.tmpdir(), "career-ops-triage-cwd");

/** config/profile.yml's spend tier and pipeline block, or null when it cannot be read. */
export async function loadPipelineSettings(): Promise<PipelineSettings | null> {
  try {
    const result = await runCoreCli("prescreen", ["--config"]);
    return result.code === 0 ? pipelineSettings(result.stdout) : null;
  } catch {
    return null;
  }
}

/**
 * One no-tools call on the triage model, on the run's CLI. Resolves to the
 * model's answer, "" on any failure.
 *
 * Claude takes the posting-independent half as a system-prompt file. Codex has
 * no such flag, so that half is prepended to the message instead: it still comes
 * first, which is what codex's automatic prefix caching keys on. Codex's answer
 * is read from its --output-last-message file, never from its console.
 */
function callTriageModel(cliId: string, binPath: string, cwd: string, prompt: string, model: string, effort: string | null, systemFile: string | null, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    let answerDir: string | null = null;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (answerDir) fs.rmSync(answerDir, { recursive: true, force: true });
      resolve(value);
    };
    let child: ReturnType<typeof spawnHeadlessCli>;
    const onAbort = () => { try { child?.kill("SIGTERM"); } catch { /* ignore */ } finish(""); };
    const timer = setTimeout(onAbort, TRIAGE_TIMEOUT_MS);
    const isCodex = cliId === "codex";
    let answerFile: string | null = null;
    try {
      let args: string[];
      let input = prompt;
      if (isCodex) {
        // Outside TRIAGE_CWD, which must stay empty and identical for every call.
        answerDir = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-triage-answer-"));
        answerFile = path.join(answerDir, "answer.txt");
        if (systemFile) input = `${fs.readFileSync(systemFile, "utf8")}\n\n${prompt}`;
        args = codexTriageArgs({ model, effort, outputFile: answerFile });
      } else {
        args = claudeTriageArgs({ model, effort, systemPromptFile: systemFile });
      }
      // The fixed, empty TRIAGE_CWD: the prompt carries everything, so the worker
      // loads no project instructions, and the prefix stays cacheable. No tools,
      // no MCP servers.
      child = spawnHeadlessCli(
        binPath,
        args,
        { cwd, env: process.env },
        { cliId: isCodex ? "codex" : "claude", capabilities: CAPS.localReadOnly },
        { input },
      );
    } catch {
      return finish("");
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.resume();
    child.on("error", () => finish(""));
    child.on("close", (code) => {
      if (code !== 0) return finish("");
      if (!answerFile) return finish(out);
      try {
        finish(fs.readFileSync(answerFile, "utf8"));
      } catch {
        finish("");
      }
    });
  });
}

function discardLine(url: string, reason: string): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  return `${new Date().toISOString()}\t${clean(url)}\t${clean(reason)}\n`;
}

function appendDiscard(discardLog: string, url: string, reason: string) {
  try {
    fs.mkdirSync(path.dirname(discardLog), { recursive: true });
    fs.appendFileSync(discardLog, discardLine(url, reason));
  } catch { /* the skip still stands */ }
}

/** Tick the posting off in data/pipeline.md, so it leaves the inbox and does not come back. */
async function tickOffInbox(root: string, url: string) {
  try {
    const lockModule = path.join(resolveCodeRoot(process.cwd(), process.env), "pipeline-lock.mjs");
    await setInboxSkip(path.join(root, "data", "pipeline.md"), url, true, fs.existsSync(lockModule) ? { lockModule } : {});
  } catch { /* a pasted URL has no inbox row */ }
}

/**
 * A posting whose own page says it closed: off the inbox, with the reason kept
 * where filter verdicts are, and no rule or model run for it.
 */
export async function removeClosedPosting(url: string, evidence: string) {
  const root = careerOpsRoot();
  const reason = `posting closed: ${evidence}`.slice(0, 600);
  appendDiscard(path.join(root, "data", "discard.log"), url, reason);
  try { await recordTriage(root, url, { verdict: "CLOSED", score: null, reason, model: null, at: new Date().toISOString() }); } catch { /* still removed */ }
  await tickOffInbox(root, url);
}

/** Keep a verdict for a posting the filter could not judge, so the inbox can say why. */
export async function recordUnchecked(url: string, reason: string) {
  try { await recordTriage(careerOpsRoot(), url, { verdict: "UNCHECKED", score: null, reason, model: null, at: new Date().toISOString() }); } catch { /* informational */ }
}

/**
 * Run the two cost gates for one posting. A skip is recorded where the batch
 * runner records it (data/discard.log) and the inbox row is ticked off, so the
 * posting does not come back on the next pass.
 */
export async function gateEvaluation(opts: {
  url: string;
  jdText: string | null;
  cliId: string;
  binPath: string;
  settings: PipelineSettings | null;
  signal?: AbortSignal;
}): Promise<GateResult> {
  const root = careerOpsRoot();
  const discardLog = path.join(root, "data", "discard.log");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-gate-"));
  // A PASS from the inbox Filter (or an earlier Score) is not paid for twice.
  const prior = reusablePass(readTriageStore(root)[opts.url], Date.now());
  try {
    const result = await runPipelineGate({
      url: opts.url,
      jdText: opts.jdText,
      cliId: opts.cliId,
      settings: opts.settings,
      discardLog,
      priorPass: prior ? { score: prior.score, model: prior.model } : null,
      runCore: (script, args) => runCoreCli(script, args, { signal: opts.signal }),
      writeScratch: (name, text) => {
        const file = path.join(scratch, name);
        fs.writeFileSync(file, text);
        return file;
      },
      runTriage: (prompt, model, effort, systemFile) => {
        fs.mkdirSync(TRIAGE_CWD, { recursive: true });
        return callTriageModel(opts.cliId, opts.binPath, TRIAGE_CWD, prompt, model, effort, systemFile ?? null, opts.signal);
      },
    });
    const entry = triageEntryFromGate(result, new Date().toISOString());
    if (entry) {
      try { await recordTriage(root, opts.url, entry); } catch { /* the verdict still stands */ }
    }
    if (result.skip) {
      // prescreen.mjs logs its own skips (--log); the triage skip is logged here.
      if (result.stage === "triage") appendDiscard(discardLog, opts.url, result.reason);
      await tickOffInbox(root, opts.url);
    }
    return result;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
