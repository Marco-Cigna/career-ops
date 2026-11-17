import { canonicalJobKey } from "./core/url-key.mjs";
import { readTrackerUrl } from "./posting-url.mjs";

const REMOVED_VERDICTS = new Set(["FAIL", "MARGINAL", "SKIP_RULES", "CLOSED"]);

/**
 * Filter removals remain checked off in pipeline.md. Show them on Discarded
 * without creating tracker rows or treating manually skipped/scored jobs as
 * Filter removals. A tracked posting is represented by its tracker row alone.
 *
 * @template {{url: string, done: boolean, triage?: {verdict: string, at: string}}} T
 * @param {T[]} inbox
 * @param {{url?: string}[]} applications
 * @returns {T[]}
 */
export function discardedInbox(inbox, applications) {
  const tracked = new Set(applications
    .map((app) => canonicalJobKey(readTrackerUrl(app.url)))
    .filter(Boolean));
  const seen = new Set();
  return inbox.filter((job) => {
    if (!job.done || !REMOVED_VERDICTS.has(job.triage?.verdict)) return false;
    const key = canonicalJobKey(job.url) || job.url;
    if (tracked.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => String(b.triage?.at ?? "").localeCompare(String(a.triage?.at ?? "")));
}

/**
 * Search also covers the removal reason. Missing rule/closed-posting scores
 * stay unknown and are excluded when a minimum score is requested.
 * @template {{company: string, role: string, location?: string, triage?: {reason: string, score: number|null}}} T
 * @param {T[]} jobs
 * @param {string} query
 * @param {number|null} minimum
 * @returns {T[]}
 */
export function filterDiscardedInbox(jobs, query, minimum) {
  const needle = query.trim().toLowerCase();
  return jobs.filter((job) => {
    const score = job.triage?.score;
    if (minimum != null && (score == null || !Number.isFinite(score) || score < minimum)) return false;
    return !needle || `${job.company} ${job.role} ${job.location ?? ""} ${job.triage?.reason ?? ""}`.toLowerCase().includes(needle);
  });
}
