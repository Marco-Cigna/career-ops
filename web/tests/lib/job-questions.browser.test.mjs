import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.JOB_QUESTIONS_TEST_URL;

test("portal questions generate, edit, copy and persist per posting, including failed generation", {
  skip: liveServerSkip("JOB_QUESTIONS_TEST_URL"), timeout: 120_000,
}, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const generations = [];
  let failGeneration = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("career-ops:config", JSON.stringify({ mode: "cli", cliId: "codex", logos: false })));
  // Only question saves may write to this disposable fixture. Model work is
  // replaced below; persistence still goes through the real HTTP route.
  await page.route("**/api/**", (route) => route.request().method() === "GET" || /\/api\/job-questions\/\d+$/.test(new URL(route.request().url()).pathname)
    ? route.continue() : route.fulfill({ status: 400, json: { error: "Fixture blocks writes" } }));
  await page.route("**/api/clis", (route) => route.fulfill({ json: { clis: [{ id: "codex", installed: true }] } }));
  await page.route("**/api/job-questions/*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    generations.push(body);
    if (failGeneration) return route.fulfill({ status: 502, json: { error: "Fixture generation failed. Your saved questions were kept." } });
    const questions = body.questions.map((q) => !body.ids.includes(q.id) ? q : q.question.includes("notice")
      ? { ...q, answer: "", status: "needs-input", notes: "Please provide your notice period.", evidence: [] }
      : { ...q, answer: "I developed Python reporting tools at Fixture Systems.", status: "draft", notes: "", evidence: [{ source: "cv.md", quote: "Developed Python reporting tools at Fixture Systems." }] });
    const response = await route.fetch({ method: "PUT", postData: JSON.stringify({ version: body.version, questions }) });
    return route.fulfill({ response });
  });

  await page.goto(`${url}/pipeline/11`);
  const section = page.getByRole("region", { name: "Portal questions", exact: true });
  const prompt = section.getByLabel("Portal question", { exact: true });
  const answer = section.getByLabel("Draft answer", { exact: true });
  await prompt.fill("Describe relevant work you have done.");
  await section.getByLabel("Word limit (optional)").fill("150");
  await section.getByRole("button", { name: "Save questions", exact: true }).click();
  await section.getByText(/Saved with this job/).waitFor();
  await page.reload();
  await prompt.waitFor();
  assert.equal(await prompt.inputValue(), "Describe relevant work you have done.");
  assert.equal(await section.getByLabel("Word limit (optional)").inputValue(), "150");

  await section.getByRole("button", { name: "Add question", exact: true }).click();
  await prompt.nth(1).fill("What is your notice period?");
  await section.getByRole("button", { name: "Generate answers", exact: true }).click();
  await section.getByText("Please provide your notice period.", { exact: true }).waitFor();
  assert.equal(await answer.first().inputValue(), "I developed Python reporting tools at Fixture Systems.");
  assert.equal(await answer.nth(1).inputValue(), "");
  assert.equal(generations[0].cliId, "codex");
  await section.getByText("Supporting experience", { exact: true }).click();
  await section.getByText("Developed Python reporting tools at Fixture Systems.", { exact: true }).waitFor();
  await answer.first().fill("I developed reporting tools at Fixture Systems, using Python.");
  await section.getByRole("button", { name: "Save questions", exact: true }).click();
  await section.getByText(/Saved with this job/).waitFor();
  await section.getByRole("button", { name: "Copy answer", exact: true }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "I developed reporting tools at Fixture Systems, using Python.");
  await page.reload();
  await answer.first().waitFor();
  assert.equal(await answer.first().inputValue(), "I developed reporting tools at Fixture Systems, using Python.");
  assert.equal(await prompt.count(), 2);
  assert.equal(await page.getByText("Portal Questions (draft)", { exact: true }).count(), 0, "the editor replaces a duplicate report accordion");

  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.first().focus();
  const box = await prompt.first().boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  await page.goto(`${url}/pipeline/12`);
  await prompt.waitFor();
  assert.equal(await prompt.inputValue(), "", "the second job has no questions from the first");
  failGeneration = true;
  await prompt.fill("Why this particular role?");
  await section.getByRole("button", { name: "Generate answers", exact: true }).click();
  await section.getByRole("alert").filter({ hasText: "Fixture generation failed" }).waitFor();
  await page.reload();
  await prompt.waitFor();
  assert.equal(await prompt.inputValue(), "Why this particular role?");
  assert.equal(await answer.inputValue(), "");
  assert.deepEqual(errors, []);
});
