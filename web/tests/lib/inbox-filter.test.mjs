import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { filterPlan, pipelineSettings, runPipelineGate } from "../../src/lib/pipeline-gate.mjs";
import { readTriageStore, recordTriage, reusablePass, triageEntryFromGate } from "../../src/lib/inbox-triage-store.mjs";
import { runPool } from "../../src/lib/run-pool.mjs";

const READY = "SPEND_TIER=premium\nTRIAGE=auto\nTRIAGE_READY=1";

test("the filter plan forces triage on, unless it is off or the brief is empty", () => {
  const plan = filterPlan("claude", pipelineSettings(READY.replace("premium", "economy")));
  assert.equal(plan.triage, true, "economy would skip triage under auto; pressing Filter asks for it");
  assert.equal(plan.settings.triage, "on");
  assert.equal(filterPlan("claude", pipelineSettings(`${READY}\nTRIAGE=off`)).triage, false);
  assert.match(filterPlan("claude", pipelineSettings(READY.replace("TRIAGE_READY=1", "TRIAGE_READY=0"))).reason, /_brief\.md/);
  assert.match(filterPlan("codex", pipelineSettings(READY)).reason, /triage_model/);
  assert.equal(filterPlan("codex", pipelineSettings(`${READY}\nCODEX_TRIAGE_MODEL=gpt-6-luna`)).model, "gpt-6-luna");
  assert.equal(filterPlan("claude", null).triage, false);
});

const gateDeps = (over = {}) => ({
  url: "https://x.test/job/1",
  jdText: "JD",
  cliId: "claude",
  settings: pipelineSettings(READY),
  discardLog: "unused",
  runCore: async (_s, args) => ({ code: 0, stdout: args.includes("--triage-prompt") ? "PROMPT" : "{}" }),
  writeScratch: (name) => name,
  runTriage: async () => "TRIAGE: PASS | Co | Role | 4.2/5 | strong match",
  ...over,
});

test("the gate returns the triage verdict, and a recent pass is not triaged again", async () => {
  const pass = await runPipelineGate(gateDeps());
  assert.deepEqual(pass.triage, { verdict: "PASS", score: 4.2, reason: "strong match", model: "claude-haiku-5-5" });
  const fail = await runPipelineGate(gateDeps({ runTriage: async () => "TRIAGE: FAIL | Co | Role | 1.5/5 | Java shop" }));
  assert.equal(fail.skip, true);
  assert.equal(fail.triage.verdict, "FAIL");
  let called = false;
  const reused = await runPipelineGate(gateDeps({ priorPass: { score: 4.2, model: "m" }, runTriage: async () => { called = true; return ""; } }));
  assert.equal(called, false);
  assert.equal(reused.skip, false);
  assert.ok(reused.notes.some((n) => /passed earlier \(4\.2\/5\)/.test(n)));
});

test("store entries follow the gate: rules skips, triage verdicts, nothing for a failed gate", () => {
  const at = "2026-11-14T00:00:00.000Z";
  assert.equal(triageEntryFromGate({ skip: true, stage: "prescreen", reason: "years", notes: [] }, at).verdict, "SKIP_RULES");
  assert.equal(triageEntryFromGate({ skip: false, notes: [], triage: { verdict: "PASS", score: 4, reason: "ok", model: "m" } }, at).score, 4);
  assert.equal(triageEntryFromGate({ skip: false, notes: ["The cost gate failed"] }, at), null);
});

test("parallel writes keep every entry, and only a recent PASS is reused", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-triage-store-"));
  try {
    const at = new Date().toISOString();
    await Promise.all(Array.from({ length: 12 }, (_, i) => recordTriage(root, `https://x.test/${i}`, { verdict: "PASS", score: 4, reason: "", model: "m", at })));
    assert.equal(Object.keys(readTriageStore(root)).length, 12);
    const now = Date.parse(at);
    assert.ok(reusablePass(readTriageStore(root)["https://x.test/3"], now));
    assert.equal(reusablePass({ verdict: "FAIL", score: 1, reason: "", model: null, at }, now), null);
    assert.equal(reusablePass({ verdict: "PASS", score: 4, reason: "", model: null, at: "2026-01-01T00:00:00Z" }, now), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the pool never runs more than its limit and stops starting work on abort", async () => {
  let active = 0;
  let peak = 0;
  const seen = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 2));
    seen.push(n);
    active -= 1;
  });
  assert.equal(peak, 3);
  assert.equal(seen.length, 7);
  const controller = new AbortController();
  const ran = [];
  await runPool([1, 2, 3, 4], 1, async (n) => { ran.push(n); if (n === 2) controller.abort(); }, controller.signal);
  assert.deepEqual(ran, [1, 2]);
});
