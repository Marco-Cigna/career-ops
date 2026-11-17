import type { InboxJob } from "@/lib/career-ops";
import { postingHref } from "@/lib/posting-url.mjs";

export function DiscardedInbox({ jobs }: { jobs: InboxJob[] }) {
  return (
    <section aria-label="Jobs removed by Filter" className="mt-4">
      <h2 className="text-sm font-medium text-foreground">Removed by Filter ({jobs.length})</h2>
      <p className="mt-1 text-xs text-muted">Removal reason and triage score, newest first.</p>
      <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface/30">
        {jobs.map((job) => {
          const href = postingHref(job.url);
          return (
            <li key={job.url} className="px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="hover:text-brand-text hover:underline">
                    {job.company} · {job.role}
                  </a>
                ) : `${job.company} · ${job.role}`}
              </p>
              <p className="mt-1 text-xs text-muted">
                {[
                  job.location,
                  job.triage?.at ? `Removed ${job.triage.at.slice(0, 10)}` : null,
                  job.triage?.score == null ? null : `Triage ${job.triage.score}/5`,
                ].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-sm text-muted">{job.triage?.reason || "Removed by the inbox filter."}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
