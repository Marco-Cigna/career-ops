import test from "node:test";
import assert from "node:assert/strict";
import { orderInbox, parseArgs, readRun } from "../../scripts/auto-score.mjs";

test("arguments have safe defaults and refuse nonsense", () => {
  assert.deepEqual(parseArgs([]), { limit: 15, maxEvals: 5, pdfMin: 4, cli: "claude", url: "http://127.0.0.1:3000", dryRun: false });
  assert.equal(parseArgs(["--max-evals", "2", "--dry-run"]).maxEvals, 2);
  assert.equal(parseArgs(["--url", "http://localhost:3001/"]).url, "http://localhost:3001");
  assert.throws(() => parseArgs(["--limit", "0"]));
  assert.throws(() => parseArgs(["--limit"]));
  assert.throws(() => parseArgs(["--submit"]));
});

test("the inbox is worked newest first, undated postings last", () => {
  const inbox = [
    { url: "https://a.example/1" },
    { url: "https://a.example/2", postedAt: "2026-10-01" },
    { url: "not a url", postedAt: "2026-11-01" },
    { url: "https://a.example/3", postedAt: "2026-10-20" },
  ];
  assert.deepEqual(orderInbox(inbox).map((j) => j.url), ["https://a.example/3", "https://a.example/2", "https://a.example/1"]);
  assert.deepEqual(orderInbox(null), []);
});

test("a run reads as scored, skipped or failed", () => {
  const line = (o) => JSON.stringify(o);
  const scored = readRun([line({ type: "text", text: "…\nVERDICT: 4.2/5 — strong fit\n" }), line({ type: "done", reportN: 31, tokens: 1000 })].join("\n"));
  assert.deepEqual(scored, { status: "done", reportN: 31, tokens: 1000, score: 4.2 });
  assert.equal(readRun(line({ type: "gated", reason: "dealbreaker", message: "triage FAIL", confirmationRequired: false })).status, "gated");
  assert.equal(readRun(line({ type: "error", msg: "rate limit" })).message, "rate limit");
  assert.equal(readRun("").status, "error");
});
