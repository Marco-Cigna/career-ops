import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.INBOX_FILTER_SCORE_TEST_URL;

test("Filter score sorts All and Passed views and updates after filtering, on desktop and mobile", {
  skip: liveServerSkip("INBOX_FILTER_SCORE_TEST_URL"), timeout: 90_000,
}, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const runs = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("career-ops:config", JSON.stringify({ mode: "cli", cliId: "codex", logos: false })));
  await page.route("**/api/**", (route) => route.request().method() === "GET"
    ? route.continue() : route.fulfill({ status: 400, json: { error: "Fixture blocks writes" } }));
  await page.route("**/api/clis", (route) => route.fulfill({ json: { clis: [{ id: "codex", installed: true }] } }));
  await page.route("**/api/inbox/filter**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: {
      cliId: "codex", cliName: "Codex", triage: true, model: "fixture", effort: "high", reason: null,
    } });
    const input = route.request().postDataJSON();
    runs.push(input);
    return route.fulfill({ json: input.url.endsWith("/unknown")
      ? { outcome: "passed", score: 4.9, reason: "New live score" }
      : { outcome: "unchecked", reason: "Unreadable fixture" } });
  });

  const rows = page.locator("[data-triage-index]");
  const companies = () => rows.locator('input[type="checkbox"]').evaluateAll((inputs) =>
    inputs.map((input) => input.getAttribute("aria-label").replace(/^Select Fixture /, "").replace(/ Engineer$/, "")));
  await page.goto(`${url}/pipeline`);
  const sort = page.getByRole("group", { name: "Sort inbox", exact: true });
  const button = sort.getByRole("button", { name: "Filter score", exact: true });
  await button.click();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await companies(), ["High", "Tie", "Middle", "Zero", "Unknown", "Unreadable"]);

  await page.getByRole("button", { name: "Passed filter (4)", exact: true }).click();
  assert.deepEqual(await companies(), ["High", "Tie", "Middle", "Zero"]);
  await sort.getByRole("button", { name: "Newest", exact: true }).click();
  assert.equal(await button.getAttribute("aria-pressed"), "false");
  await button.click();
  assert.deepEqual(await companies(), ["High", "Tie", "Middle", "Zero"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await button.focus();
  await page.keyboard.press("Enter");
  const box = await button.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "sort button fits a mobile viewport");

  await page.getByRole("button", { name: /^Filter \d+$/ }).click();
  await page.getByRole("button", { name: "Filter now", exact: true }).click();
  await page.getByRole("button", { name: "Passed filter (5)", exact: true }).waitFor();
  assert.deepEqual(await companies(), ["Unknown", "High", "Tie", "Middle", "Zero"]);
  assert.equal(runs.length, 2);
  assert.deepEqual(errors, []);
});
