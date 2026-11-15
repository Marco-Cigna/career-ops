"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { saveStatus } from "@/lib/pipeline-status.mjs";

type Duplicate = { num: string; company: string; role: string; status: string; date: string; reason: string };

const REASON: Record<string, string> = {
  url: "same link",
  req: "same requisition",
  "same-title": "same company and title",
  "parent-org": "same parent company",
  "similar-title": "similar title",
};

const inputClass = "mt-1 w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-foreground outline-none focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40";

/**
 * "Add applied job": record an application sent outside career-ops. Type the
 * link, company and role (or fill them from the link, a plain page read with
 * no AI), then save. Rows are dated today, have no score, and land as Applied.
 */
export function AddAppliedJob() {
  const router = useRouter();
  const linkInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [city, setCity] = useState("");
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [busy, setBusy] = useState<"" | "filling" | "saving">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  function reset() {
    setLink("");
    setCompany("");
    setRole("");
    setCity("");
    setDuplicates([]);
    setNote("");
    setError("");
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
    setDone("");
  }

  async function fill() {
    if (!link.trim() || busy) return;
    setBusy("filling");
    setError("");
    setNote("");
    setDone("");
    try {
      const res = await fetch("/api/tracker/add-applied", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "preview", url: link.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) {
        setError(data?.error || "Could not read that link.");
        return;
      }
      setLink(data.url || link.trim());
      if (data.company && !company.trim()) setCompany(data.company);
      if (data.role && !role.trim()) setRole(data.role);
      if (data.city && !city.trim()) setCity(data.city);
      setDuplicates(data.duplicates ?? []);
      if (!data.company && !data.role) {
        setNote(data.linkedin ? "LinkedIn pages are not read. Type the company and role." : "Nothing could be read from this link. Type the company and role.");
      } else if (!data.company || !data.role) {
        setNote(`Fill in the ${data.company ? "role" : "company"}.`);
      }
    } catch {
      setError("Could not read that link.");
    } finally {
      setBusy("");
    }
  }

  async function save(force: boolean) {
    if (!link.trim() || !company.trim() || !role.trim() || busy) return;
    setBusy("saving");
    setError("");
    setDone("");
    try {
      const res = await fetch("/api/tracker/add-applied", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "save", url: link.trim(), company, role, city, force }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && Array.isArray(data?.duplicates)) {
        setDuplicates(data.duplicates);
        return;
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Could not save. Nothing was added.");
        return;
      }
      router.refresh();
      reset();
      setDone(data.warning || `Added #${data.num} as Applied (${data.date}).`);
    } catch {
      setError("Could not save. Check the table before trying again.");
    } finally {
      setBusy("");
    }
  }

  async function markExisting(d: Duplicate) {
    if (busy) return;
    setBusy("saving");
    setError("");
    try {
      await saveStatus(d.num, d.status, "Applied");
      router.refresh();
      reset();
      setDone(`Marked #${d.num} ${d.company} as Applied.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that row.");
    } finally {
      setBusy("");
    }
  }

  const ready = !!link.trim() && !!company.trim() && !!role.trim();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add a job you applied for outside career-ops"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:justify-center max-sm:px-0"
      >
        <Plus aria-hidden="true" className="size-4" />
        <span className="max-sm:sr-only">Add applied job</span>
      </button>
      <Modal isOpen={open} onClose={close} labelledBy="add-applied-title" initialFocusRef={linkInput} panelClassName="max-w-lg">
        <h2 id="add-applied-title" className="text-base font-medium text-foreground">Add a job you applied for</h2>
        <p className="mt-1 text-sm text-muted">It is added as Applied, dated today, with no score.</p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <label className="block text-xs text-muted">
            Job link
            <div className="mt-1 flex gap-2">
              <input
                ref={linkInput}
                type="url"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setDuplicates([]);
                  setNote("");
                }}
                placeholder="https://…"
                className={`${inputClass} mt-0`}
              />
              <button
                type="button"
                onClick={() => void fill()}
                disabled={!!busy || !link.trim()}
                title="Read the company and role from the job page (no AI)"
                className="whitespace-nowrap rounded-md border border-border px-3 text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                {busy === "filling" ? "Reading…" : "Fill from link"}
              </button>
            </div>
          </label>
          <label className="block text-xs text-muted">
            Company
            <input value={company} onChange={(e) => { setCompany(e.target.value); setDuplicates([]); }} className={inputClass} />
          </label>
          <label className="block text-xs text-muted">
            Role
            <input value={role} onChange={(e) => { setRole(e.target.value); setDuplicates([]); }} className={inputClass} />
          </label>
          <label className="block text-xs text-muted">
            City <span className="text-faint">(optional)</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sydney" className={inputClass} />
          </label>
          {note && <p className="text-xs text-faint">{note}</p>}

          {duplicates.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
              <p className="font-medium">This may already be in your tracker:</p>
              <ul className="mt-2 space-y-2">
                {duplicates.map((d) => (
                  <li key={d.num} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      #{d.num} {d.company}, {d.role} ({d.status}; {REASON[d.reason] ?? d.reason})
                    </span>
                    {d.status !== "Applied" && (
                      <button
                        type="button"
                        onClick={() => void markExisting(d)}
                        disabled={!!busy}
                        className="rounded-full border border-border px-3 py-1 text-xs hover:bg-surface disabled:opacity-50"
                      >
                        Mark #{d.num} applied
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          {done && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{done}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={close} disabled={!!busy} className="rounded-full px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50">
              {done ? "Close" : "Cancel"}
            </button>
            {duplicates.length > 0 ? (
              <button
                type="button"
                onClick={() => void save(true)}
                disabled={!!busy || !ready}
                className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
              >
                {busy === "saving" ? "Adding…" : "Add as a new row"}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!!busy || !ready}
                className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
              >
                {busy === "saving" ? "Adding…" : "Add as Applied"}
              </button>
            )}
          </div>
        </form>
      </Modal>
    </>
  );
}
