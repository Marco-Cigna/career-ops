// Disposable fictional inbox; all model calls and writes are intercepted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CONFIG_CLI_TEST_URL;

test("CLI selection saves on click and Filter previews and runs the selected model", {
  skip: liveServerSkip("CONFIG_CLI_TEST_URL"), timeout: 90_000,
}, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  const runs = [];
  const previews = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.request().method() === "GET"
    ? route.continue() : route.fulfill({ status: 400, json: { error: "Fixture blocks writes" } }));
  await page.route("**/api/clis", (route) => route.fulfill({ json: {
    remembered: "claude",
    clis: [
      { id: "claude", name: "Claude Code", run: "claude -p", installed: true },
      { id: "codex", name: "Codex", run: "codex exec", installed: true },
    ],
  } }));
  await page.route("**/api/inbox/filter**", (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      runs.push(request.postDataJSON());
      return route.fulfill({ json: { outcome: "passed", score: 4, reason: "Fixture" } });
    }
    const cliId = new URL(request.url()).searchParams.get("cliId");
    previews.push(cliId);
    return route.fulfill({ json: {
      cliId, cliName: cliId === "codex" ? "Codex" : "Claude Code", triage: true,
      model: cliId === "codex" ? "gpt-6-luna" : "claude-haiku-5-5",
      effort: cliId === "codex" ? "high" : "medium", reason: null,
    } });
  });

  await page.goto(`${url}/config`);
  const codex = page.getByRole("button", { name: /Codex.*codex exec/ });
  await codex.click();
  assert.equal(await codex.getAttribute("aria-pressed"), "true");
  // No Save config click: leaving the page must keep the chosen tool.
  await page.goto(`${url}/pipeline`);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:config")).cliId), "codex");
  await page.getByRole("button", { name: /^Filter \d+$/ }).click();
  await page.getByText(/gpt-6-luna/).waitFor();
  assert.match(await page.getByText(/A quick triage/).innerText(), /gpt-6-luna \(high\) via Codex/);
  assert.deepEqual(previews, ["codex"]);

  // A change from another Config tab invalidates the old confirmation.
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "career-ops:config" })));
  await page.getByRole("button", { name: /^Filter \d+$/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Filter now", exact: true }).count(), 0);
  await page.getByRole("button", { name: /^Filter \d+$/ }).click();
  await page.getByRole("button", { name: "Filter now", exact: true }).click();
  await page.getByText(/2 removed|2 passed/).first().waitFor();
  assert.equal(runs.length, 2);
  assert.ok(runs.every((run) => run.cliId === "codex"));

  await page.goto(`${url}/config`);
  assert.equal(await page.getByRole("button", { name: /Codex.*codex exec/ }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: /Claude Code.*claude -p/ }).click();
  await page.reload();
  assert.equal(await page.getByRole("button", { name: /Claude Code.*claude -p/ }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(errors, []);
});
