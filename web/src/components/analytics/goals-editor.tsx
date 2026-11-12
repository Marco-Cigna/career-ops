"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil } from "lucide-react";

type Goal = { target: number; count: number; pct: number } | null;

// Application goals with progress bars, editable in place. Saving writes
// goals.* in config/profile.yml (only those lines) and refreshes the page.
export function GoalsEditor({ year, rolling30 }: { year: Goal; rolling30: Goal }) {
  const router = useRouter();
  const [editing, setEditing] = useState(!year && !rolling30);
  const [perYear, setPerYear] = useState(year ? String(year.target) : "");
  const [per30, setPer30] = useState(rolling30 ? String(rolling30.target) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perYear: perYear.trim() || null, per30Days: per30.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Not saved.");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    }
    setSaving(false);
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-4 space-y-3">
        <GoalInput id="goal-year" label="Yearly applications goal" value={perYear} onChange={setPerYear} />
        <GoalInput id="goal-30" label="30-day target" value={per30} onChange={setPer30} />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save goals
          </button>
          {(year || rolling30) && (
            <button type="button" onClick={() => setEditing(false)} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover max-sm:min-h-[44px]">Cancel</button>
          )}
        </div>
        <p className="text-[11px] text-faint">Leave a box empty to turn that goal off.</p>
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      </form>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {year && <Progress label="Yearly goal" detail={`${year.count} of ${year.target} · overall progress`} pct={year.pct} />}
      {rolling30 && <Progress label="30-day target" detail={`${rolling30.count} of ${rolling30.target} in the last 30 days`} pct={rolling30.pct} />}
      <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs text-brand-text underline-offset-2 hover:underline">
        <Pencil className="size-3" /> Edit goals
      </button>
    </div>
  );
}

function Progress({ label, detail, pct }: { label: string; detail: string; pct: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-foreground">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={`${label}: ${detail}, ${pct.toFixed(1)} percent`}>
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function GoalInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-muted">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={10000}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </div>
  );
}
