/**
 * cv-repair.mjs — one automatic correction pass for a tailored CV the render
 * gates rejected.
 *
 * A web pdf worker has no Bash, so it cannot run the fact, voice and chronology
 * gates the way modes/pdf.md's CLI flow does (step 19: run the gate, fix, run
 * again). It emits the CV once and the backend runs the gates afterwards, so a
 * single slip (a separator inside a school field, a JD word on the voice list)
 * used to throw away the whole tailoring run and leave the user to start over.
 *
 * This module holds the plain, testable half of the fix: which failures a
 * second pass can address, and running that pass. The pass gets the gate's own
 * error and the rejected HTML, emits a corrected <<cv-html>> envelope, and the
 * route renders it through the same gates. It is attempted at most once per
 * run, so a CV that cannot pass never loops.
 *
 * Plain .mjs with the child-process spawner injected, like pdf-render.mjs, so
 * `node --test` can drive it with a fake child.
 */
import fs from "node:fs";
import path from "node:path";
import { accumulateTokens, createAgentTextJoiner } from "./run-cli-support.mjs";
import { createCvEnvelopeFilter } from "./cv-envelope.mjs";

/**
 * Gate failures the tailoring agent can correct by editing its own HTML. Each
 * is a named rejection of the CV's content. Anything else (a browser that
 * would not launch, a missing data folder, a tracker problem) is not about the
 * CV, and a second agent run would only spend money on it.
 */
const REPAIRABLE_RE = /Fact check failed|Voice check failed|not in reverse-chronological order|Locked section '[^']*' was modified/;

/**
 * @param {string} error - The render failure as renderAndMarkPdf reported it.
 * @returns {boolean}
 */
export function isRepairableRenderFailure(error) {
  return typeof error === "string" && REPAIRABLE_RE.test(error);
}

/** Seconds a repair needs at minimum: a short agent pass plus a render. */
export const REPAIR_MIN_SECONDS = 240;
/** Seconds held back for the second render after the repair agent stops. */
export const REPAIR_RENDER_RESERVE_SECONDS = 120;
/** The repair agent's own ceiling: it edits a finished CV, it does not re-tailor. */
export const REPAIR_MAX_AGENT_SECONDS = 300;

/**
 * How long the repair agent may run, or null when the run has too little time
 * left for a repair and a render inside the route's limit.
 *
 * @param {{startedAt: number, now: number, maxDurationS: number}} args
 * @returns {number | null} milliseconds
 */
export function repairBudgetMs({ startedAt, now, maxDurationS }) {
  const remainingS = maxDurationS - (now - startedAt) / 1000;
  if (remainingS < REPAIR_MIN_SECONDS) return null;
  return Math.round(Math.min(REPAIR_MAX_AGENT_SECONDS, remainingS - REPAIR_RENDER_RESERVE_SECONDS) * 1000);
}

/**
 * Where the rejected HTML is kept, beside the run's scratch file. Named with
 * the run's own `cv-web-NNN.` prefix, so the next render of that report sweeps
 * it like any other scratch file instead of letting it pile up.
 *
 * @param {{html: string}} pdfPaths
 * @returns {string}
 */
export function failedHtmlPath(pdfPaths) {
  return pdfPaths.html.replace(/\.html$/i, ".failed.html");
}

/**
 * Keep the rejected HTML so the repair agent can read it and the user can open
 * it when the repair fails too. Never throws: a CV that could not be kept is
 * reported, not fatal.
 *
 * @param {{html: string}} pdfPaths
 * @param {string} html
 * @returns {string | null} the path written, or null
 */
export function keepFailedHtml(pdfPaths, html) {
  const file = failedHtmlPath(pdfPaths);
  try {
    fs.writeFileSync(file, html, "utf8");
    return file;
  } catch (err) {
    console.error(`cv-repair: could not keep the rejected CV at ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * The path the agent is told to Read, relative to its cwd (the data root) when
 * the file sits inside it, with forward slashes.
 *
 * @param {string} file
 * @param {string} dataRoot
 * @returns {string}
 */
export function agentRelativePath(file, dataRoot) {
  const rel = path.relative(dataRoot, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file;
}

/**
 * @typedef {Object} RepairRunResult
 * @property {import("./cv-envelope.mjs").CvEnvelope | {ok: false, error: string}} envelope
 * @property {number} tokens
 * @property {number | null} costUsd
 * @property {string} narration - The agent's text outside the envelope.
 * @property {boolean} timedOut
 * @property {number | null} code
 */

/**
 * Run the repair agent and collect its envelope. Mirrors the route's own
 * stdout handling: a CLI with a structured stream is parsed event by event
 * (`parseEvent`), a plain one is read as text.
 *
 * @param {{
 *   spawnChild: () => import("node:child_process").ChildProcess,
 *   parseEvent?: (line: string) => any,
 *   killMs: number,
 *   onChild?: (child: import("node:child_process").ChildProcess) => void,
 * }} args
 * @returns {Promise<RepairRunResult>}
 */
export function runCvRepair({ spawnChild, parseEvent, killMs, onChild }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnChild();
    } catch (err) {
      resolve({ envelope: { ok: false, error: `The repair pass could not start: ${err instanceof Error ? err.message : String(err)}` }, tokens: 0, costUsd: null, narration: "", timedOut: false, code: null });
      return;
    }
    onChild?.(child);
    const filter = createCvEnvelopeFilter();
    const join = createAgentTextJoiner();
    let narration = "";
    let tokens = 0;
    let costUsd = null;
    let buf = "";
    let timedOut = false;
    let settled = false;
    const push = (text) => { if (text) narration += filter.push(text); };
    const handleLine = (line) => {
      const ev = parseEvent?.(line);
      push(join(ev));
      tokens = accumulateTokens(tokens, ev);
      if (typeof ev?.costUsd === "number") costUsd = ev.costUsd;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    }, killMs);
    child.stdout?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      if (!parseEvent) return push(String(chunk));
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handleLine(line);
      }
    });
    // stderr is drained so a chatty CLI cannot block on a full pipe; the
    // verdict comes from the envelope, as it does for the first pass.
    child.stderr?.on?.("data", () => {});
    const finish = (code, startError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buf.trim() && parseEvent) handleLine(buf.trim());
      narration += filter.flush();
      const envelope = startError
        ? { ok: false, error: `The repair pass could not start: ${startError}` }
        : timedOut
          ? { ok: false, error: `The repair pass ran past its ${Math.round(killMs / 1000)}s limit.` }
          : filter.result();
      resolve({ envelope, tokens, costUsd, narration, timedOut, code });
    };
    child.on("error", (e) => finish(null, e.message));
    child.on("close", (code) => finish(code, null));
  });
}
