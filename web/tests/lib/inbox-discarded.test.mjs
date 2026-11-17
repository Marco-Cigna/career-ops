import { test } from "node:test";
import assert from "node:assert/strict";
import { discardedInbox, filterDiscardedInbox } from "../../src/lib/inbox-discarded.mjs";

const job = (id, verdict, overrides = {}) => ({
  url: `https://jobs.example.test/${id}`, company: `Company ${id}`, role: "Engineer",
  done: true, triage: { verdict, at: "2026-11-16T01:00:00Z", reason: "Missing required skill", score: 2.5 },
  ...overrides,
});

test("only completed Filter removals appear, including closed and rule-skipped postings", () => {
  const jobs = [
    ...["FAIL", "MARGINAL", "SKIP_RULES", "CLOSED"].map((v) => job(v, v)),
    job("pass", "PASS"), job("unchecked", "UNCHECKED"),
    job("restored", "FAIL", { done: false }), job("manual", "", { triage: undefined }),
  ];
  assert.deepEqual(discardedInbox(jobs, []).map((j) => j.triage.verdict), ["FAIL", "MARGINAL", "SKIP_RULES", "CLOSED"]);
});

test("tracked postings and URL aliases are not duplicated; separate requisitions survive", () => {
  const jobs = [
    job("one", "FAIL", { url: "https://boards.greenhouse.io/acme/jobs/42?utm_source=li" }),
    job("alias", "FAIL", { url: "https://job-boards.greenhouse.io/acme/jobs/42" }),
    job("two", "FAIL", { url: "https://boards.greenhouse.io/acme/jobs/43" }),
    job("three", "FAIL", { url: "https://boards.greenhouse.io/acme/jobs/44" }),
  ];
  assert.equal(discardedInbox(jobs, []).length, 3);
  const tracked = [{ url: "[posting](https://job-boards.greenhouse.io/acme/jobs/42)" }, { url: "N/A" }];
  assert.deepEqual(discardedInbox(jobs, tracked).map((j) => j.company), ["Company two", "Company three"]);
});

test("historical removals sort newest first without changing canonical rows", () => {
  const jobs = [job("old", "FAIL"), job("new", "CLOSED", {
    triage: { verdict: "CLOSED", at: "2026-11-17T01:00:00Z", reason: "Posting closed", score: null },
  })];
  const original = structuredClone(jobs);
  assert.deepEqual(discardedInbox(jobs, []).map((j) => j.company), ["Company new", "Company old"]);
  assert.deepEqual(jobs, original);
});

test("search finds removal reasons and location; minimum scores never invent a missing score", () => {
  const jobs = [job("low", "FAIL"), job("rule", "SKIP_RULES", {
    location: "Sydney", triage: { verdict: "SKIP_RULES", at: "", reason: "Requires 6+ years", score: null },
  })];
  assert.deepEqual(filterDiscardedInbox(jobs, "  6+ YEARS ", null).map((j) => j.company), ["Company rule"]);
  assert.deepEqual(filterDiscardedInbox(jobs, "sydney", null).map((j) => j.company), ["Company rule"]);
  assert.deepEqual(filterDiscardedInbox(jobs, "", 2.5).map((j) => j.company), ["Company low"]);
  assert.deepEqual(filterDiscardedInbox(jobs, "", 3), []);
});
