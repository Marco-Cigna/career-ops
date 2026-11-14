import test from "node:test";
import assert from "node:assert/strict";
import { parseAccountList, switchArgs } from "../../src/lib/claude-accounts.mjs";

// The shape `cswap list --json` (schemaVersion 1) prints, trimmed.
const LIST = JSON.stringify({
  schemaVersion: 1,
  activeAccountNumber: 2,
  accounts: [
    { number: 1, email: "one@example.test", active: false, usageStatus: "ok", usage: { fiveHour: { pct: 0 }, sevenDay: { pct: 12.5, resetsAt: "2026-11-21T09:00:00+00:00" } }, plan: { label: "Pro" }, loginExpiresAt: "2026-11-16T08:43:15Z" },
    { number: 2, email: "two@example.test", active: true, usageStatus: "ok", usage: { fiveHour: { pct: 74, resetsAt: "2026-11-14T13:50:00+00:00" }, sevenDay: { pct: 68 } }, plan: { label: "Max" } },
    { number: "3", email: "bad@example.test" },
  ],
});

test("cswap's account list becomes the picker's rows", () => {
  const list = parseAccountList(LIST);
  assert.equal(list.activeNumber, 2);
  assert.deepEqual(list.accounts.map((a) => a.number), [1, 2], "a malformed entry is dropped");
  assert.deepEqual(list.accounts[0], {
    number: 1,
    email: "one@example.test",
    active: false,
    plan: "Pro",
    usageStatus: "ok",
    fiveHour: { pct: 0, resetsAt: null },
    sevenDay: { pct: 12.5, resetsAt: "2026-11-21T09:00:00+00:00" },
    loginExpiresAt: "2026-11-16T08:43:15Z",
  });
  assert.equal(list.accounts[1].active, true);
});

test("output that is not the documented shape is an error, not an empty list", () => {
  assert.throws(() => parseAccountList("{}"));
  assert.throws(() => parseAccountList("not json"));
});

test("only a listed account number, or best, reaches the cswap command line", () => {
  assert.deepEqual(switchArgs(1, [1, 2]), ["switch", "1", "--json"]);
  assert.deepEqual(switchArgs("2", [1, 2]), ["switch", "2", "--json"]);
  assert.deepEqual(switchArgs("best", [1, 2]), ["switch", "--strategy", "best", "--json"]);
  assert.equal(switchArgs(3, [1, 2]), null);
  assert.equal(switchArgs("1 --force", [1, 2]), null);
  assert.equal(switchArgs("one@example.test", [1, 2]), null);
  assert.equal(switchArgs(null, [1, 2]), null);
});
