"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

// Config → Claude account. Lists the accounts claude-swap (cswap) manages and
// switches between them. The switch is cswap's own, so it is global: it also
// changes the account for terminal Claude Code sessions (see api/claude-accounts).

type Window = { pct: number | null; resetsAt: string | null };
type Account = {
  number: number;
  email: string;
  active: boolean;
  plan: string | null;
  usageStatus: string | null;
  fiveHour: Window;
  sevenDay: Window;
  loginExpiresAt: string | null;
};
type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; accounts: Account[] };

function resetLabel(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return `resets ${new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

function Meter({ label, w }: { label: string; w: Window }) {
  const pct = w.pct ?? 0;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-faint">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{w.pct === null ? "—" : `${Math.round(pct)}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div
          className={cn("h-full rounded-full", pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand")}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <div className="mt-0.5 truncate text-[10px] text-faint">{resetLabel(w.resetsAt)}</div>
    </div>
  );
}

export function ClaudeAccountSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<number | "best" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | "best" | null>(null);

  const apply = (d: { available?: boolean; accounts?: Account[]; error?: string }) => {
    if (d.available === false) setState({ kind: "unavailable" });
    else if (Array.isArray(d.accounts)) setState({ kind: "ready", accounts: d.accounts });
    else setState({ kind: "error", message: d.error ?? "Could not read your Claude accounts." });
  };

  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetch("/api/claude-accounts")
      .then((r) => r.json())
      .then(apply)
      .catch(() => setState({ kind: "error", message: "Could not read your Claude accounts." }));
  }, []);
  useEffect(load, [load]);

  const switchTo = async (target: number | "best", force = false) => {
    setBusy(target);
    setError(null);
    setConfirm(null);
    try {
      const res = await fetch("/api/claude-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, force }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.code === "RUN_IN_FLIGHT") setConfirm(target);
      else if (!res.ok) setError(typeof d.error === "string" ? d.error : "Could not switch.");
      else apply(d);
    } catch {
      setError("Could not switch.");
    }
    setBusy(null);
  };

  if (state.kind === "unavailable") return null;

  return (
    <div>
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Claude account
      </label>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-xs leading-relaxed text-faint">
          The account Claude Code runs on, switched with <span className="font-mono text-muted">claude-swap</span>. A
          switch applies to every Claude session on this computer, including your terminals.
        </p>

        {state.kind === "loading" ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Reading accounts and their usage…
          </div>
        ) : state.kind === "error" ? (
          <div className="mt-3 text-sm">
            <p className="text-red-500">{state.message}</p>
            <button type="button" onClick={load} className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover">
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              {state.accounts.map((a) => (
                <div
                  key={a.number}
                  className={cn("rounded-lg border px-3 py-2.5", a.active ? "border-brand/50 bg-brand-soft" : "border-border bg-surface/40")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {a.active ? <Check className="size-4 shrink-0 text-emerald-400" /> : null}
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{a.email}</span>
                    {a.plan ? <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">{a.plan}</span> : null}
                    <span className="ml-auto">
                      {a.active ? (
                        <span className="text-xs text-brand-text">Active</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => switchTo(a.number)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium transition-colors hover:bg-surface-hover disabled:opacity-50 max-sm:min-h-[44px]"
                        >
                          {busy === a.number ? <Loader2 className="size-3 animate-spin" /> : null}
                          Switch
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-4">
                    <Meter label="5-hour" w={a.fiveHour} />
                    <Meter label="7-day" w={a.sevenDay} />
                  </div>
                  {a.usageStatus && a.usageStatus !== "ok" ? (
                    <p className="mt-1 text-[11px] text-amber-500">Usage: {a.usageStatus}</p>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {state.accounts.length > 1 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => switchTo("best")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover disabled:opacity-50 max-sm:min-h-[44px]"
                >
                  {busy === "best" ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  Switch to the one with most quota left
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy !== null}
                onClick={load}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50 max-sm:min-h-[44px]"
              >
                <RefreshCw className="size-3" /> Refresh
              </button>
            </div>

            {confirm !== null ? (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-muted">
                An evaluation is running. Switching now may finish it on the other account.
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => switchTo(confirm, true)} className="rounded-md bg-brand px-3 py-1 font-medium text-brand-foreground">
                    Switch anyway
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="rounded-md border border-border px-3 py-1">
                    Wait
                  </button>
                </div>
              </div>
            ) : null}
            {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
            <p className="mt-3 text-[11px] text-faint">
              To add an account, sign in to it in a terminal (<span className="font-mono">claude</span>, then{" "}
              <span className="font-mono">/login</span>) and run <span className="font-mono">cswap add</span>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
