import test from "node:test";
import assert from "node:assert/strict";
import { agentPrompt, companyName, discoveryInput, readAgentAnswer, readDiscovery, safeHints } from "../../src/lib/portal-discovery.mjs";

test("a company name keeps real names and refuses shell and prompt characters", () => {
  assert.equal(companyName("  Marks  & Spencer "), "Marks & Spencer");
  assert.equal(companyName("AT&T"), "AT&T");
  for (const bad of ["", "a; rm -rf", "x`y`", "$(id)", "x".repeat(81), 5]) assert.equal(companyName(bad), null);
});

test("hints keep only a safe slug, an origin and a Workday URL", () => {
  assert.deepEqual(safeHints({ slug: "monzo-bank", website: "https://monzo.com/careers?x=1", workday: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/" }),
    { slug: "monzo-bank", website: "https://monzo.com", workday: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" });
  assert.deepEqual(safeHints({ slug: "a b; c", website: "javascript:alert(1)", workday: "https://evil.example/myworkdayjobs.com" }), {});
  assert.deepEqual(safeHints(null), {});
});

test("the input file is one company, as JSON", () => {
  assert.deepEqual(JSON.parse(discoveryInput("Acme", { slug: "acme", extra: "x" })), { companies: [{ name: "Acme", slug: "acme" }] });
});

test("the envelope reads as found, watched, added, unresolved or blacklisted", () => {
  const hit = { name: "Canva", vendor: "smartrecruiters", careers_url: "https://careers.smartrecruiters.com/canva", jobCount: 33 };
  const env = (metadata, extra = {}) => JSON.stringify({ metadata, resolved: [hit], unresolved: [], blacklisted: [], ...extra });
  assert.equal(readDiscovery(env({ duplicatesSkipped: 0, fresh: 1, written: false })).status, "found");
  assert.equal(readDiscovery(env({ duplicatesSkipped: 1, fresh: 0, written: false })).status, "watched");
  const added = readDiscovery(env({ duplicatesSkipped: 0, fresh: 1, freshWritten: 1, written: true }));
  assert.equal(added.status, "added");
  assert.equal(added.board.jobCount, 33);
  assert.deepEqual(readDiscovery(JSON.stringify({ metadata: {}, resolved: [], unresolved: [{ name: "X", reason: "no board" }] })), { status: "unresolved", reason: "no board" });
  assert.equal(readDiscovery(JSON.stringify({ resolved: [], blacklisted: [{ name: "X" }] })).status, "blacklisted");
  assert.equal(readDiscovery("not json").status, "error");
});

test("an agent answer yields validated hints and never a raw write", () => {
  const answer = 'Here you go:\n```json\n{"website":"https://acme.io/about","careers_url":"https://jobs.lever.co/acme","vendor":"Lever","slug":"acme","workday":"","note":"Uses  Lever."}\n```';
  assert.deepEqual(readAgentAnswer(answer), { hints: { slug: "acme", website: "https://acme.io" }, careersUrl: "https://jobs.lever.co/acme", note: "Uses Lever." });
  assert.deepEqual(readAgentAnswer("I could not find it"), { hints: {}, careersUrl: null, note: "" });
});

test("the agent prompt carries the name as quoted data", () => {
  assert.ok(agentPrompt('Ac"me').includes('{"company":"Ac\\"me"}'));
});
