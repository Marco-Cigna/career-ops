"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { resolveCliId } from "@/lib/saved-cli";
import { MAX_QUESTIONS, wordCount } from "@/lib/job-questions.mjs";
import type { PortalQuestion, QuestionsSnapshot } from "@/lib/job-questions-server";

const buttonClass = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand disabled:opacity-60";
const newQuestion = (): PortalQuestion => ({ id: crypto.randomUUID(), question: "", answer: "", maxWords: null, status: "unanswered", notes: "", evidence: [] });

export function JobQuestions({ applicationId }: { applicationId: string }) {
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);
  const [version, setVersion] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>("loading");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const endpoint = `/api/job-questions/${encodeURIComponent(applicationId)}`;

  function accept(snapshot: QuestionsSnapshot) {
    setQuestions(snapshot.questions.length ? snapshot.questions : [newQuestion()]);
    setVersion(snapshot.version); setSavedAt(snapshot.savedAt); setDirty(false);
  }

  useEffect(() => {
    const abort = new AbortController();
    let live = true;
    setBusy("loading"); setError("");
    fetch(endpoint, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load saved questions.");
        if (live) accept(data);
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load questions."); })
      .finally(() => { if (live) setBusy(null); });
    return () => { live = false; abort.abort(); controller.current?.abort(); };
  }, [endpoint]);

  function edit(id: string, update: Partial<PortalQuestion>) {
    setQuestions((current) => current.map((q) => q.id === id ? { ...q, ...update, status: (update.answer ?? q.answer) ? "edited" : "unanswered", notes: "", evidence: [] } : q));
    setDirty(true); setError(""); setCopied("");
  }

  async function request(method: string, body: object, signal?: AbortSignal): Promise<QuestionsSnapshot> {
    const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The questions could not be saved.");
    return data;
  }

  function authoredQuestions() {
    if (questions.some((q) => !q.question.trim() && q.answer.trim())) throw new Error("Add the question for each answer before saving.");
    return questions.filter((q) => q.question.trim());
  }

  async function save() {
    setBusy("saving"); setError("");
    try { accept(await request("PUT", { questions: authoredQuestions(), version })); }
    catch (e) { setError(e instanceof Error ? e.message : "The questions could not be saved."); }
    finally { setBusy(null); }
  }

  async function generate(ids: string[]) {
    if (!ids.length) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy("generating"); setError("");
    try {
      const cliId = await resolveCliId();
      if (!cliId) throw new Error("Choose an AI tool in Config first.");
      const pending = authoredQuestions();
      // Keep pasted questions even when the subsequent AI request fails.
      const saved = await request("PUT", { questions: pending, version }, abort.signal);
      accept(saved);
      const result = await request("POST", { questions: saved.questions, version: saved.version, ids, cliId }, abort.signal);
      accept(result);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Answer generation failed. Your saved questions were kept."); }
    finally { controller.current = null; setBusy(null); }
  }

  const missing = questions.filter((q) => q.question.trim() && !q.answer.trim()).map((q) => q.id);
  return (
    <section aria-label="Portal questions" className="mt-8 rounded-2xl border border-border bg-surface/30 p-4 sm:p-5 print:hidden">
      <h2 className="font-display text-xl text-foreground">Questions</h2>
      <p className="mt-1 text-sm text-muted">Paste questions from the job portal. Generate draft answers from your CV and profile, then review and edit them here.</p>
      <p role="status" className="mt-2 text-xs text-muted" aria-live="polite">
        {busy === "loading" ? "Loading saved questions…" : busy === "generating" ? "Generating answers and saving them to this job…" : busy === "saving" ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved with this job · ${new Date(savedAt).toLocaleString()}` : "Questions and answers will be saved with this job. Drafts are never submitted."}
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      {version && <>
        <div className="mt-4 space-y-4">
          {questions.map((q, i) => {
            const count = wordCount(q.answer);
            const over = q.maxWords != null && count > q.maxWords;
            return (
              <fieldset key={q.id} disabled={busy !== null} className="rounded-xl border border-border p-3 sm:p-4">
                <legend className="px-1 text-sm font-medium text-foreground">Question {i + 1}</legend>
                <label htmlFor={`question-${q.id}`} className="mb-1 block text-xs text-muted">Portal question</label>
                <textarea id={`question-${q.id}`} value={q.question} onChange={(e) => edit(q.id, { question: e.target.value })} rows={3} maxLength={5000} className={inputClass} placeholder="Paste the exact question here" />
                <label htmlFor={`limit-${q.id}`} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  Word limit (optional)
                  <input id={`limit-${q.id}`} type="number" min={1} max={2000} value={q.maxWords ?? ""} onChange={(e) => edit(q.id, { maxWords: e.target.value === "" ? null : Number(e.target.value) })} className={`${inputClass} max-w-24`} />
                </label>
                <label htmlFor={`answer-${q.id}`} className="mb-1 mt-3 block text-xs text-muted">Draft answer</label>
                <textarea id={`answer-${q.id}`} value={q.answer} onChange={(e) => edit(q.id, { answer: e.target.value })} rows={6} maxLength={12000} className={inputClass} placeholder="Generate an answer or write your own" />
                <p className={`mt-1 text-xs ${over ? "text-amber-700 dark:text-amber-400" : "text-muted"}`}>{count}{q.maxWords == null ? " words · limit unknown" : `/${q.maxWords} words`}{` · ${q.answer.length} characters`}{over ? " · Shorten before copying" : ""}</p>
                {q.status === "needs-input" && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">Needs your input before using this answer.</p>}
                {q.notes && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{q.notes}</p>}
                {q.evidence.length > 0 && <details className="mt-2 text-xs text-muted"><summary className="min-h-[32px] cursor-pointer py-1">Supporting experience</summary>{q.evidence.map((e, index) => <blockquote key={index} className="mt-2 border-l-2 border-border pl-3"><p className="font-medium">{e.source}</p><p className="mt-1 whitespace-pre-wrap">{e.quote}</p></blockquote>)}</details>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={!q.question.trim()} onClick={() => void generate([q.id])} className={buttonClass}><Sparkles className="size-3.5" />{q.answer ? "Regenerate answer" : "Generate answer"}</button>
                  <button type="button" disabled={!q.answer.trim() || over} onClick={() => { void navigator.clipboard.writeText(q.answer).then(() => setCopied(q.id)).catch(() => setError("Could not copy. Select the answer text and copy it manually.")); }} className={buttonClass}><Copy className="size-3.5" />{copied === q.id ? "Copied" : "Copy answer"}</button>
                  <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => { setQuestions((current) => current.filter((entry) => entry.id !== q.id)); setDirty(true); }} className={buttonClass}><Trash2 className="size-3.5" />Remove</button>
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null || questions.length >= MAX_QUESTIONS} onClick={() => { setQuestions((current) => [...current, newQuestion()]); setDirty(true); }} className={buttonClass}><Plus className="size-4" />Add question</button>
          <button type="button" disabled={busy !== null || !dirty} onClick={() => void save()} className={buttonClass}>Save questions</button>
          <button type="button" disabled={busy !== null || !missing.length} onClick={() => void generate(missing)} className={`${buttonClass} border-brand/40 bg-brand-soft`}>
            {busy === "generating" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{questions.some((q) => q.answer.trim()) ? "Generate missing answers" : "Generate answers"}
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">Generation uses your configured AI tool. Missing facts are flagged for your input. Review every answer before pasting it into the portal.</p>
      </>}
    </section>
  );
}
