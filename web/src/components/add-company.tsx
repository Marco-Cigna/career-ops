"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, Sparkles } from "lucide-react";
import { resolveCliId } from "@/lib/saved-cli";

type Board = { name: string; vendor: string; careersUrl: string; jobCount: number | null; smallBoard: boolean };
type Discovery = {
  status: "found" | "watched" | "added" | "unresolved" | "blacklisted" | "error";
  board?: Board;
  reason?: string;
  hints?: Record<string, string>;
  agent?: { careersUrl: string | null; note: string };
  error?: string;
};
type Busy = null | "lookup" | "agent" | "add";

async function post(body: Record<string, unknown>): Promise<Discovery> {
  try {
    const res = await fetch("/api/portals/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json()) as Discovery;
    return res.ok ? data : { status: "error", reason: data.error || "The lookup failed." };
  } catch {
    return { status: "error", reason: "Could not reach the local server." };
  }
}

// Add a company to the watch list by name. The free lookup probes the public
// job-board APIs; the agent search is the fallback, and it only supplies hints
// that the same live lookup then has to confirm.
export function AddCompany() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<Discovery | null>(null);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    const name = company.trim();
    if (!name || busy) return;
    setBusy("lookup");
    setResult(null);
    setAsked(name);
    setResult(await post({ company: name }));
    setBusy(null);
  }

  async function searchWithAgent() {
    if (busy) return;
    setBusy("agent");
    const cliId = await resolveCliId(() => {});
    setResult(cliId ? await post({ company: asked, agent: true, cliId }) : { status: "error", reason: "No AI CLI is configured. Open Config and save one." });
    setBusy(null);
  }

  async function add() {
    if (busy || !result) return;
    setBusy("add");
    const next = await post({ company: asked, write: true, hints: result.hints ?? {} });
    setResult(next);
    setBusy(null);
    if (next.status === "added") {
      setCompany("");
      router.refresh();
    }
  }

  const board = result?.board;
  return (
    <section aria-labelledby="add-company-heading" className="rounded-xl border border-border bg-surface/30 p-4">
      <h2 id="add-company-heading" className="text-sm font-medium text-foreground">Add a company</h2>
      <p className="mt-1 text-xs text-faint">Type a company name. Its public job board is looked up for free; if that finds nothing, an agent can search the web for it.</p>
      <form onSubmit={lookup} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="add-company-name" className="sr-only">Company name</label>
        <input
          id="add-company-name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="e.g. Atlassian"
          maxLength={80}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand max-sm:min-h-[44px]"
        />
        <button
          type="submit"
          disabled={!company.trim() || busy !== null}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {busy === "lookup" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Find job board
        </button>
      </form>

      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {busy === "lookup" && <p className="text-faint">Probing the public job boards… (up to a minute)</p>}
        {busy === "agent" && <p className="text-faint">The agent is searching the web for {asked}&apos;s careers page… (1–3 minutes)</p>}

        {!busy && result && board && (
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="font-medium text-foreground">
              {board.name || asked} <span className="font-normal text-muted">· {board.vendor}{board.jobCount !== null ? ` · ${board.jobCount} open roles` : ""}</span>
            </p>
            <a href={board.careersUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-brand-text underline-offset-2 hover:underline">{board.careersUrl}</a>
            {board.smallBoard && <p className="mt-1 text-xs text-amber-800 dark:text-amber-400">Few roles listed. Open the link and check this is the company&apos;s main board before adding it.</p>}
            {result.agent?.note && <p className="mt-1 text-xs text-faint">Agent: {result.agent.note}</p>}
            <div className="mt-2">
              {result.status === "found" && (
                <button onClick={add} className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand-200">
                  <Plus className="size-3.5" /> Add to watch list
                </button>
              )}
              {result.status === "watched" && <p className="text-xs text-muted">Already on your watch list.</p>}
              {result.status === "added" && (
                <p className="inline-flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-400">
                  <Check className="size-3.5" /> Added. The next scan will read this board.
                </p>
              )}
            </div>
          </div>
        )}
        {busy === "add" && <p className="text-faint">Adding…</p>}

        {!busy && result && !board && (
          <div className="rounded-lg border border-dashed border-border p-3">
            <p className="text-muted">{result.reason || "No job board found."}</p>
            {result.agent?.careersUrl && (
              <p className="mt-1 text-xs text-faint">
                The agent found a careers page the scanner cannot read automatically:{" "}
                <a href={result.agent.careersUrl} target="_blank" rel="noreferrer" className="break-all text-brand-text underline-offset-2 hover:underline">{result.agent.careersUrl}</a>.
                Paste individual postings from it on the Today page to evaluate them.
              </p>
            )}
            {result.agent?.note && <p className="mt-1 text-xs text-faint">Agent: {result.agent.note}</p>}
            {result.status === "unresolved" && !result.agent && (
              <button onClick={searchWithAgent} className="mt-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover">
                <Sparkles className="size-3.5" /> Search the web with an agent (uses tokens)
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
