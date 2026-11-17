import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePortalQuestionsSection, upsertPortalQuestionsSection, formatApplicationAnswersSection } from "../application-answers.mjs";

const snapshot = { savedAt: "2026-11-16T11:00:00Z", questions: [{ id: "q1", question: "Why this role?\n## Injected heading\n-->", answer: "I build internal tools.\n### A heading in an answer", status: "draft", notes: "Review", maxWords: 150, evidence: [] }] };

test("portal drafts round trip separately from filled/submitted application answers", () => {
  const report = "# Evaluation\n\n## B) CV Match\n\nOriginal evaluation.\n\n" + formatApplicationAnswersSection({ state: "submitted", freeText: [{ question: "Existing", answer: "Actual submitted answer" }] });
  const next = upsertPortalQuestionsSection(report, snapshot);
  assert.ok(next.startsWith(report), "all existing report text and submitted answers stay byte-identical");
  assert.deepEqual(parsePortalQuestionsSection(next), snapshot);
  assert.equal((next.match(/^## Portal Questions \(draft\)$/gm) ?? []).length, 1);
  assert.match(next, /> ## Injected heading/);
});

test("replacing portal drafts preserves adjacent report sections and CRLF", () => {
  const base = "# Evaluation\r\n\r\n## B) CV Match\r\nKeep this.\r\n";
  const saved = upsertPortalQuestionsSection(base, snapshot) + "\r\n## Keywords extracted\r\nPython\r\n";
  const edited = { ...snapshot, questions: [{ ...snapshot.questions[0], answer: "Edited answer" }] };
  const next = upsertPortalQuestionsSection(saved, edited);
  assert.ok(next.startsWith(base));
  assert.ok(next.endsWith("## Keywords extracted\r\nPython\r\n"));
  assert.deepEqual(parsePortalQuestionsSection(next), edited);
  assert.ok(!next.replace(/\r\n/g, "").includes("\n"));
});

test("a damaged saved section is refused instead of overwritten", () => {
  const damaged = "# Report\n\n## Portal Questions (draft)\nManually edited without its structured data.\n";
  assert.throws(() => parsePortalQuestionsSection(damaged), /unreadable/);
  assert.throws(() => upsertPortalQuestionsSection(damaged, snapshot), /unreadable/);
  assert.equal(parsePortalQuestionsSection("# No saved questions\n"), null);
  const externallyEdited = upsertPortalQuestionsSection("# Report\n", snapshot).replace("> I build internal tools.", "> I edited the visible answer by hand.");
  assert.throws(() => parsePortalQuestionsSection(externallyEdited), /differs from its structured data/);
});

test("a quoted or fenced draft heading never becomes the managed section", () => {
  const report = "# Report\n\n```md\n## Portal Questions (draft)\n```\n\n> ## Portal Questions (draft)\n";
  assert.equal(parsePortalQuestionsSection(report), null);
  assert.deepEqual(parsePortalQuestionsSection(upsertPortalQuestionsSection(report, snapshot)), snapshot);
});
