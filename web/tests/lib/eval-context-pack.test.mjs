// The evaluate worker's static context pack, the platform-written JD archive,
// and the prompt that goes with them.
//
// Run:  node --test tests/lib/eval-context-pack.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvalContextPack,
  compactProfileYaml,
  extractSections,
  trimSections,
  writeEvalContextPack,
  PACK_HEADER,
  WEB_TRIMS,
} from "../../src/lib/eval-context-pack.mjs";
import { compactProfileYaml as coreCompactProfileYaml } from "../../../lib/profile-compact.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
import { fillJdArchive, JD_ARCHIVE_MARK } from "../../src/lib/jd-archive-fill.mjs";
import { buildPrompt } from "../../src/lib/run-prompts.mjs";
import { claudeCliArgs, argValue } from "../../src/lib/claude-invocation.mjs";

function fixture() {
  const code = fs.mkdtempSync(path.join(os.tmpdir(), "co-pack-code-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "co-pack-data-"));
  const put = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put(code, "modes/oferta.md", "# Mode: job\nBlocks A-G.\n");
  put(code, "modes/_shared.md", "# Shared\nScoring bands.\n");
  put(code, "modes/_writing.md", "# Writing\nNo em dashes.\n");
  put(code, "batch/batch-prompt.md", [
    "# Batch", "#### Global Score", "global", "#### Score Evidence", "evidence rules",
    "#### Machine Summary", "```yaml", "# not a heading", "score: {X.X}", "```", "rules",
    "#### Local job-facts cache (#1025)", "cache plumbing", "",
  ].join("\n"));
  put(data, "cv.md", "# CV\nData engineer.\n");
  put(data, "config/profile.yml", "# a long template comment\ncandidate:\n  full_name: Test Person # inline\n# another comment\nspend_tier: premium\n");
  put(data, "modes/_profile.md", "# Profile\nTargets.\n");
  return { code, data, cleanup: () => { fs.rmSync(code, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } };
}

test("extractSections takes whole #### sections and ignores headings inside a code fence", () => {
  const text = ["#### A", "a1", "```yaml", "#### not a heading", "```", "a2", "#### B", "b1", "#### C", "c1"].join("\n");
  assert.equal(extractSections(text, ["#### A"]), ["#### A", "a1", "```yaml", "#### not a heading", "```", "a2"].join("\n"));
  assert.equal(extractSections(text, ["#### B", "#### Missing"]), "#### B\nb1");
});

test("compactProfileYaml drops comments and keeps every value", () => {
  const out = compactProfileYaml("# comment\na:\n  b: 1 # inline\n# c\nlist:\n  - x\n");
  assert.doesNotMatch(out, /#/);
  assert.match(out, /b: 1/);
  assert.match(out, /- x/);
  assert.equal(compactProfileYaml("a: [unclosed"), "a: [unclosed", "unparseable YAML passes through");
});

test("the pack is deterministic, carries the schema excerpt, and is named by its hash", () => {
  const f = fixture();
  try {
    const opts = { codeRoot: f.code, dataRoot: f.data, profilePath: path.join(f.data, "config/profile.yml"), evalModeFile: "modes/oferta.md", marketDirs: ["modes"] };
    const a = writeEvalContextPack(opts);
    const b = writeEvalContextPack(opts);
    assert.ok(a && b);
    assert.equal(a.file, b.file, "same inputs, same file: the prompt cache can reuse it");
    assert.match(path.basename(a.file), /^pack-[0-9a-f]{16}\.md$/);
    const pack = fs.readFileSync(a.file, "utf8");
    assert.ok(pack.startsWith(PACK_HEADER));
    for (const want of ["Blocks A-G.", "Scoring bands.", "No em dashes.", "evidence rules", "score: {X.X}", "Targets.", "full_name: Test Person"]) {
      assert.ok(pack.includes(want), want);
    }
    assert.ok(!pack.includes("Data engineer."), "cv.md stays out: Block B reads it after assigning Importance");
    assert.ok(!pack.includes("cache plumbing"), "batch plumbing stays out");
    assert.ok(!pack.includes("Global Score"), "only the schema sections");
    assert.ok(!pack.includes("long template comment"), "profile comments stripped");
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(pack), "no timestamp in the pack");

    // A CV edit keeps the shared pack (and its cache); a profile edit is a new pack.
    fs.appendFileSync(path.join(f.data, "cv.md"), "New role.\n");
    assert.equal(writeEvalContextPack(opts).file, a.file);
    fs.appendFileSync(path.join(f.data, "config/profile.yml"), "language:\n  output: en\n");
    const c = writeEvalContextPack(opts);
    assert.notEqual(c.file, a.file);
  } finally {
    f.cleanup();
  }
});

test("no pack without an evaluation mode file: the worker keeps reading files itself", () => {
  const f = fixture();
  try {
    assert.equal(writeEvalContextPack({ codeRoot: f.code, dataRoot: f.data, profilePath: "", evalModeFile: "modes/missing.md" }), null);
  } finally {
    f.cleanup();
  }
});

test("the web compactor is the core one (batch-runner.sh uses the core copy)", () => {
  const profile = fs.readFileSync(path.join(REPO, "config/profile.example.yml"), "utf8");
  assert.equal(compactProfileYaml(profile), coreCompactProfileYaml(profile));
  assert.ok(compactProfileYaml(profile).length < profile.length / 2, "the template is mostly commentary");
});

test("trimSections replaces a section with its note, fence-aware, and is a no-op for absent headings", () => {
  const text = ["# T", "## Keep", "k", "## Drop", "d1", "```", "## inside fence", "```", "### sub", "d2", "## Next", "n"].join("\n");
  const out = trimSections(text, [["## Drop", "done elsewhere"], ["## Absent", "x"]]);
  assert.equal(out, ["# T", "## Keep", "k", "## Drop", "", "(On web runs: done elsewhere)", "", "## Next", "n"].join("\n"));
});

// The quality guard: trimming must never touch what the report is made of.
test("the trimmed oferta.md keeps every scoring block, gate and report-template heading", () => {
  const raw = fs.readFileSync(path.join(REPO, "modes/oferta.md"), "utf8");
  const trimmed = trimSections(raw, WEB_TRIMS["modes/oferta.md"]);
  // Every trim heading exists in the real file: a renamed section must fail here, not silently stop trimming.
  for (const [heading] of WEB_TRIMS["modes/oferta.md"]) assert.ok(raw.split("\n").some((l) => l.trimEnd() === heading), heading);
  const kept = [
    "## Blacklist gate (#1742)", "## Dealbreaker gate", "## Agency confirmation gate (#1596, #4359)", "## Bounded Research Budget",
    "## Step 0 — Archetype Detection", "## Block A — Role Summary", "### Work-authorization check", "## Block B — Match with CV",
    "### Two-pass rule (generation order is the mechanism)", "## Block C — Level and Strategy", "## Block D — Comp and Demand",
    "## Block E — Customization Plan", "## Block F — Interview Plan", "## Block G — Posting Legitimacy",
    "### Signals to analyze (in order):", "## Risk Summary (after Block G)", "## Post-evaluation", "### 1. Save report .md",
  ];
  for (const heading of kept) assert.ok(trimmed.includes(`\n${heading}\n`), heading);
  // The report template itself, inside its fence, is untouched.
  for (const section of ["## A) Role Summary", "## G) Posting Legitimacy", "## Verdict (lead)", "## Risk Summary", "## Score Evidence",
    "## H) Draft Application Answers (draft)", "## Keywords extracted", "## Keyword Coverage", "## Job Description (archived verbatim)", "## Machine Summary"]) {
    assert.ok(trimmed.includes(`\n${section}\n`), section);
  }
  assert.ok(trimmed.includes("**Machine Summary (required):**"));
  assert.ok(trimmed.includes("**JD archival (required, #2789):**"));
  assert.ok(!trimmed.includes("node evidence-freshness.mjs"), "shell step trimmed");
  assert.ok(!trimmed.includes("**Draft format to append to the report:**"), "cover letter draft trimmed");
  assert.ok(trimmed.length < raw.length * 0.92, `expected a real saving, got ${trimmed.length}/${raw.length}`);
});

test("the trimmed _shared.md keeps scoring, legitimacy and archetype rules", () => {
  const raw = fs.readFileSync(path.join(REPO, "modes/_shared.md"), "utf8");
  for (const [heading] of WEB_TRIMS["modes/_shared.md"]) assert.ok(raw.split("\n").some((l) => l.trimEnd() === heading), heading);
  const trimmed = trimSections(raw, WEB_TRIMS["modes/_shared.md"]);
  for (const heading of ["## Sources of Truth (EXCLUSIVE)", "## Scoring System", "### Evidence confidence for the Global Score",
    "## Posting Legitimacy (Block G)", "## Archetype Detection", "### Agency confirmation handoff (#4359)", "### Unattended runs"]) {
    assert.ok(trimmed.includes(`${heading}\n`), heading);
  }
});

test("buildEvalContextPack leaves out empty files", () => {
  const pack = buildEvalContextPack({ system: [{ label: "s", text: "S" }], user: [{ label: "absent", text: "" }, { label: "u", text: "U" }] });
  assert.ok(pack.includes("===== u =====\nU\n===== END u ====="));
  assert.ok(!pack.includes("absent"));
});

test("fillJdArchive puts the exact posting where the marker is, once", () => {
  const report = ["## Job Description (archived verbatim)", "", "Posted: 3 days ago", JD_ARCHIVE_MARK, "", "## Machine Summary"].join("\n");
  const jd = "Senior Data Engineer\r\n\r\nYou will build pipelines.";
  const { markdown, filled } = fillJdArchive(report, jd);
  assert.equal(filled, true);
  assert.ok(markdown.includes("Posted: 3 days ago\nSenior Data Engineer\n\nYou will build pipelines.\n\n## Machine Summary"));
  assert.ok(!markdown.includes(JD_ARCHIVE_MARK));

  const twice = fillJdArchive(`${JD_ARCHIVE_MARK}\nx\n  ${JD_ARCHIVE_MARK}  `, "JD");
  assert.equal(twice.markdown, "JD\nx");

  assert.deepEqual(fillJdArchive("no marker here", "JD"), { markdown: "no marker here", filled: false });
  assert.deepEqual(fillJdArchive(report, null), { markdown: report, filled: false });
  assert.equal(fillJdArchive(`inline ${JD_ARCHIVE_MARK} mention`, "JD").filled, false, "only a line of its own");
});

const BASE = { kind: "evaluate", input: "https://careers.example.com/job/1", memory: "", today: "2026-11-14" };

test("with a pack, the evaluate prompt points at the system prompt instead of telling the worker to Read", () => {
  const packed = buildPrompt({ ...BASE, contextPack: true });
  assert.match(packed, /reproduced in your system prompt under REFERENCE FILES/);
  assert.match(packed, /Do NOT Read those again/);
  assert.match(packed, /then Read cv\.md \(and article-digest\.md if it exists\) for pass 2/);
  assert.doesNotMatch(packed, /Read modes\/oferta\.md and follow it/);
  const plain = buildPrompt({ ...BASE });
  assert.match(plain, /Read modes\/oferta\.md and follow it EXACTLY/);
  assert.doesNotMatch(plain, /REFERENCE FILES/);
});

test("a prefetched JD asks for the archive marker; without one the worker archives the text itself", () => {
  const withJd = buildPrompt({ ...BASE, contextPack: true, prefetchedJd: "posting text" });
  assert.match(withJd, /<<jd-archive>>/);
  assert.match(withJd, /Do NOT copy the posting text into the report/);
  // The marker is described mid-line, never on a line of its own (echoing CLIs).
  assert.ok(!withJd.split("\n").some((l) => l.trim() === JD_ARCHIVE_MARK));
  assert.doesNotMatch(buildPrompt({ ...BASE, contextPack: true }), /<<jd-archive>>/);
  const selected = buildPrompt({ ...BASE, contextPack: true, prefetchedJd: "posting text", evaluationInstructions: "SELECTED" });
  assert.match(selected, /<<jd-archive>>/);
  assert.match(selected, /reference only: the selected instructions below decide/);
});

test("claudeCliArgs appends the pack as a system prompt file, and only when given one", () => {
  const args = claudeCliArgs({ kind: "evaluate", prompt: "p", systemPromptFile: "/data/cache/eval-context/pack-0123456789abcdef.md" });
  assert.equal(argValue(args, "--append-system-prompt-file"), "/data/cache/eval-context/pack-0123456789abcdef.md");
  assert.equal(claudeCliArgs({ kind: "evaluate", prompt: "p" }).includes("--append-system-prompt-file"), false);
});
