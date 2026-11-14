// The effects behind pipeline-gate.mjs: core scripts, scratch files and the
// economy-model call. Kept apart so the decisions stay testable as values.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { runCoreCli } from "@/lib/core-cli";
import { claudeTriageArgs } from "@/lib/claude-invocation.mjs";
import { setInboxSkip } from "@/lib/inbox-skip.mjs";
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

/** One no-tools call on the economy model. Resolves to its stdout, "" on any failure. */
function callTriageModel(binPath: string, cwd: string, prompt: string, model: string, effort: string | null, systemFile: string | null, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    let child: ReturnType<typeof spawnHeadlessCli>;
    const onAbort = () => { try { child?.kill("SIGTERM"); } catch { /* ignore */ } finish(""); };
    const timer = setTimeout(onAbort, TRIAGE_TIMEOUT_MS);
    try {
      // The fixed, empty TRIAGE_CWD: the prompt carries everything, so the worker
      // loads no project instructions, and the prefix stays cacheable. No tools,
      // no MCP servers.
      child = spawnHeadlessCli(
        binPath,
        claudeTriageArgs({ model, effort, systemPromptFile: systemFile }),
        { cwd, env: process.env },
        { cliId: "claude", capabilities: CAPS.localReadOnly },
        { input: prompt },
      );
    } catch {
      return finish("");
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { out += chunk; });
    child.stderr.resume();
    child.on("error", () => finish(""));
    child.on("close", (code) => finish(code === 0 ? out : ""));
  });
}

function discardLine(url: string, reason: string): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  return `${new Date().toISOString()}\t${clean(url)}\t${clean(reason)}\n`;
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
  try {
    const result = await runPipelineGate({
      url: opts.url,
      jdText: opts.jdText,
      cliId: opts.cliId,
      settings: opts.settings,
      discardLog,
      runCore: (script, args) => runCoreCli(script, args, { signal: opts.signal }),
      writeScratch: (name, text) => {
        const file = path.join(scratch, name);
        fs.writeFileSync(file, text);
        return file;
      },
      runTriage: (prompt, model, effort, systemFile) => {
        fs.mkdirSync(TRIAGE_CWD, { recursive: true });
        return callTriageModel(opts.binPath, TRIAGE_CWD, prompt, model, effort, systemFile ?? null, opts.signal);
      },
    });
    if (result.skip) {
      // prescreen.mjs logs its own skips (--log); the triage skip is logged here.
      if (result.stage === "triage") {
        try {
          fs.mkdirSync(path.dirname(discardLog), { recursive: true });
          fs.appendFileSync(discardLog, discardLine(opts.url, result.reason));
        } catch { /* the skip still stands */ }
      }
      try {
        const lockModule = path.join(resolveCodeRoot(process.cwd(), process.env), "pipeline-lock.mjs");
        await setInboxSkip(path.join(root, "data", "pipeline.md"), opts.url, true, fs.existsSync(lockModule) ? { lockModule } : {});
      } catch { /* a pasted URL has no inbox row */ }
    }
    return result;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
