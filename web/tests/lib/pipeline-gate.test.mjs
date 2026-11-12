import test from "node:test";
import assert from "node:assert/strict";
import { TIER_MODELS, modelForRun, parseTriage, pipelineSettings, runPipelineGate, triageEnabled } from "../../src/lib/pipeline-gate.mjs";
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
  assert.deepEqual(settings, { spendTier: "standard", parallel: 1, triage: "auto", triageReady: true });
  assert.deepEqual(pipelineSettings(""), { spendTier: "standard", parallel: null, triage: "auto", triageReady: false });
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

test("the company-search argv reaches the web and nothing else", () => {
  const args = claudeWebSearchArgs({ prompt: "p", model: TIER_MODELS.economy });
  assert.equal(argValue(args, "--allowedTools"), "WebFetch,WebSearch");
  assert.doesNotThrow(() => verifyClaudeArgs(args, { writes: false, network: "fetch" }));
});
