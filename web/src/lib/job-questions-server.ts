import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { careerOpsRoot, findApplication, findLinkedReportForWrite, isRegularContainedFile, rootScript } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { acquireDirLock } from "@/lib/core/dir-lock.mjs";
import { resolveCliOrFallback } from "@/lib/clis";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";
import { codexTriageArgs } from "@/lib/run-cli-support.mjs";
import { claudeTriageArgs } from "@/lib/claude-invocation.mjs";
import { archivedJobDescription, buildQuestionsPrompt, parseGeneratedAnswers, QUESTION_DRAFT_MODELS, validateQuestions } from "@/lib/job-questions.mjs";
import { compactProfileYaml } from "@/lib/eval-context-pack.mjs";
import { withAnswerStyle } from "@/lib/answer-style-prompt.mjs";

export type PortalQuestion = {
  id: string; question: string; answer: string; maxWords: number | null;
  status: "unanswered" | "draft" | "needs-input" | "edited";
  notes: string; evidence: { source: string; quote: string }[];
};
export type QuestionsSnapshot = { questions: PortalQuestion[]; savedAt: string | null; version: string };
type CoreQuestions = {
  parsePortalQuestionsSection: (text: string) => { questions: PortalQuestion[]; savedAt: string } | null;
  upsertPortalQuestionsSection: (text: string, snapshot: { questions: PortalQuestion[]; savedAt: string }) => string;
};

export class QuestionsError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

async function coreQuestions(): Promise<CoreQuestions> {
  return import(/* turbopackIgnore: true */ pathToFileURL(rootScript("application-answers")).href);
}
const versionOf = (text: string) => createHash("sha256").update(text).digest("hex");

export async function loadJobQuestions(n: string) {
  if (!/^\d+$/.test(n)) throw new QuestionsError("Job not found.", 404);
  const app = findApplication(n);
  const linked = findLinkedReportForWrite(n);
  if (!app || !linked) throw new QuestionsError("This job needs a linked evaluation report before questions can be saved.", 404);
  const file = fs.realpathSync(linked);
  const report = fs.readFileSync(/* turbopackIgnore: true */ file, "utf8");
  const saved = (await coreQuestions()).parsePortalQuestionsSection(report);
  const snapshot: QuestionsSnapshot = {
    questions: validateQuestions(saved?.questions ?? []) as PortalQuestion[],
    savedAt: saved?.savedAt ?? null, version: versionOf(report),
  };
  return { app, file, report, snapshot };
}

export async function saveJobQuestions(n: string, version: unknown, input: unknown): Promise<QuestionsSnapshot> {
  const questions = validateQuestions(input) as PortalQuestion[];
  const initial = await loadJobQuestions(n);
  const lock = await acquireDirLock(initial.file + ".questions.lock", { timeoutMs: 3000, retryMs: 50, staleMs: 60000, maxWaitMs: 3000 });
  try {
    const current = await loadJobQuestions(n);
    if (current.file !== initial.file || typeof version !== "string" || current.snapshot.version !== version) throw new QuestionsError("This job changed in another tab or evaluation. Reload its saved questions before saving again.", 409);
    const savedAt = new Date().toISOString();
    const next = (await coreQuestions()).upsertPortalQuestionsSection(current.report, { questions, savedAt });
    atomicWriteWithBackup(current.file, next);
    return { questions, savedAt, version: versionOf(next) };
  } finally { lock.release(); }
}

function readOptional(file: string): string {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (text.length > 200000) throw new QuestionsError("A candidate source is too large for question drafting.", 422);
    return text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** Explicit source allowlist. Reports supply posting context, never candidate facts. */
export function questionSources() {
  const root = careerOpsRoot();
  const primary: Record<string, string> = {};
  const style: Record<string, string> = {};
  const derived: Record<string, string> = {};
  for (const rel of ["cv.md", "article-digest.md", "modes/_profile.md"]) {
    const file = path.join(root, rel);
    if (isRegularContainedFile(file, root)) primary[rel] = readOptional(file);
  }
  const profile = readOptional(getProfilePath(root));
  if (profile) primary["config/profile.yml"] = compactProfileYaml(profile);
  // _custom is read after _profile and contributes procedures/style only.
  for (const rel of ["modes/_custom.md", "voice-dna.md"]) {
    const file = path.join(root, rel);
    if (isRegularContainedFile(file, root)) style[rel] = readOptional(file);
  }
  const samples = path.join(root, "writing-samples");
  try {
    for (const name of fs.readdirSync(samples).sort()) {
      const file = path.join(samples, name);
      if (/\.(md|txt)$/i.test(name) && !/^readme\./i.test(name) && isRegularContainedFile(file, root)) primary[`writing-samples/${name}`] = readOptional(file);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const bank = path.join(root, "interview-prep/story-bank.md");
  if (isRegularContainedFile(bank, root)) derived["interview-prep/story-bank.md"] = readOptional(bank);
  if (!primary["cv.md"]?.trim()) throw new QuestionsError("Add your CV before generating answers.", 422);
  if (JSON.stringify({ primary, style, derived }).length > 400000) throw new QuestionsError("The candidate context is too large for one drafting request.", 422);
  return { primary, style, derived };
}

/** One isolated, read-only call. Posting questions never become shell commands. */
async function runQuestionDraft(cliId: string, prompt: string, signal: AbortSignal): Promise<string> {
  const resolved = resolveCliOrFallback(cliId);
  if (!resolved || !["claude", "codex"].includes(resolved.spec.id)) throw new QuestionsError("Choose Codex or Claude Code in Config to generate answers.", 422);
  const id = resolved.spec.id;
  // Fixed per CLI, not the pipeline's spend tier (QUESTION_DRAFT_MODELS explains why).
  const { model, effort } = QUESTION_DRAFT_MODELS[id as "claude" | "codex"];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-questions-"));
  const output = path.join(cwd, "answer.txt");
  try {
    // The humanizer-style writing rules: a system prompt on Claude, a preamble on codex.
    const styled = withAnswerStyle(id, prompt);
    let systemPromptFile: string | undefined;
    if (styled.systemPrompt) {
      systemPromptFile = path.join(cwd, "answer-style.md");
      fs.writeFileSync(systemPromptFile, styled.systemPrompt, "utf8");
    }
    const args = id === "codex"
      ? codexTriageArgs({ model, effort, outputFile: output })
      : claudeTriageArgs({ model, effort, systemPromptFile });
    return await new Promise<string>((resolve, reject) => {
      const child = spawnHeadlessCli(resolved.binPath, args, { cwd, env: process.env }, { cliId: id, capabilities: CAPS.localReadOnly }, { input: styled.prompt });
      let out = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error, reply?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(reply ?? "");
      };
      const abort = () => { child.kill(); finish(new QuestionsError("Answer generation was cancelled.", 499)); };
      const timer = setTimeout(() => { child.kill(); finish(new QuestionsError("Answer generation timed out. Your saved questions were kept.", 504)); }, 180000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      child.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        if (out.length > 1000000) { child.kill(); finish(new QuestionsError("The AI response was too large.", 502)); }
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
      child.on("error", (error: Error) => finish(new QuestionsError(`The AI CLI could not start: ${error.message}`, 502)));
      child.on("close", (code) => {
        if (code !== 0) { finish(new QuestionsError(`The AI CLI did not finish. ${stderr.trim().split("\n").at(-1)?.slice(0, 250) ?? "Check its sign-in and try again."}`, 502)); return; }
        try { finish(undefined, id === "codex" ? fs.readFileSync(output, "utf8") : out); }
        catch { finish(new QuestionsError("The AI returned no draft answers. Your questions were kept.", 502)); }
      });
    });
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

export async function generateJobQuestions(n: string, version: unknown, input: unknown, ids: unknown, cliId: unknown, signal: AbortSignal) {
  if (signal.aborted) throw new QuestionsError("Answer generation was cancelled.", 499);
  const questions = validateQuestions(input) as PortalQuestion[];
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !questions.some((q) => q.id === id)) || new Set(ids).size !== ids.length) throw new QuestionsError("Choose the questions to generate.");
  if (typeof cliId !== "string" || !cliId) throw new QuestionsError("Choose an AI tool in Config first.");
  const job = await loadJobQuestions(n);
  if (version !== job.snapshot.version) throw new QuestionsError("The job changed. Reload its saved questions and try again.", 409);
  const sources = questionSources();
  const selected = questions.filter((q) => ids.includes(q.id));
  const language = /(?:^|\n)\s*output:\s*([a-z-]+)/i.exec(sources.primary["config/profile.yml"] ?? "")?.[1] ?? "en";
  const prompt = buildQuestionsPrompt({
    job: { company: job.app.company, role: job.app.role, url: job.app.url, description: archivedJobDescription(job.report) },
    questions: selected, ...sources, language,
  });
  const reply = await runQuestionDraft(cliId, prompt, signal);
  let generated: PortalQuestion[];
  try { generated = parseGeneratedAnswers(reply, selected, sources.primary) as PortalQuestion[]; }
  catch (error) { throw new QuestionsError(error instanceof Error ? error.message : "The AI returned invalid answers.", 502); }
  const byId = new Map(generated.map((q) => [q.id, q]));
  return saveJobQuestions(n, version, questions.map((q) => byId.get(q.id) ?? q));
}
