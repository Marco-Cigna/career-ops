"use client";

import { useEffect, useRef, useState } from "react";
import { Filter, Loader2, X } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import { resolveCliId } from "@/lib/saved-cli";
import { runPool } from "@/lib/run-pool.mjs";
import { subscribeConfig } from "@/lib/config-events.mjs";

// The inbox Filter button: pre-screen rules (free) then triage on the cheap
// model, for every row that has not been filtered yet. Failures leave the inbox
// (api/inbox/filter ticks them off); passes stay, marked, for the user to score.

export type FilterOutcome = { outcome: "passed" | "removed" | "unchecked" | "error"; score?: number | null; reason?: string };
type Plan = { cliId: string; cliName: string; triage: boolean; model: string | null; effort: string | null; reason: string | null };
type Progress = { done: number; total: number; passed: number; removed: number; unchecked: number; errors: number };

// Triage is a short call on a cheap model; three at a time keeps a large inbox
// moving without opening dozens of CLI processes at once.
const CONCURRENCY = 3;

export function InboxFilter({ candidates, onResult, onFinished }: {
  candidates: InboxJob[];
  onResult: (url: string, result: FilterOutcome) => void;
  onFinished: (progress: Progress) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done">("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  // A confirmation belongs to the selected CLI. Reopen it after a Config
  // change rather than starting work with an earlier selection's plan.
  useEffect(() => {
    if (phase !== "confirm") return;
    return subscribeConfig(window, () => {
      setPlan(null);
      setPhase("idle");
    });
  }, [phase]);

  const open = async () => {
    setError("");
    const cliId = await resolveCliId();
    if (!cliId) {
      setError("Choose an AI tool on the Config page first.");
      return;
    }
    try {
      const r = await fetch(`/api/inbox/filter?cliId=${encodeURIComponent(cliId)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Filter is not available.");
      setPlan(d);
      setPhase("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Filter is not available.");
    }
  };

  const run = async () => {
    if (!plan) return;
    const controller = new AbortController();
    abort.current = controller;
    const tally: Progress = { done: 0, total: candidates.length, passed: 0, removed: 0, unchecked: 0, errors: 0 };
    setProgress({ ...tally });
    setPhase("running");
    await runPool(candidates, CONCURRENCY, async (job: InboxJob) => {
      let result: FilterOutcome;
      try {
        const r = await fetch("/api/inbox/filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: job.url, cliId: plan.cliId }),
          signal: controller.signal,
        });
        const d = await r.json().catch(() => ({}));
        result = r.ok ? d : { outcome: "error", reason: d.error || `HTTP ${r.status}` };
      } catch {
        if (controller.signal.aborted) return;
        result = { outcome: "error", reason: "The request failed." };
      }
      if (result.outcome === "passed") tally.passed += 1;
      else if (result.outcome === "removed") tally.removed += 1;
      else if (result.outcome === "unchecked") tally.unchecked += 1;
      else tally.errors += 1;
      tally.done += 1;
      onResult(job.url, result);
      setProgress({ ...tally });
    }, controller.signal);
    abort.current = null;
    setPhase("done");
    onFinished(tally);
  };

  const stop = () => abort.current?.abort();

  if (phase === "idle" || phase === "done") {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={open}
          disabled={candidates.length === 0}
          title={candidates.length === 0 ? "Every job here has been filtered" : "Remove jobs that fail your rules or a quick triage"}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-brand/50 hover:text-brand-text disabled:opacity-50 max-sm:min-h-[44px]"
        >
          <Filter className="size-3.5" /> Filter{candidates.length ? ` ${candidates.length}` : ""}
        </button>
        {phase === "done" && progress ? (
          <span className="text-xs text-muted">
            {progress.removed} removed · {progress.passed} passed{progress.unchecked ? ` · ${progress.unchecked} couldn't be read` : ""}{progress.errors ? ` · ${progress.errors} failed` : ""}
          </span>
        ) : null}
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      </div>
    );
  }

  if (phase === "confirm" && plan) {
    return (
      <div className="w-full rounded-xl border border-brand/30 bg-brand-soft/40 p-3 text-xs text-muted">
        <p className="text-sm font-medium text-foreground">Filter {candidates.length} job{candidates.length === 1 ? "" : "s"}?</p>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
          <li>Your rules, free: blacklist, excluded title words, 6+ years.</li>
          {plan.triage ? (
            <li>
              A quick triage of each job that passes, on <span className="font-mono text-foreground">{plan.model}</span>
              {plan.effort ? ` (${plan.effort})` : ""} via {plan.cliName}: up to {candidates.length} short calls. Below 3.5/5 is removed.
            </li>
          ) : (
            <li>{plan.reason}</li>
          )}
        </ol>
        <p className="mt-1.5">Removed jobs are ticked off the inbox and listed in <span className="font-mono">data/discard.log</span>. Closed postings are removed too.</p>
        <div className="mt-2.5 flex gap-2">
          <button type="button" onClick={run} className="rounded-md bg-brand px-3 py-1 font-medium text-brand-foreground max-sm:min-h-[44px]">
            Filter now
          </button>
          <button type="button" onClick={() => setPhase("idle")} className="rounded-md border border-border px-3 py-1 text-foreground max-sm:min-h-[44px]">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const p = progress ?? { done: 0, total: candidates.length, passed: 0, removed: 0, unchecked: 0, errors: 0 };
  return (
    <div className="w-full rounded-xl border border-border bg-surface/60 p-3 text-xs">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-brand-text" />
        <span className="font-medium text-foreground">Filtering {p.done} of {p.total}</span>
        <span className="text-muted">· {p.removed} removed · {p.passed} passed</span>
        <button type="button" onClick={stop} className="ml-auto inline-flex items-center gap-1 text-muted hover:text-foreground max-sm:min-h-[44px]">
          <X className="size-3.5" /> Stop
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
