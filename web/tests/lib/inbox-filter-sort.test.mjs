import assert from "node:assert/strict";
import { test } from "node:test";
import { orderInboxByFilterScore } from "../../src/lib/inbox-filter-sort.mjs";

test("Filter score orders by triage rather than profile fit, keeping unscored rows last", () => {
  const rows = [
    { id: "unscored", fit: { score: 5 } },
    { id: "lower", triage: { score: 3.8 }, fit: { score: 5 } },
    { id: "higher", triage: { score: 4.8 }, fit: { score: 1 } },
    { id: "zero", triage: { score: 0 } },
    { id: "null", triage: { score: null } },
  ];
  const original = structuredClone(rows);
  assert.deepEqual(orderInboxByFilterScore(rows).map((r) => r.id), ["higher", "lower", "zero", "unscored", "null"]);
  assert.deepEqual(rows, original);
  assert.equal(orderInboxByFilterScore(rows)[0], rows[2], "sorting preserves each original row");
});

test("equal Filter scores use newest posting first, with stable ties and missing dates last", () => {
  const rows = [
    { id: "no-date", triage: { score: 4 } },
    { id: "older", triage: { score: 4 }, postedAt: "2026-11-01" },
    { id: "newer", triage: { score: 4 }, postedAt: "2026-11-16" },
    { id: "same-date", triage: { score: 4 }, postedAt: "2026-11-16" },
  ];
  assert.deepEqual(orderInboxByFilterScore(rows).map((r) => r.id), ["newer", "same-date", "older", "no-date"]);
});

test("invalid scores stay unscored and a new live score reorders the list", () => {
  const rows = [NaN, Infinity, -1, 6, "4.9", null].map((score, id) => ({ id, triage: { score } }));
  const scored = { id: "valid", triage: { score: 4.1 } };
  assert.equal(orderInboxByFilterScore([...rows, scored])[0], scored);
  const updated = { ...rows[0], triage: { score: 4.9 } };
  assert.equal(orderInboxByFilterScore([scored, updated])[0], updated);
  assert.deepEqual(orderInboxByFilterScore([]), []);
});
