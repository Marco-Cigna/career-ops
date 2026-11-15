"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/modal";

const inputClass = "mt-1 w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-foreground outline-none focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40";

/** The City cell's stored "no value" marks read as empty in the form. */
function editableCity(value: string | undefined): string {
  const v = String(value ?? "").trim();
  return v === "—" || v === "-" ? "" : v;
}

/**
 * Edit the Company, Role and City of one tracker row. Saves through
 * /api/tracker/edit-row (edit-row.mjs), which changes only those cells.
 */
export function EditRowButton({ n, company, role, city }: { n: string; company: string; role: string; city?: string }) {
  const router = useRouter();
  const first = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ company, role, city: editableCity(city) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleId = `edit-row-${n}`;

  function start() {
    setValues({ company, role, city: editableCity(city) });
    setError("");
    setOpen(true);
  }

  function close() {
    if (!saving) setOpen(false);
  }

  async function save() {
    if (saving) return;
    const next = { company: values.company.trim(), role: values.role.trim(), city: values.city.trim() };
    if (!next.company || !next.role) {
      setError("Company and role cannot be empty.");
      return;
    }
    // Send only what changed, so an untouched cell is never rewritten.
    const body: Record<string, string> = { n };
    if (next.company !== company) body.company = next.company;
    if (next.role !== role) body.role = next.role;
    if (next.city !== editableCity(city)) body.city = next.city;
    if (Object.keys(body).length === 1) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/tracker/edit-row", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Could not save. Nothing was changed.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save. Reload to check before trying again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        aria-label={`Edit company, role and city of #${n}`}
        title="Edit company, role and city"
        className="inline-flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </button>
      <Modal isOpen={open} onClose={close} labelledBy={titleId} initialFocusRef={first} panelClassName="max-w-md">
        <h2 id={titleId} className="text-base font-medium text-foreground">Edit #{n}</h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block text-xs text-muted">
            Company
            <input ref={first} value={values.company} onChange={(e) => setValues((v) => ({ ...v, company: e.target.value }))} className={inputClass} />
          </label>
          <label className="block text-xs text-muted">
            Role
            <input value={values.role} onChange={(e) => setValues((v) => ({ ...v, role: e.target.value }))} className={inputClass} />
          </label>
          <label className="block text-xs text-muted">
            City <span className="text-faint">(leave empty if unknown)</span>
            <input value={values.city} onChange={(e) => setValues((v) => ({ ...v, city: e.target.value }))} placeholder="Sydney" className={inputClass} />
          </label>
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={close} disabled={saving} className="rounded-full px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
