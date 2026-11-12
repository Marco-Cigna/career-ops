/**
 * local-tools.mjs — the user's own scripts on the Tools page.
 *
 * A user lists commands in {DATA_ROOT}/config/local-tools.yml (user layer:
 * never shipped, never updated, never read by anything else). The Tools page
 * shows each one with a Run button and when it last ran. A request names a
 * tool by id only; the command, its arguments and its folder come from the
 * user's own file, are run without a shell, and nothing from the request
 * reaches them.
 *
 *   tools:
 *     - id: job-sync                      # [a-z0-9-]
 *       label: Sync job applications
 *       description: Optional one-liner.
 *       steps:                            # run in order; a failed step stops the rest
 *         - run: ["C:/Python312/python.exe", "tracker.py"]
 *           cwd: "C:/Users/me/Job search"
 *         - run: ["node", "{data_root}/scripts/import.mjs", "--code-root", "{code_root}"]
 *       timeout_minutes: 15               # per run, default 15, max 120
 *       stale_after_hours: 24             # the "last run" note turns amber after this
 *       wait_for_closed: ["C:/Users/me/Job search/tracker.xlsx"]
 *                                         # refuse to start while one of these is
 *                                         # open elsewhere (an Excel workbook)
 *
 * In `run` and `cwd`, {data_root} and {code_root} expand to the career-ops data
 * folder and checkout, and a first argument of "node" means the Node running
 * the dashboard. Pure: parsing and formatting only; local-tools-run.ts runs.
 */
import * as yaml from "js-yaml";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_STEPS = 10;
const MAX_ARGS = 40;

/**
 * @typedef {{run: string[], cwd: string | null}} LocalToolStep
 * @typedef {{id: string, label: string, description: string, steps: LocalToolStep[], timeoutMs: number, staleAfterHours: number | null, waitForClosed: string[]}} LocalTool
 */

const str = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Parse the config text. Invalid entries are skipped and reported, so one typo
 * does not hide every other tool.
 *
 * @param {string} text
 * @returns {{tools: LocalTool[], problems: string[]}}
 */
export function parseLocalTools(text) {
  /** @type {LocalTool[]} */
  const tools = [];
  /** @type {string[]} */
  const problems = [];
  // An empty or comment-only file lists no tools; js-yaml 5 throws on it.
  if (!String(text ?? "").replace(/^\s*#.*$/gm, "").trim()) return { tools, problems };
  let doc;
  try {
    doc = yaml.load(text);
  } catch (err) {
    return { tools, problems: [`local-tools.yml is not valid YAML: ${/** @type {Error} */ (err).message.split("\n")[0]}`] };
  }
  const list = doc && typeof doc === "object" && Array.isArray(/** @type {any} */ (doc).tools) ? /** @type {any} */ (doc).tools : null;
  if (!list) return { tools, problems: doc == null ? [] : ["local-tools.yml needs a top-level `tools:` list."] };
  const seen = new Set();
  list.forEach((raw, i) => {
    const where = `tools[${i}]`;
    if (!raw || typeof raw !== "object") return problems.push(`${where} is not a mapping.`);
    const id = str(raw.id);
    if (!ID_RE.test(id)) return problems.push(`${where}: id must be lowercase letters, digits and dashes.`);
    if (seen.has(id)) return problems.push(`${where}: id "${id}" is used twice.`);
    const steps = Array.isArray(raw.steps) ? raw.steps : null;
    if (!steps || !steps.length || steps.length > MAX_STEPS) return problems.push(`${id}: steps must list 1 to ${MAX_STEPS} commands.`);
    /** @type {LocalToolStep[]} */
    const parsed = [];
    for (const [j, step] of steps.entries()) {
      const run = step && Array.isArray(step.run) ? step.run : null;
      if (!run || !run.length || run.length > MAX_ARGS || run.some((a) => typeof a !== "string" && typeof a !== "number")) {
        return problems.push(`${id}: steps[${j}].run must be a list of 1 to ${MAX_ARGS} arguments, the command first.`);
      }
      parsed.push({ run: run.map(String), cwd: str(step.cwd) || null });
    }
    const minutes = Number(raw.timeout_minutes ?? 15);
    const stale = raw.stale_after_hours == null ? null : Number(raw.stale_after_hours);
    const waits = Array.isArray(raw.wait_for_closed) ? raw.wait_for_closed.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim()) : [];
    seen.add(id);
    tools.push({
      id,
      label: str(raw.label) || id,
      description: str(raw.description),
      steps: parsed,
      timeoutMs: Math.round(Math.min(120, Math.max(1, Number.isFinite(minutes) ? minutes : 15)) * 60_000),
      staleAfterHours: stale !== null && Number.isFinite(stale) && stale > 0 ? stale : null,
      waitForClosed: waits,
    });
  });
  return { tools, problems };
}

/**
 * The command line for one step, with {data_root} / {code_root} expanded and
 * "node" resolved to the running Node.
 *
 * @param {LocalToolStep} step
 * @param {{dataRoot: string, codeRoot: string, nodePath: string}} roots
 * @returns {{command: string, args: string[], cwd: string | null}}
 */
export function resolveStep(step, { dataRoot, codeRoot, nodePath }) {
  const fill = (s) => s.replaceAll("{data_root}", dataRoot).replaceAll("{code_root}", codeRoot);
  const [first, ...rest] = step.run.map(fill);
  return { command: first === "node" ? nodePath : first, args: rest, cwd: step.cwd ? fill(step.cwd) : null };
}

/**
 * "just now", "12 min ago", "3 h ago", "2 days ago".
 * @param {string | null | undefined} iso
 * @param {number} now ms
 */
export function timeAgo(iso, now) {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "never";
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Is a last run older than the tool's stale_after_hours? Never-run counts as stale. */
export function isStale(iso, staleAfterHours, now) {
  if (staleAfterHours == null) return false;
  const t = Date.parse(String(iso ?? ""));
  return !Number.isFinite(t) || now - t > staleAfterHours * 3_600_000;
}

/** Keep the end of a run's output: that is where the summary and the error are. */
export function outputTail(text, max = 6000) {
  // eslint-disable-next-line no-control-regex
  const clean = String(text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r\n?/g, "\n");
  return clean.length > max ? `…${clean.slice(-max)}` : clean;
}
