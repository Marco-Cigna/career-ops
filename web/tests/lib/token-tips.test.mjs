import { test } from "node:test";
import assert from "node:assert/strict";
import { CACHE_WARM_MS, isAggregatorUrl, scoringTips, sharedContextWarm } from "../../src/lib/token-tips.mjs";

const NOW = 1_000_000_000;
const ids = (tips) => tips.map((t) => t.id);

test("aggregator links are told apart from employer links", () => {
  for (const url of ["https://www.linkedin.com/jobs/view/1", "https://au.indeed.com/viewjob?jk=1", "https://www.seek.com.au/job/1", "https://www.glassdoor.co.uk/job/1"]) {
    assert.equal(isAggregatorUrl(url), true, url);
  }
  for (const url of ["https://jobs.ashbyhq.com/acme/1", "https://boards.greenhouse.io/acme/jobs/1", "https://careers.acme.com/job/1", "https://notlinkedin.com/x", "nope"]) {
    assert.equal(isAggregatorUrl(url), false, url);
  }
});

test("the shared context is warm while an evaluation runs and shortly after one ends", () => {
  assert.equal(sharedContextWarm([{ kind: "evaluate", status: "running" }], NOW), true);
  assert.equal(sharedContextWarm([{ kind: "evaluate", status: "done", endedAt: NOW - CACHE_WARM_MS + 1 }], NOW), true);
  assert.equal(sharedContextWarm([{ kind: "evaluate", status: "done", endedAt: NOW - CACHE_WARM_MS - 1 }], NOW), false);
  assert.equal(sharedContextWarm([{ kind: "pdf", status: "running" }], NOW), false, "only evaluations share the pack");
});

test("tips follow the situation: one cold role, a batch, a warm cache", () => {
  const one = [{ url: "https://jobs.ashbyhq.com/acme/1" }];
  const three = [...one, { url: "https://jobs.lever.co/a/2" }, { url: "https://jobs.lever.co/a/3" }];
  assert.equal(scoringTips({ items: one, jobs: [], now: NOW, allSections: false })[0].id, "single");
  assert.match(scoringTips({ items: three, jobs: [], now: NOW, allSections: false })[0].text, /These 3 run back to back/);
  assert.equal(scoringTips({ items: one, jobs: [{ kind: "evaluate", status: "running" }], now: NOW, allSections: false })[0].id, "warm");
});

test("aggregator and section tips appear only when they apply", () => {
  const plain = ids(scoringTips({ items: [{ url: "https://jobs.lever.co/a/1" }], jobs: [], now: NOW, allSections: false }));
  assert.ok(!plain.includes("aggregator") && !plain.includes("sections"));
  const tips = scoringTips({ items: [{ url: "https://www.linkedin.com/jobs/view/1" }, { url: "https://www.seek.com.au/job/2" }], jobs: [], now: NOW, allSections: true });
  assert.match(tips.find((t) => t.id === "aggregator").text, /^2 links are/);
  assert.ok(ids(tips).includes("sections"));
  for (const id of ["profile", "triage", "drafts"]) assert.ok(ids(tips).includes(id), id);
});
