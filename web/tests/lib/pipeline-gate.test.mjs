import test from "node:test";
import assert from "node:assert/strict";
import { TIER_MODELS, effortForRun, modelForRun, parseTriage, pipelineSettings, runPipelineGate, triageEnabled } from "../../src/lib/pipeline-gate.mjs";
import { claudeCliArgs, claudeTriageArgs, claudeWebSearchArgs, verifyClaudeArgs, argValue } from "../../src/lib/claude-invocation.mjs";
import { createRunQueue } from "../../src/lib/run-queue.mjs";

const CONFIG = "PARALLEL=1\nTRIAGE=auto\nTRIAGE_THRESHOLD=3.5\nTRIAGE_READY=1\nMAX_YEARS=5\nSPEND_TIER=standard\n";
const settings = pipelineSettings(CONFIG);

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    url: "https://example.com/job/1",
    jdText: "A job description",
    cliId: "claude",
    settings,
    discardLog: "/data/discard.log",
    writeScratch: (name) => `/scratch/${name}`,
    runCore: async (script, args) => {
      calls.push(args);
      if (args.includes("--triage-prompt")) return { code: 0, stdout: "PROMPT" };
      return { code: 0, stdout: "{}" };
    },
    runTriage: async () => "TRIAGE: PASS | Acme | Engineer | 4.1/5 | strong fit",
    ...overrides,
  };
}

test("settings read the spend tier, parallel limit and triage switches", () => {
  assert.deepEqual(settings, { spendTier: "standard", parallel: 1, triage: "auto", triageReady: true, triageEffort: null, effort: null });
  assert.deepEqual(pipelineSettings(""), { spendTier: "standard", parallel: null, triage: "auto", triageReady: false, triageEffort: null, effort: null });
});

test("pipeline effort settings reach the claude argv, and only valid levels do", () => {
  const withEffort = pipelineSettings("SPEND_TIER=premium\nTRIAGE_EFFORT=medium\nEFFORT=high");
  assert.equal(withEffort.triageEffort, "medium");
  assert.equal(effortForRun("claude", withEffort), "high");
  assert.equal(effortForRun("codex", withEffort), null);
  assert.equal(pipelineSettings("EFFORT=extreme\nTRIAGE_EFFORT=").effort, null);
  assert.equal(pipelineSettings("EFFORT=extreme\nTRIAGE_EFFORT=").triageEffort, null);
  assert.equal(argValue(claudeCliArgs({ kind: "evaluate", prompt: "p", model: "m", effort: "medium" }), "--effort"), "medium");
  assert.equal(claudeCliArgs({ kind: "evaluate", prompt: "p", model: "m" }).includes("--effort"), false);
  assert.equal(argValue(claudeTriageArgs({ model: TIER_MODELS.economy, effort: "medium" }), "--effort"), "medium");
  assert.equal(claudeTriageArgs({ model: TIER_MODELS.economy }).includes("--effort"), false);
});

test("triage uses the split prompt when the core offers it, and the one-message prompt otherwise", async () => {
  const split = [];
  await runPipelineGate(deps({
    runCore: async (_s, args) => {
      if (args.includes("--triage-system-file")) return { code: 0, stdout: "C:/Temp/career-ops-triage/system-0123456789abcdef.md\n" };
      if (args.includes("--triage-user")) return { code: 0, stdout: "JD ONLY" };
      return { code: 0, stdout: "{}" };
    },
    runTriage: async (prompt, _m, _e, systemFile) => { split.push({ prompt, systemFile }); return "TRIAGE: PASS | A | B | 4/5 | ok"; },
  }));
  assert.deepEqual(split, [{ prompt: "JD ONLY", systemFile: "C:/Temp/career-ops-triage/system-0123456789abcdef.md" }]);

  // An older core answers the unknown flag with junk: fall back, no system file.
  const old = [];
  await runPipelineGate(deps({ runTriage: async (prompt, _m, _e, systemFile) => { old.push({ prompt, systemFile }); return "TRIAGE: PASS | A | B | 4/5 | ok"; } }));
  assert.deepEqual(old, [{ prompt: "PROMPT", systemFile: null }]);
  assert.equal(argValue(claudeTriageArgs({ model: "m", systemPromptFile: "/t/s.md" }), "--append-system-prompt-file"), "/t/s.md");
});

test("the gate hands the triage effort to the triage call", async () => {
  const calls = [];
  await runPipelineGate({
    url: "https://x.test/job/1",
    jdText: "JD",
    cliId: "claude",
    settings: { ...pipelineSettings("SPEND_TIER=standard\nTRIAGE_READY=1\nTRIAGE_EFFORT=medium"), triage: "on" },
    discardLog: "unused",
    runCore: async (_script, args) => ({ code: 0, stdout: args.includes("--triage-prompt") ? "PROMPT" : "{}" }),
    writeScratch: (name) => name,
    runTriage: async (prompt, model, effort) => { calls.push({ model, effort }); return "TRIAGE: PASS | Co | Role | 4/5 | ok"; },
  });
  assert.deepEqual(calls, [{ model: TIER_MODELS.economy, effort: "medium" }]);
});

test("the spend tier picks the claude model and leaves other CLIs alone", () => {
  assert.equal(modelForRun("claude", settings), TIER_MODELS.standard);
  assert.equal(modelForRun("claude", pipelineSettings("SPEND_TIER=premium")), TIER_MODELS.premium);
  assert.equal(modelForRun("codex", settings), null);
  assert.equal(modelForRun("claude", null), null);
  assert.equal(argValue(claudeCliArgs({ kind: "evaluate", prompt: "p", model: "m" }), "--model"), "m");
  assert.equal(claudeCliArgs({ kind: "evaluate", prompt: "p" }).includes("--model"), false);
});

test("triage runs for claude above the economy tier with a filled-in brief", () => {
  assert.equal(triageEnabled("claude", settings), true);
  assert.equal(triageEnabled("codex", settings), false);
  assert.equal(triageEnabled("claude", pipelineSettings("SPEND_TIER=economy\nTRIAGE_READY=1")), false);
  assert.equal(triageEnabled("claude", pipelineSettings("SPEND_TIER=economy\nTRIAGE=on\nTRIAGE_READY=1")), true);
  assert.equal(triageEnabled("claude", pipelineSettings("TRIAGE=off\nTRIAGE_READY=1")), false);
  assert.equal(triageEnabled("claude", pipelineSettings("TRIAGE_READY=0")), false);
});

test("the triage argv has no tools, no MCP servers, and passes the fencing check", () => {
  const args = claudeTriageArgs({ model: TIER_MODELS.economy });
  assert.equal(argValue(args, "--tools"), "");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.doesNotThrow(() => verifyClaudeArgs(args, { writes: false, network: false }));
});

test("a rule skip stops before any model call", async () => {
  let triaged = false;
  const d = deps({
    runCore: async () => ({ code: 2, stdout: JSON.stringify({ reason: "years: asks 8+ years" }) }),
    runTriage: async () => { triaged = true; return ""; },
  });
  const result = await runPipelineGate(d);
  assert.deepEqual({ skip: result.skip, stage: result.stage, reason: result.reason }, { skip: true, stage: "prescreen", reason: "years: asks 8+ years" });
  assert.equal(triaged, false);
});

test("triage FAIL and MARGINAL skip; PASS continues", async () => {
  for (const verdict of ["FAIL", "MARGINAL"]) {
    const result = await runPipelineGate(deps({ runTriage: async () => `TRIAGE: ${verdict} | Acme | Engineer | 2.4/5 | JVM stack` }));
    assert.equal(result.skip, true);
    assert.equal(result.stage, "triage");
    assert.match(result.reason, new RegExp(`triage ${verdict} 2\.4/5: JVM stack`));
  }
  assert.equal((await runPipelineGate(deps())).skip, false);
});

test("the JD reaches prescreen as a file, and the discard log is passed", async () => {
  const d = deps();
  await runPipelineGate(d);
  assert.deepEqual(d.calls[0], ["--input", "/scratch/input.json", "--log", "/data/discard.log", "--json", "--jd-file", "/scratch/jd.txt"]);
});

test("a broken gate never costs a job", async () => {
  const cases = [
    deps({ runCore: async () => ({ code: 1, stdout: "" }) }),
    deps({ runCore: async () => { throw new Error("spawn"); } }),
    deps({ runTriage: async () => "" }),
    deps({ runTriage: async () => { throw new Error("rate limit"); } }),
    deps({ jdText: null }),
    deps({ runTriage: async () => "TRIAGE: SKIP | ? | ? | - | unreadable" }),
  ];
  for (const d of cases) assert.equal((await runPipelineGate(d)).skip, false);
});

test("parseTriage reads the last TRIAGE line through markdown decoration", () => {
  assert.deepEqual(parseTriage("thinking\n**TRIAGE: fail | A | B | 1.5/5 | no**\n"), { verdict: "FAIL", score: 1.5, reason: "no" });
  assert.equal(parseTriage("no verdict here"), null);
});

test("the run queue holds jobs to the limit, in order", async () => {
  const queue = createRunQueue(async () => 1);
  const order = [];
  const job = async (name) => {
    await queue.acquire();
    order.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, 5));
    order.push(`end ${name}`);
    queue.release();
  };
  await Promise.all([job("a"), job("b"), job("c")]);
  assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.equal(queue.active, 0);
});

test("the run queue runs several at once when the limit allows", async () => {
  const queue = createRunQueue(async () => 2);
  let peak = 0;
  const job = async () => {
    await queue.acquire();
    peak = Math.max(peak, queue.active);
    await new Promise((r) => setTimeout(r, 5));
    queue.release();
  };
  await Promise.all([job(), job(), job(), job()]);
  assert.equal(peak, 2);
});

test("on a cold cache the first job runs alone, then the rest start together", async () => {
  let t = 0;
  const timers = [];
  const queue = createRunQueue(async () => 3, { warmupMs: 40_000, now: () => t, schedule: (fn, ms) => timers.push({ fn, at: t + ms }) });
  const started = [];
  const jobs = ["a", "b", "c"].map((n) => queue.acquire().then(() => started.push(n)));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(started, ["a"], "only the first job starts while the cache is primed");
  assert.equal(queue.warmingUp, true);
  t = 40_000;
  timers.shift().fn();
  await Promise.all(jobs);
  assert.deepEqual(started, ["a", "b", "c"]);
});

test("the warm-up ends when the first job finishes, and a warm cache gets none", async () => {
  let t = 0;
  const queue = createRunQueue(async () => 2, { warmupMs: 40_000, now: () => t, schedule: () => 0 });
  await queue.acquire();
  const second = queue.acquire();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(queue.active, 1);
  t = 10_000;
  queue.release(); // first job done: its cache is written
  await second;
  assert.equal(queue.active, 1);
  // A burst a minute later finds the cache warm: both slots fill at once.
  queue.release();
  t = 70_000;
  await Promise.all([queue.acquire(), queue.acquire()]);
  assert.equal(queue.active, 2);
});

test("a limit of 1 never warms up (nothing to hold back)", async () => {
  const queue = createRunQueue(async () => 1, { warmupMs: 40_000 });
  await queue.acquire();
  assert.equal(queue.warmingUp, false);
  queue.release();
});

test("the company-search argv reaches the web and nothing else", () => {
  const args = claudeWebSearchArgs({ prompt: "p", model: TIER_MODELS.economy });
  assert.equal(argValue(args, "--allowedTools"), "WebFetch,WebSearch");
  assert.doesNotThrow(() => verifyClaudeArgs(args, { writes: false, network: "fetch" }));
});
