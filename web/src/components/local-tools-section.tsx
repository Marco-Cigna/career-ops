"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock, Loader2, Play, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { isStale, timeAgo } from "@/lib/local-tools.mjs";

type Run = { startedAt: string; finishedAt: string | null; ok: boolean | null; exitCode: number | null; message: string; output: string };
type Tool = { id: string; label: string; description: string; staleAfterHours: number | null; lastRun: Run | null };
type Listing = { configExists: boolean; configPath: string; problems: string[]; tools: Tool[] };

// The user's own scripts from config/local-tools.yml: a Run button each, and
// how long ago it last ran. Nothing shows when the file does not exist.
export function LocalToolsSection() {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/local-tools", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch { /* keep the last listing */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const anyRunning = Boolean(data?.tools.some((t) => t.lastRun && !t.lastRun.finishedAt));
  // Poll while something runs; otherwise just keep "x min ago" current.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (anyRunning) void load();
    }, anyRunning ? 3_000 : 60_000);
    return () => clearInterval(tick);
  }, [anyRunning, load]);

  async function run(id: string) {
    setError((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/local-tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((e) => ({ ...e, [id]: body.error || "It could not start." }));
      }
    } catch {
      setError((e) => ({ ...e, [id]: "Could not reach the local server." }));
    }
    await load();
  }

  if (!data || (!data.configExists && !data.tools.length)) return null;

  return (
    <section aria-labelledby="local-tools-heading" className="rounded-xl border border-border bg-surface/30 p-4">
      <h2 id="local-tools-heading" className="flex items-center gap-2 text-sm font-medium text-foreground">
        <TerminalSquare className="size-4 text-brand-text" /> Your scripts
      </h2>
      <p className="mt-1 text-xs text-faint">From <code className="break-all">{data.configPath}</code>. They run on this computer with your own access.</p>
      {data.problems.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-400">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <ul className="mt-3 space-y-3">
        {data.tools.map((tool) => {
          const last = tool.lastRun;
          const busy = Boolean(last && !last.finishedAt);
          const when = last?.finishedAt ?? last?.startedAt ?? null;
          const stale = !busy && isStale(last?.finishedAt ?? null, tool.staleAfterHours, now);
          return (
            <li key={tool.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{tool.label}</p>
                  {tool.description && <p className="text-xs text-faint">{tool.description}</p>}
                  <p
                    role="status"
                    className={cn(
                      "mt-1.5 inline-flex items-center gap-1.5 text-xs",
                      busy ? "text-muted" : last?.ok === false ? "text-red-700 dark:text-red-400" : stale ? "text-amber-800 dark:text-amber-400" : "text-emerald-800 dark:text-emerald-400",
                    )}
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : last?.ok === false ? <CircleAlert className="size-3.5" /> : stale ? <Clock className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                    {busy
                      ? `Running · started ${timeAgo(last?.startedAt, now)}`
                      : last
                        ? `Last run ${timeAgo(when, now)} · ${last.ok ? "finished" : last.message}${stale && tool.staleAfterHours ? ` · due (every ${tool.staleAfterHours} h)` : ""}`
                        : "Never run"}
                  </p>
                </div>
                <button
                  onClick={() => run(tool.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  {busy ? "Running" : "Run now"}
                </button>
              </div>
              {error[tool.id] && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-400">{error[tool.id]}</p>}
              {last?.output && (
                <details className="mt-2" open={busy}>
                  <summary className="cursor-pointer select-none text-xs text-muted">{busy ? "Live output" : "Output of the last run"}</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface p-3 font-mono text-[11px] text-foreground">{last.output.trim()}</pre>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
