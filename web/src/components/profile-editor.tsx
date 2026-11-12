"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { PROFILE_FILES } from "@/lib/profile-files.mjs";

type Loaded = { content: string; exists: boolean };
type Status = { tone: "ok" | "error" | "info"; text: string } | null;

// Edit one user-layer file at a time. The text the file had when it was opened
// goes back with every save, so an edit made elsewhere in the meantime (the
// assistant, the CLI, another tab) is never overwritten: the server refuses
// and the text stays here.
export function ProfileEditor() {
  const [id, setId] = useState(PROFILE_FILES[0].id);
  const [base, setBase] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const spec = PROFILE_FILES.find((f) => f.id === id) ?? PROFILE_FILES[0];
  const dirty = base !== null && draft !== base.content;

  const load = useCallback(async (fileId: string) => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/profile-files?id=${encodeURIComponent(fileId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't open the file.");
      setBase({ content: data.content, exists: data.exists });
      setDraft(data.content);
    } catch (err) {
      setBase(null);
      setStatus({ tone: "error", text: err instanceof Error ? err.message : "Couldn't open the file." });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(id); }, [id, load]);

  // Leaving the page with unsaved text asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function pick(next: string) {
    if (next === id) return;
    if (dirty && !window.confirm("You have unsaved changes in this file. Discard them?")) return;
    setId(next);
  }

  async function save() {
    if (!base || !dirty || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/profile-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, content: draft, expected: base }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ tone: "error", text: data.error || "Not saved." });
      } else {
        setBase({ content: draft, exists: true });
        setStatus({ tone: "ok", text: data.backup ? `Saved. The previous version is kept as ${data.backup}.` : "Saved." });
      }
    } catch {
      setStatus({ tone: "error", text: "Could not reach the local server. Your text is still here." });
    }
    setSaving(false);
  }

  return (
    <div>
      <div role="tablist" aria-label="Profile files" className="flex flex-wrap gap-1.5">
        {PROFILE_FILES.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === id}
            onClick={() => pick(f.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm transition-colors max-sm:min-h-[44px]",
              f.id === id ? "bg-brand text-brand-foreground" : "border border-border text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={spec.label} className="mt-4">
        <p className="text-sm text-muted">{spec.description}</p>
        <p className="mt-0.5 font-mono text-xs text-faint">{spec.file}{base && !base.exists ? " — not created yet; saving creates it" : ""}</p>

        <label htmlFor="profile-file-text" className="sr-only">{spec.label} ({spec.file})</label>
        <textarea
          id="profile-file-text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void save();
            }
          }}
          disabled={loading}
          spellCheck={spec.kind === "markdown"}
          rows={28}
          className="mt-3 w-full resize-y rounded-xl border border-border bg-background p-4 font-code text-[13px] leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={!dirty || saving || loading}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </button>
          <button
            onClick={() => base && setDraft(base.content)}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-hover disabled:opacity-50 max-sm:min-h-[44px]"
          >
            <RotateCcw className="size-4" />
            Undo changes
          </button>
          <span className="text-xs text-faint">{loading ? "Opening…" : dirty ? "Unsaved changes · Ctrl+S saves" : "No unsaved changes"}</span>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "mt-2 min-h-5 text-sm",
            status?.tone === "error" ? "text-red-700 dark:text-red-400" : status?.tone === "ok" ? "text-emerald-800 dark:text-emerald-400" : "text-muted",
          )}
        >
          {status?.text}
        </p>
      </div>
    </div>
  );
}
