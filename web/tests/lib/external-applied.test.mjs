import assert from "node:assert/strict";
import { test } from "node:test";
import { appliedNote, appliedTsv, cleanUrl, companySlug, localDate, validateSave } from "../../src/lib/external-applied.mjs";

test("the TSV is headed, unscored, reportless and keeps the URL under url", () => {
  const tsv = appliedTsv({ num: "042", date: "2026-11-15", company: "Acme", role: "Data | Analyst", city: "Sydney", notes: "Applied outside career-ops via linkedin.com", url: "https://www.linkedin.com/jobs/view/1" });
  const [header, row] = tsv.trimEnd().split("\n");
  const labels = header.split("\t");
  const cells = Object.fromEntries(row.split("\t").map((v, i) => [labels[i], v]));
  assert.deepEqual(labels, ["num", "date", "company", "role", "location", "status", "score", "pdf", "report", "notes", "url"]);
  assert.equal(cells.location, "Sydney");
  assert.equal(appliedTsv({ num: "1", date: "2026-11-15", company: "A", role: "B", notes: "", url: "https://x.com/1" }).split("\n")[1].split("\t")[4], "—", "no city is the tracker's empty marker");
  assert.equal(cells.score, "N/A");
  assert.equal(cells.report, "—");
  assert.equal(cells.status, "Evaluated");
  assert.equal(cells.role, "Data Analyst", "a pipe would split the tracker row");
  assert.equal(cells.url, "https://www.linkedin.com/jobs/view/1");
});

test("save validation asks for what is missing and refuses non-http links", () => {
  assert.equal(validateSave({ url: "javascript:alert(1)", company: "A", role: "B" }).ok, false);
  assert.match(validateSave({ url: "https://x.com/j/1", company: " ", role: "B" }).error, /company/);
  assert.match(validateSave({ url: "https://x.com/j/1", company: "A", role: "" }).error, /role/);
  assert.deepEqual(validateSave({ url: "https://x.com/j/1", company: "A\tCo", role: "B", city: " Sydney " }), { ok: true, url: "https://x.com/j/1", company: "A Co", role: "B", city: "Sydney" });
  assert.equal(cleanUrl("https://x.com/a b"), null);
});

test("small helpers", () => {
  assert.equal(companySlug("Café & Co."), "cafe-co");
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(appliedNote({ url: "https://www.seek.com.au/job/1" }), "Applied outside career-ops via seek.com.au");
});
