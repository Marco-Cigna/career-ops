import test from "node:test";
import assert from "node:assert/strict";
import { isStale, outputTail, parseLocalTools, resolveStep, timeAgo } from "../../src/lib/local-tools.mjs";

const CONFIG = `
tools:
  - id: job-sync
    label: Sync job applications
    description: LinkedIn, SEEK and Gmail
    steps:
      - run: ["C:/Python/python.exe", "tracker.py"]
        cwd: "C:/Jobs"
      - run: ["node", "{data_root}/scripts/sync.mjs", "--code-root", "{code_root}"]
    timeout_minutes: 20
    stale_after_hours: 24
    wait_for_closed: ["C:/Jobs/tracker.xlsx"]
`;

test("a valid tool parses with its steps, limits and waits", () => {
  const { tools, problems } = parseLocalTools(CONFIG);
  assert.deepEqual(problems, []);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0], {
    id: "job-sync",
    label: "Sync job applications",
    description: "LinkedIn, SEEK and Gmail",
    steps: [
      { run: ["C:/Python/python.exe", "tracker.py"], cwd: "C:/Jobs" },
      { run: ["node", "{data_root}/scripts/sync.mjs", "--code-root", "{code_root}"], cwd: null },
    ],
    timeoutMs: 20 * 60_000,
    staleAfterHours: 24,
    waitForClosed: ["C:/Jobs/tracker.xlsx"],
  });
});

test("a bad entry is reported and skipped, the others still load", () => {
  const { tools, problems } = parseLocalTools(`
tools:
  - id: "Bad Id"
    steps: [{ run: ["x"] }]
  - id: ok
    steps: [{ run: ["x"] }]
  - id: ok
    steps: [{ run: ["y"] }]
  - id: nostep
    steps: []
  - id: shell
    steps: [{ run: "rm -rf /" }]
`);
  assert.deepEqual(tools.map((t) => t.id), ["ok"]);
  assert.equal(problems.length, 4);
  assert.deepEqual(parseLocalTools("tools: [").tools, []);
  assert.match(parseLocalTools("tools: [").problems[0], /not valid YAML/);
  assert.deepEqual(parseLocalTools(""), { tools: [], problems: [] });
});

test("the time limit is clamped", () => {
  const one = (m) => parseLocalTools(`tools:\n  - id: t\n    steps: [{ run: ["x"] }]\n    timeout_minutes: ${m}\n`).tools[0].timeoutMs;
  assert.equal(one(0), 60_000);
  assert.equal(one(999), 120 * 60_000);
});

test("placeholders expand and node is the running node; arguments stay separate", () => {
  const { tools } = parseLocalTools(CONFIG);
  const roots = { dataRoot: "D:/data", codeRoot: "D:/code", nodePath: "C:/node.exe" };
  assert.deepEqual(resolveStep(tools[0].steps[1], roots), { command: "C:/node.exe", args: ["D:/data/scripts/sync.mjs", "--code-root", "D:/code"], cwd: null });
  assert.deepEqual(resolveStep(tools[0].steps[0], roots), { command: "C:/Python/python.exe", args: ["tracker.py"], cwd: "C:/Jobs" });
});

test("last-run wording and staleness", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(timeAgo(null, now), "never");
  assert.equal(timeAgo("2026-11-12T11:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-11-12T11:48:00Z", now), "12 min ago");
  assert.equal(timeAgo("2026-11-12T09:00:00Z", now), "3 h ago");
  assert.equal(timeAgo("2026-11-09T12:00:00Z", now), "3 days ago");
  assert.equal(isStale("2026-11-12T09:00:00Z", 24, now), false);
  assert.equal(isStale("2026-11-10T09:00:00Z", 24, now), true);
  assert.equal(isStale(null, 24, now), true);
  assert.equal(isStale(null, null, now), false);
});

test("output keeps the end and drops terminal colour codes", () => {
  assert.equal(outputTail("\u001b[32mok\u001b[0m\r\n"), "ok\n");
  assert.equal(outputTail("x".repeat(10), 4), "…xxxx");
});
