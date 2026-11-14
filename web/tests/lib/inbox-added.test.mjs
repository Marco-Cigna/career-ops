import test from "node:test";
import assert from "node:assert/strict";
import { addedLabel, addedViaLabel, parseScanOrigins } from "../../src/lib/inbox-added.mjs";

test("scan-history gives each url its first sighting and source", () => {
  const origins = parseScanOrigins([
    "url\tfirst_seen\tportal\ttitle\tcompany\tstatus",
    "https://a.test/1\t2026-11-14\tworkday-api\tEngineer\tA\tadded",
    "https://a.test/1\t2026-11-15\tashby-full\tEngineer\tA\tadded",
    "https://b.test/2\tnot-a-date\tlever-api",
    "https://c.test/3\t2026-11-01\tashby-full\r",
    "",
  ]);
  assert.deepEqual(origins.get("https://a.test/1"), { date: "2026-11-14", portal: "workday-api" }, "the first row wins");
  assert.equal(origins.has("https://b.test/2"), false);
  assert.deepEqual(origins.get("https://c.test/3"), { date: "2026-11-01", portal: "ashby-full" });
});

test("the source reads as the scan that found it", () => {
  assert.equal(addedViaLabel("workday-api"), "Saved companies");
  assert.equal(addedViaLabel("ashby-full"), "All job boards");
  assert.equal(addedViaLabel("manual"), "Added by hand");
  assert.equal(addedViaLabel(""), "");
  assert.equal(addedViaLabel(undefined), "");
});

test("the added date is today, yesterday, or a short fixed-format date", () => {
  const now = new Date(2026, 10, 14, 21, 0).getTime();
  assert.equal(addedLabel("2026-11-14", now), "today");
  assert.equal(addedLabel("2026-11-13", now), "yesterday");
  assert.equal(addedLabel("2026-11-01", now), "1 Nov");
  assert.equal(addedLabel("2025-12-30", now), "30 Dec 2025");
  assert.equal(addedLabel(undefined, now), "");
  assert.equal(addedLabel("14/11/2026", now), "");
});
