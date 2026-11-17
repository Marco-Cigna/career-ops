import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { liveServerSkip } from "../helpers/live-server.mjs";
import { recordTriage } from "../../src/lib/inbox-triage-store.mjs";
import { setInboxSkip } from "../../src/lib/inbox-skip.mjs";

const url = process.env.INBOX_DISCARDED_TEST_URL;
const root = process.env.INBOX_DISCARDED_TEST_ROOT;

test("Discarded shows past and new Filter removals beside tracked discards, with reasons and search", {
  skip: liveServerSkip("INBOX_DISCARDED_TEST_URL", "INBOX_DISCARDED_TEST_ROOT"), timeout: 90_000,
}, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.ok(fs.existsSync(path.join(root, ".discarded-inbox-fixture")));
  const tracker = fs.readFileSync(path.join(root, "data/applications.md"), "utf8");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.request().method() === "GET"
    ? route.continue() : route.fulfill({ status: 400, json: { error: "Fixture blocks writes" } }));
  await page.goto(`${url}/pipeline?tab=DISCARDED`);
  const removed = page.getByRole("region", { name: "Jobs removed by Filter" });
  await removed.waitFor();
  assert.equal(await removed.getByRole("listitem").count(), 4);
  assert.equal(await page.getByRole("button", { name: "DISCARDED 5", exact: true }).count(), 1);
  assert.equal(await page.getByRole("table", { name: "Tracked applications" }).getByText("Fixture Tracked", { exact: true }).count(), 1);
  assert.equal(await removed.getByText(/Fixture Tracked|Fixture Manual|Fixture Unreadable|Fixture Scored/).count(), 0);
  assert.match(await removed.innerText(), /Requires 6\+ years/);
  assert.match(await removed.innerText(), /Posting closed/);
  assert.match(await removed.innerText(), /Triage 3\.2\/5/);
  assert.equal(await removed.getByRole("link", { name: "Fixture Low · Engineer" }).getAttribute("href"), "https://example.test/low");

  const search = page.getByRole("searchbox", { name: "Search applications" });
  await search.fill("6+ years");
  await removed.getByRole("listitem").filter({ hasText: "Fixture Rule" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Jobs removed by Filter"] li').length === 1);
  assert.equal(await page.getByText("No matches", { exact: true }).count(), 0);
  await search.fill("");
  await page.goto(`${url}/pipeline?tab=DISCARDED&min=3`);
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Jobs removed by Filter"] li').length === 1);
  assert.match(await removed.innerText(), /Fixture Marginal/);

  // Use the same persistence functions the Filter gate uses, then re-read the page.
  await recordTriage(root, "https://example.test/pending", {
    verdict: "FAIL", score: 2.2, reason: "New filter removal", model: "fixture", at: "2026-11-17T01:00:00Z",
  });
  assert.equal((await setInboxSkip(path.join(root, "data/pipeline.md"), "https://example.test/pending", true)).ok, true);
  await page.goto(`${url}/pipeline?tab=DISCARDED`);
  await page.getByRole("button", { name: "DISCARDED 6", exact: true }).waitFor();
  assert.equal(await removed.getByRole("listitem").count(), 5);
  assert.match(await removed.getByRole("listitem").first().innerText(), /Fixture Pending/);
  await page.goto(`${url}/pipeline`);
  await page.getByRole("button", { name: "INBOX 1", exact: true }).waitFor();
  assert.equal(fs.readFileSync(path.join(root, "data/applications.md"), "utf8"), tracker);

  // Filter-only users may not have created a tracker yet.
  fs.unlinkSync(path.join(root, "data/applications.md"));
  t.after(() => fs.writeFileSync(path.join(root, "data/applications.md"), tracker));
  await page.goto(`${url}/pipeline?tab=DISCARDED`);
  await removed.waitFor();
  assert.equal(await page.getByText("No applications yet", { exact: true }).count(), 0);
  await search.fill("no-fixture-matches-this");
  await page.getByRole("heading", { name: /No matches for/ }).waitFor();
  assert.equal(await page.getByText("No applications yet", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
  await removed.waitFor();
  assert.deepEqual(errors, []);
});
