"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Play, Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { LocalToolsSection } from "@/components/local-tools-section";
import { AGENT_MODES, SCRIPT_TOOLS } from "@/lib/tools-catalog.mjs";

type Output = { id: string; code: number; output: string; timedOut: boolean; error?: string };
const GROUPS = ["Reports", "Health", "Maintenance"] as const;

export function ToolsView() {
  const { startJob } = useJobs();
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [modeId, setModeId] = useState(AGENT_MODES[0].id);
  const [input, setInput] = useState("");
  const [started, setStarted] = useState<{ id: string; label: string } | null>(null);
  const mode = AGENT_MODES.find((m) => m.id === modeId) ?? AGENT_MODES[0];

  async function run(id: string) {
    setConfirming(null);
    setRunning(id);
    setOutput(null);
    try {
      const res = await fetch("/api/tools/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json();
      setOutput(res.ok ? data : { id, code: -1, output: "", timedOut: false, error: data.error || "The tool could not run." });
    } catch {
      setOutput({ id, code: -1, output: "", timedOut: false, error: "Could not reach the local server." });
    }
    setRunning(null);
  }

  function runMode(e: FormEvent) {
    e.preventDefault();
    const text = input.trim() || "(no extra input)";
    const id = startJob({ title: mode.label, subtitle: text.slice(0, 80), kind: "mode", input: text, page: "/tools", brief: { mode: mode.id } });
    if (id) setStarted({ id, label: mode.label });
  }

  const shown = output ? SCRIPT_TOOLS.find((t) => t.id === output.id) : null;
  const outcome = !output
    ? ""
    : output.error
      ? "could not run"
      : output.timedOut
        ? "timed out"
        : output.code === 0
          ? "finished"
          : "finished with findings (exit " + output.code + ")";
  return (
    <div className="space-y-8">
      <LocalToolsSection />
      <section aria-labelledby="agent-tools-heading" className="rounded-xl border border-border bg-surface/30 p-4">
        <h2 id="agent-tools-heading" className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="size-4 text-brand-text" /> Agent tools
        </h2>
        <form onSubmit={runMode} className="mt-3 space-y-3">
          <div>
            <label htmlFor="tool-mode" className="text-xs text-muted">What do you need?</label>
            <select
              id="tool-mode"
              value={modeId}
              onChange={(e) => { setModeId(e.target.value); setStarted(null); }}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {AGENT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-faint">{mode.description}</p>
          </div>
          <div>
            <label htmlFor="tool-input" className="text-xs text-muted">{mode.inputLabel}</label>
            <textarea
              id="tool-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode.placeholder}
              rows={mode.id === "offer-prep" ? 8 : 2}
              maxLength={60000}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 max-sm:min-h-[44px]">
              <Play className="size-4" /> Run (uses tokens)
            </button>
            {started && (
              <p role="status" className="text-xs text-muted">
                {started.label} is running.{" "}
                <Link href={"/jobs/" + started.id} className="text-brand-text underline-offset-2 hover:underline">Open the result</Link>
              </p>
            )}
          </div>
        </form>
      </section>

      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={"tools-" + group}>
          <h2 id={"tools-" + group} className="text-sm font-medium text-foreground">{group}</h2>
          {group === "Maintenance" && <p className="mt-1 text-xs text-faint">These change your tracker file. Each asks before it runs.</p>}
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {SCRIPT_TOOLS.filter((t) => t.group === group).map((tool) => (
              <li key={tool.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{tool.label}</p>
                  <p className="text-xs text-faint">{tool.description}</p>
                </div>
                {confirming === tool.id ? (
                  <span className="flex items-center gap-2">
                    <button onClick={() => run(tool.id)} className="rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand-200">Yes, run it</button>
                    <button onClick={() => setConfirming(null)} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover">Cancel</button>
                  </span>
                ) : (
                  <button
                    onClick={() => (tool.writes ? setConfirming(tool.id) : run(tool.id))}
                    disabled={running !== null}
                    aria-label={"Run " + tool.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50 max-sm:min-h-[44px]"
                  >
                    {running === tool.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    Run
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-live="polite" aria-label="Tool output">
        {running && <p className="text-sm text-faint">Running…</p>}
        {output && (
          <div className="rounded-xl border border-border bg-background">
            <p className="border-b border-border px-4 py-2 text-xs text-muted">{(shown?.label ?? output.id) + " — " + outcome}</p>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs text-foreground">{output.error || output.output || "No output."}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
