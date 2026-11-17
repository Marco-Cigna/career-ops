import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "codex", name: "Codex" }, binPath: "fixture-codex" });`;
const spawnStub = `import fs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
export function spawnHeadlessCli(bin, args, options, fencing, io) {
  globalThis.__questionCall = { bin, args, options, fencing, prompt: io.input };
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
  setTimeout(() => {
    fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], globalThis.__questionReply ?? "");
    child.stdout.end(); child.stderr.end(); child.emit("close", 0);
  }, 5);
  return child;
}`;
register(`data:text/javascript,${encodeURIComponent(`export function resolve(specifier, context, nextResolve) {
  const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub })};
  if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  return nextResolve(specifier, context);
}`)}`, import.meta.url);
const { GET, PUT, POST } = await import("../../src/app/api/job-questions/[n]/route.ts");
const { questionSources } = await import("../../src/lib/job-questions-server.ts");
const { parsePortalQuestionsSection } = await import("../../../application-answers.mjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-job-questions-"));
  const previous = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  for (const dir of ["data", "reports", "config", "modes", "interview-prep", "documents"]) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, "cv.md"), "Developed Python reporting tools at Fixture Systems in 2015.\n");
  fs.writeFileSync(path.join(root, "config/profile.yml"), "language:\n  output: en\n");
  fs.writeFileSync(path.join(root, "modes/_custom.md"), "Use Australian English.\n");
  fs.writeFileSync(path.join(root, "interview-prep/story-bank.md"), "Unverified: managed 15 people.\n");
  fs.writeFileSync(path.join(root, "documents/private.txt"), "OUT-OF-SCOPE-DOCUMENT");
  fs.writeFileSync(path.join(root, "data/applications.md"), `| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
|---|---|---|---|---|---|---|---|---|---|
| 11 | 2026-11-16 | Fixture Alpha | Engineer | 4.2/5 | Evaluated | — | [21](../reports/021-alpha.md) | | [posting](https://example.test/alpha) |
| 12 | 2026-11-16 | Fixture Beta | Analyst | 3.8/5 | Evaluated | — | [22](../reports/022-beta.md) | | [posting](https://example.test/beta) |
`);
  const report = "# Evaluation\n\n## B) CV Match\nUNVERIFIED-CANDIDATE-CLAIM-FROM-REPORT\n\n## Job Description (archived verbatim)\nBuild Python tools at Fixture Alpha.\n\n## Application Answers\nExisting submitted answer snapshot.\n";
  fs.writeFileSync(path.join(root, "reports/021-alpha.md"), report);
  fs.writeFileSync(path.join(root, "reports/022-beta.md"), "# Another posting, never change this.\n");
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    delete globalThis.__questionCall; delete globalThis.__questionReply;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, report };
}
const question = { id: "q1", question: "What relevant work have you done?", answer: "", maxWords: null };
async function call(method, n = "11", body) {
  const request = new Request(`http://fixture.invalid/api/job-questions/${n}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const response = await ({ GET, PUT, POST }[method])(request, { params: Promise.resolve({ n }) });
  return { status: response.status, data: await response.json() };
}

test("questions save to the row's linked report even when report and tracker numbers differ", async (t) => {
  const { root, report } = fixture(t);
  const start = await call("GET");
  assert.equal(start.status, 200); assert.deepEqual(start.data.questions, []);
  const saved = await call("PUT", "11", { version: start.data.version, questions: [question] });
  assert.equal(saved.status, 200);
  const text = fs.readFileSync(path.join(root, "reports/021-alpha.md"), "utf8");
  assert.ok(text.startsWith(report));
  assert.equal(parsePortalQuestionsSection(text).questions[0].question, question.question);
  assert.equal(fs.readFileSync(path.join(root, "reports/022-beta.md"), "utf8"), "# Another posting, never change this.\n");
  assert.equal((await call("GET")).data.questions[0].question, question.question);
  assert.equal((await call("GET", "12")).data.questions.length, 0);
  const stale = await call("PUT", "11", { version: start.data.version, questions: [] });
  assert.equal(stale.status, 409); assert.equal(fs.readFileSync(path.join(root, "reports/021-alpha.md"), "utf8"), text);
});

test("generation uses primary evidence, isolates the CLI, and automatically saves the draft to this job", async (t) => {
  const { root } = fixture(t);
  const start = await call("GET");
  const saved = await call("PUT", "11", { version: start.data.version, questions: [question] });
  globalThis.__questionReply = JSON.stringify({ answers: [{ id: "q1", answer: "I developed Python reporting tools at Fixture Systems.", needsInput: false, notes: "", evidence: [{ source: "cv.md", quote: "Developed Python reporting tools at Fixture Systems" }] }] });
  const generated = await call("POST", "11", { ...saved.data, ids: ["q1"], cliId: "codex" });
  assert.equal(generated.status, 200, JSON.stringify(generated.data));
  assert.equal(generated.data.questions[0].status, "draft");
  assert.match((await call("GET")).data.questions[0].answer, /Python reporting/);
  const worker = globalThis.__questionCall;
  assert.deepEqual(worker.fencing.capabilities, { writes: false, network: false });
  assert.notEqual(worker.options.cwd, root);
  assert.ok(worker.args.includes("--ignore-user-config"));
  assert.ok(worker.args.includes("--skip-git-repo-check"));
  assert.match(worker.prompt, /Use Australian English/);
  assert.doesNotMatch(worker.prompt, /OUT-OF-SCOPE-DOCUMENT|UNVERIFIED-CANDIDATE-CLAIM-FROM-REPORT/);
  assert.match(worker.prompt, /DERIVED NOTES \(narrative only\)/);
  assert.equal((await call("GET", "12")).data.questions.length, 0);
  assert.equal(questionSources().primary["documents/private.txt"], undefined);
});

test("invalid model output and unsupported facts preserve the saved questions", async (t) => {
  fixture(t);
  const start = await call("GET");
  const saved = await call("PUT", "11", { version: start.data.version, questions: [question] });
  globalThis.__questionReply = "not JSON";
  const failed = await call("POST", "11", { ...saved.data, ids: ["q1"], cliId: "codex" });
  assert.ok(failed.status >= 400);
  assert.deepEqual((await call("GET")).data.questions, saved.data.questions);
  globalThis.__questionReply = JSON.stringify({ answers: [{ id: "q1", answer: "I managed 15 people.", needsInput: false, notes: "", evidence: [{ source: "cv.md", quote: "Developed Python reporting tools at Fixture Systems" }] }] });
  const blocked = await call("POST", "11", { ...saved.data, ids: ["q1"], cliId: "codex" });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.data.questions[0].answer, "");
  assert.equal(blocked.data.questions[0].status, "needs-input");
});

test("bad job IDs and malformed request bodies are rejected before generation", async (t) => {
  fixture(t);
  assert.equal((await call("GET", "../11")).status, 404);
  assert.equal((await call("GET", "999")).status, 404);
  const start = await call("GET");
  assert.equal((await call("PUT", "11", { version: start.data.version, questions: [question, question] })).status, 400);
  assert.equal(globalThis.__questionCall, undefined);
});

test("an unlinked report-number fallback cannot receive questions for a different tracker row", async (t) => {
  const { root } = fixture(t);
  const tracker = path.join(root, "data/applications.md");
  fs.writeFileSync(tracker, fs.readFileSync(tracker, "utf8").replace("[21](../reports/021-alpha.md)", "—"));
  fs.writeFileSync(path.join(root, "reports/011-unrelated.md"), "# A different posting with a matching number\n");
  assert.equal((await call("GET", "11")).status, 404);
  assert.equal((await call("PUT", "11", { version: "anything", questions: [question] })).status, 404);
  assert.equal(fs.readFileSync(path.join(root, "reports/011-unrelated.md"), "utf8"), "# A different posting with a matching number\n");
});
