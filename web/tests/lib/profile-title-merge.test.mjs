import test from "node:test";
import assert from "node:assert/strict";
import { mergeTargetTitles } from "../../src/lib/profile-patch.mjs";
import { appendPortalTitlesText } from "../../src/lib/portals-config.mjs";
import * as yaml from "js-yaml";

test("the assistant's titles are added to the profile, never replace it, with no cap", () => {
  const ten = Array.from({ length: 10 }, (_, i) => `Role ${i}`);
  const merged = mergeTargetTitles(ten, ["role 3", "Data Analyst", " ", "Data Analyst"]);
  assert.deepEqual(merged, [...ten, "Data Analyst"]);
  assert.deepEqual(mergeTargetTitles(undefined, ["A"]), ["A"]);
});

const PORTALS = `# my scanner
title_filter:
  positive:
    # -- Automation --
    - "Automation Engineer"
    - "energy + analyst"   # combo
    # trailing note
  negative:
    - "Junior"
location_filter:
  allow:
    - "Sydney"
    - "Copenhagen"
tracked_companies: []
`;

test("adding scanner titles keeps every other line, the location filter included", () => {
  const r = appendPortalTitlesText(PORTALS, ["automation engineer", "Data Analyst"]);
  assert.deepEqual(r.added, ["Data Analyst"]);
  const doc = yaml.load(r.text);
  assert.deepEqual(doc.title_filter.positive, ["Automation Engineer", "energy + analyst", "Data Analyst"]);
  assert.deepEqual(doc.location_filter.allow, ["Sydney", "Copenhagen"]);
  for (const line of PORTALS.split("\n")) assert.ok(r.text.includes(line), `kept: ${line}`);
});

test("nothing new means no change, and an unplaceable list is refused", () => {
  assert.equal(appendPortalTitlesText(PORTALS, ["Automation Engineer"]).text, PORTALS);
  assert.equal(appendPortalTitlesText("title_filter:\n  positive: [a, b]\n", ["c"]), null);
  assert.equal(appendPortalTitlesText("location_filter: {}\n", ["c"]), null);
});
