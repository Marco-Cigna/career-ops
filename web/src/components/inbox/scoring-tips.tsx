"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Lightbulb, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { useJobs } from "@/components/jobs/job-store";
import { FULL_EVALUATION } from "@/lib/evaluation-options.mjs";
import { scoringTips } from "@/lib/token-tips.mjs";

// Shown in the shortlist's confirm step, before any token is spent: the
// situational tips (cache warmth, aggregator links, sections) always, the
// standing ones behind "More ways to save".
export function ScoringTips({ items, sections }: { items: { url: string }[]; sections: string[] }) {
  const { jobs } = useJobs();
  const [more, setMore] = useState(false);
  const allSections = FULL_EVALUATION.every((id) => sections.includes(id));
  const tips = scoringTips({ items, jobs, now: Date.now(), allSections });
  const situational = tips.filter((t) => !["profile", "triage", "drafts"].includes(t.id));
  const standing = tips.filter((t) => ["profile", "triage", "drafts"].includes(t.id));
  return (
    <section aria-label="Ways to spend fewer tokens" className="mb-3 rounded-xl border border-border bg-surface-hover/40 px-3 py-2.5 text-xs">
      <p className="mb-1.5 inline-flex items-center gap-1.5 font-medium text-foreground">
        <Lightbulb className="size-3.5 text-brand-text" /> Spend fewer tokens
      </p>
      <ul className="space-y-1.5">
        {situational.map((t) => (
          <li key={t.id} className="flex gap-2 leading-relaxed text-muted">
            {t.tone === "warn" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            ) : (
              <Zap className={cn("mt-0.5 size-3.5 shrink-0", t.tone === "good" ? "text-emerald-500" : "text-faint")} />
            )}
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="mt-1.5 inline-flex items-center gap-1 text-faint transition-colors hover:text-foreground max-sm:min-h-[44px]"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} /> More ways to save
      </button>
      {more && (
        <ul className="mt-1 space-y-1.5 border-t border-border/60 pt-1.5">
          {standing.map((t) => (
            <li key={t.id} className="flex gap-2 leading-relaxed text-muted">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-faint" />
              <span>{t.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
