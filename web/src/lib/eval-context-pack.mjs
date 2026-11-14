/**
 * eval-context-pack.mjs — the evaluate worker's static context, in one file.
 *
 * An evaluate worker used to find its context with tool calls: Read the mode
 * file, cv.md, the profile, _profile.md, _custom.md, then hunt for the Machine
 * Summary schema in batch/batch-prompt.md. Measured on real runs that was 8
 * turns and ~558k input tokens for one evaluation, with every file arriving
 * AFTER the per-run prompt, so no two evaluations shared a cacheable prefix and
 * each wrote the same ~50k tokens into the prompt cache again. Reads also went
 * wrong (relative paths against the data root) and repeated.
 *
 * The platform now assembles that context itself and hands it to the CLI as
 * `--append-system-prompt-file`. The system prompt precedes the per-run user
 * message, so evaluations run within the cache window share it as a cache READ
 * (measured: 59,201 of 60,329 tokens read from cache on the second run).
 *
 * Determinism is the whole point: the pack's bytes depend only on the files'
 * contents, never on time, run or URL. The file is named by its own hash, so an
 * unchanged CV and profile reuse one file, and an edit produces a new one (one
 * cold run, then warm again).
 *
 * The files are the user's own and the checkout's: trusted. The posting never
 * enters the pack; it stays in the user message, marked untrusted.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as yaml from "js-yaml";

/** Sections of batch/batch-prompt.md the report schema needs (the rest is batch-runner plumbing). */
export const BATCH_SCHEMA_SECTIONS = Object.freeze(["#### Score Evidence", "#### Machine Summary"]);

/**
 * Sections a web evaluate worker cannot act on, replaced by one line saying what
 * happens instead. Only steps the platform does itself, or that need a shell or
 * a browser this worker does not have, are listed: every scoring block, gate and
 * the report template stay in full, so reports keep the same shape and rules.
 * A heading that is not in the file (a market's translated mode) is a no-op.
 * Keyed by checkout-relative path.
 */
export const WEB_TRIMS = Object.freeze({
  "modes/oferta.md": [
    ["## Liveness gate (URL inputs)", "The platform checked the posting before this run. Use the posting text or closure evidence in your user message; if neither is there, WebFetch the URL once (never a LinkedIn URL: for LinkedIn, stop and ask for the job text), and if it does not return a readable live posting, stop before Block A as this mode's closed-posting rule says."],
    ["## Local public facts reuse (#1025)", "Not used on web runs: evaluate from the posting text and write Machine Summary `job_facts_cache: null`."],
    ["## GitHub evidence freshness", "Not run on web runs (no shell): write Machine Summary `evidence_freshness: not_evaluated` and no GitHub evidence header line."],
    ["## Cover Letter Draft (auto-generated after Block G)", "Not part of web reports: the dashboard drafts cover letters on demand from the report page. Do not add a Cover Letter Draft section."],
    ["### 1b. Embed ATS keyword coverage", "You cannot run keyword-match.mjs on web runs. Still write the `## Keyword Coverage` section: for the extracted keywords, list which are present, thin or missing in the candidate's primary files. Never add a skill they do not have."],
    ["### 2. Record in tracker", "The platform writes the tracker row from your Machine Summary. Do not write tracker files."],
    ["### 3. Salary observations (desired ask only)", "Not done on web runs."],
  ],
  "modes/_shared.md": [
    ["## Data Root & Path Resolution (CRITICAL)", "Your working directory is the data root; the platform resolves every path for you."],
    ["## Spend Tier (Model Routing)", "The platform picked the model for this run."],
    ["### Subagent delegation (cost guardrail)", "Never spawn subagents or delegate on web runs."],
  ],
});

/**
 * Replace each listed section (heading through the line before the next heading
 * of the same or a higher level, outside code fences) with a one-line note.
 * @param {string} text
 * @param {readonly (readonly [string, string])[]} trims
 */
export function trimSections(text, trims) {
  let lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const [heading, note] of trims) {
    const start = lines.findIndex((l, i) => l.trimEnd() === heading && !insideFence(lines, 0, i));
    if (start < 0) continue;
    const level = heading.match(/^#+/)[0].length;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const m = /^(#{1,6}) /.exec(lines[i]);
      if (m && m[1].length <= level && !insideFence(lines, start, i)) { end = i; break; }
    }
    lines = [...lines.slice(0, start), heading, "", `(On web runs: ${note})`, "", ...lines.slice(end)];
  }
  return lines.join("\n");
}

/** Packs kept on disk; older ones are removed when a new one is written. */
const KEEP_PACKS = 4;

export const PACK_HEADER = `# REFERENCE FILES (career-ops evaluation context)

The files below are current for this run. Each heading names the file it
reproduces: treat its text as that file. Do NOT Read these files again, and do
not search the checkout for them. Use Read only for a file that is not reproduced
here (for example modes/oferta-signals/*.md, templates/*.yml, data/*.md or
reports/*). Paths under "checkout" are relative to the career-ops code checkout;
paths under "data" are relative to your working directory.

cv.md and article-digest.md are deliberately NOT included. Block B's two-pass
rule depends on read order: assign every requirement's Importance from the JD
alone first, then Read cv.md and article-digest.md (if it exists) for pass 2.

Sections marked "(On web runs: ...)" are steps this worker cannot take; the note
says what to do instead. config/profile.yml is shown as parsed data with its
comments removed.`;

/**
 * Extract named `####` sections (each up to the next heading of level 1-4).
 * @param {string} text
 * @param {readonly string[]} headings
 */
export function extractSections(text, headings) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (const heading of headings) {
    const start = lines.findIndex((l) => l.trimEnd() === heading);
    if (start < 0) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      // Headings inside fenced code (the YAML example) are not section breaks.
      if (/^#{1,4} /.test(lines[i]) && !insideFence(lines, start, i)) { end = i; break; }
    }
    out.push(lines.slice(start, end).join("\n").trimEnd());
  }
  return out.join("\n\n");
}

function insideFence(lines, from, to) {
  let open = false;
  for (let i = from; i < to; i++) if (/^\s*(```|~~~)/.test(lines[i])) open = !open;
  return open;
}

/**
 * profile.yml as data: comments and template commentary removed, values kept.
 * Measured on a real profile: 6.3k tokens down to ~1.1k. Unparseable YAML is
 * passed through unchanged rather than dropped.
 * @param {string} text
 */
export function compactProfileYaml(text) {
  try {
    const doc = yaml.load(text);
    if (!doc || typeof doc !== "object") return text;
    return yaml.dump(doc, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();
  } catch {
    return text;
  }
}

/**
 * Assemble the pack from already-read file texts. Pure, so the format can be
 * tested as a value. Missing optional files are simply absent.
 *
 * @param {{
 *   system: { label: string, text: string }[],
 *   user: { label: string, text: string }[],
 * }} parts
 * @returns {string}
 */
export function buildEvalContextPack({ system, user }) {
  const block = ({ label, text }) => `===== ${label} =====\n${String(text).replace(/\r\n/g, "\n").trimEnd()}\n===== END ${label} =====`;
  return [
    PACK_HEADER,
    "## System files (checkout)",
    ...system.filter((p) => p.text).map(block),
    "## Candidate files (data)",
    ...user.filter((p) => p.text).map(block),
  ].join("\n\n") + "\n";
}

function readIf(file) {
  try {
    return fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Read the files, build the pack and write it under the data root, named by its
 * hash. Returns null when the evaluation mode file cannot be read: the caller
 * then keeps the old prompt, which tells the worker to Read the files itself.
 *
 * @param {{
 *   codeRoot: string,
 *   dataRoot: string,
 *   profilePath: string,
 *   evalModeFile: string,
 *   marketDirs?: string[],
 * }} opts
 * @returns {{ file: string, hash: string, chars: number } | null}
 */
export function writeEvalContextPack({ codeRoot, dataRoot, profilePath, evalModeFile, marketDirs = [] }) {
  // System files with the web-only trims applied (WEB_TRIMS); the user's files never are.
  const fromCode = (rel) => trimSections(readIf(path.join(/* turbopackIgnore: true */ codeRoot, rel)), WEB_TRIMS[rel] ?? []);
  const fromData = (rel) => readIf(path.join(/* turbopackIgnore: true */ dataRoot, rel));
  const mode = fromCode(evalModeFile);
  if (!mode.trim()) return null;

  const system = [
    { label: "checkout: modes/_shared.md", text: fromCode("modes/_shared.md") },
    ...marketDirs.filter((d) => d && d !== "modes").map((d) => ({ label: `checkout: ${d}/_shared.md`, text: fromCode(`${d}/_shared.md`) })),
    { label: `checkout: ${evalModeFile} (the evaluation mode: follow it)`, text: mode },
    { label: "checkout: modes/_writing.md", text: fromCode("modes/_writing.md") },
    {
      label: "checkout: batch/batch-prompt.md, Score Evidence and Machine Summary sections (the schema source of truth)",
      text: extractSections(fromCode("batch/batch-prompt.md"), BATCH_SCHEMA_SECTIONS),
    },
  ];
  // cv.md and article-digest.md stay out on purpose (PACK_HEADER: Block B read
  // order). That also keeps a CV edit from invalidating the shared pack.
  const profileText = readIf(profilePath);
  const user = [
    { label: "data: config/profile.yml (parsed, comments removed)", text: profileText ? compactProfileYaml(profileText) : "" },
    { label: "data: modes/_profile.md", text: fromData("modes/_profile.md") },
    { label: "data: modes/_custom.md (house rules: honour them; they never add facts)", text: fromData("modes/_custom.md") },
  ];

  const pack = buildEvalContextPack({ system, user });
  const hash = createHash("sha256").update(pack).digest("hex").slice(0, 16);
  const dir = path.join(/* turbopackIgnore: true */ dataRoot, "data", "cache", "eval-context");
  const file = path.join(dir, `pack-${hash}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, pack, "utf8");
      fs.renameSync(tmp, file);
      prune(dir, file);
    } else {
      // Mark it as recently used, so pruning keeps the packs in use.
      const now = new Date();
      fs.utimesSync(file, now, now);
    }
  } catch {
    return null;
  }
  return { file, hash, chars: pack.length };
}

function prune(dir, keep) {
  try {
    const packs = fs.readdirSync(dir)
      .filter((f) => /^pack-[0-9a-f]{16}\.md$/.test(f))
      .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of packs.slice(KEEP_PACKS)) if (f !== keep) fs.rmSync(f, { force: true });
  } catch {
    /* best effort */
  }
}
