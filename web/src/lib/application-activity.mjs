/**
 * application-activity.mjs — what the user has actually sent, and what came back.
 *
 * The Progress view's funnel counts tracker rows, most of which are evaluations
 * that were never sent. This module looks only at applications: rows whose
 * status says they went out, or whose ledger says they once did.
 *
 * Dates, most trusted first:
 *   applied:  "Applied YYYY-MM-DD" in Notes (the convention followup-cadence.mjs
 *             and funnel-velocity.mjs read), then the ledger's first move into
 *             Applied, then the tracker's Date column.
 *   response: the ledger's first move from Applied into a reply state on or
 *             after the applied date. A row whose status is a reply state but
 *             whose ledger never says when counts as a response with no date.
 *
 * Pure: no filesystem, no clock (today is passed in). Tested in
 * web/tests/lib/application-activity.test.mjs.
 */
import { canonStatus } from "./status-alias.mjs";

const SENT = new Set(["APPLIED", "RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);
const REPLY = new Set(["RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);
const INTERVIEW_OR_LATER = new Set(["INTERVIEW", "OFFER", "HIRED"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const validIso = (s) => {
  if (!ISO.test(String(s ?? ""))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const monthKey = (iso) => iso.slice(0, 7);

/** "Applied 2026-06-28" anywhere in Notes. */
export function appliedDateFromNotes(notes) {
  const m = String(notes ?? "").match(/\bApplied (\d{4}-\d{2}-\d{2})\b/);
  return m && validIso(m[1]) ? m[1] : null;
}

/** Where an application went in: the job board or ATS behind its posting URL. */
export function applicationSource(url) {
  const href = String(url ?? "").match(/\((https?:[^)\s]+)\)/)?.[1] ?? String(url ?? "").trim();
  let host = "";
  try {
    host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
  if (/(^|\.)linkedin\.com$/.test(host)) return "LinkedIn";
  if (/(^|\.)seek\.com(\.au)?$|(^|\.)seek\.co\.nz$/.test(host)) return "SEEK";
  if (/(^|\.)indeed\./.test(host)) return "Indeed";
  if (/(^|\.)thehub\.io$/.test(host)) return "The Hub";
  // Anything else is an ATS board or the employer's own careers page.
  return "Company careers site";
}

/** Hybrid / Remote / On-site, when Notes say so. */
export function workArrangement(notes) {
  const t = String(notes ?? "").toLowerCase();
  if (/\bhybrid\b/.test(t)) return "Hybrid";
  if (/\bremote\b/.test(t)) return "Remote";
  if (/\bon-?site\b|\bin-office\b/.test(t)) return "On-site";
  return "Not stated";
}

function breakdown(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {{
 *   applications: {n: string, date: string, status: string, notes: string, url: string}[],
 *   statusLog: {num: number, date: string, from: string, to: string}[],
 *   today: string,
 *   goals?: {perYear?: number|null, per30Days?: number|null},
 * }} input
 */
export function computeApplicationActivity({ applications = [], statusLog = [], today, goals = {} }) {
  const ledger = new Map();
  for (const row of statusLog) {
    if (!validIso(row?.date)) continue;
    const list = ledger.get(String(row.num)) ?? [];
    list.push({ date: row.date, from: canonStatus(row.from || "-"), to: canonStatus(row.to || "-") });
    ledger.set(String(row.num), list);
  }
  for (const list of ledger.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const sent = [];
  for (const app of applications) {
    const status = canonStatus(app?.status);
    const events = ledger.get(String(app?.n)) ?? [];
    const everSent = SENT.has(status) || events.some((e) => SENT.has(e.to));
    if (!everSent) continue;
    const applied = appliedDateFromNotes(app.notes)
      ?? events.find((e) => e.to === "APPLIED")?.date
      ?? (validIso(app.date) ? app.date : null);
    const reply = events.find((e) => REPLY.has(e.to) && (!applied || e.date >= applied));
    const replied = Boolean(reply) || REPLY.has(status);
    sent.push({
      n: String(app.n),
      status,
      applied,
      responseDate: reply?.date ?? null,
      replied,
      rejected: status === "REJECTED",
      interviewed: INTERVIEW_OR_LATER.has(status) || events.some((e) => INTERVIEW_OR_LATER.has(e.to)),
      offered: status === "OFFER" || status === "HIRED" || events.some((e) => e.to === "OFFER" || e.to === "HIRED"),
      source: applicationSource(app.url),
      arrangement: workArrangement(app.notes),
    });
  }

  const todayDay = validIso(today) ? dayNumber(today) : null;
  const dated = sent.filter((s) => s.applied);
  const within = (days) => (todayDay === null ? 0 : dated.filter((s) => {
    const d = dayNumber(s.applied);
    return d <= todayDay && d > todayDay - days;
  }).length);
  const thisMonth = validIso(today) ? dated.filter((s) => monthKey(s.applied) === monthKey(today)).length : 0;
  const thisYear = validIso(today) ? dated.filter((s) => s.applied.slice(0, 4) === today.slice(0, 4)).length : 0;
  const responseDays = sent
    .filter((s) => s.applied && s.responseDate)
    .map((s) => dayNumber(s.responseDate) - dayNumber(s.applied));
  const first = dated.reduce((min, s) => (!min || s.applied < min ? s.applied : min), null);
  const last = dated.reduce((max, s) => (!max || s.applied > max ? s.applied : max), null);
  const trackingDays = first && todayDay !== null ? Math.max(1, todayDay - dayNumber(first) + 1) : 0;

  // Twelve calendar months ending with today's.
  const months = [];
  if (validIso(today)) {
    const [y, m] = today.split("-").map(Number);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      const key = d.toISOString().slice(0, 7);
      months.push({
        key,
        label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
        applied: dated.filter((s) => monthKey(s.applied) === key).length,
        responses: sent.filter((s) => s.responseDate && monthKey(s.responseDate) === key).length,
      });
    }
  }

  const total = sent.length;
  const responses = sent.filter((s) => s.replied).length;
  const goal = (target, count) => (Number.isFinite(target) && target > 0 ? { target, count, pct: Math.min(100, (count / target) * 100) } : null);
  return {
    total,
    awaiting: sent.filter((s) => s.status === "APPLIED").length,
    responses,
    responseRate: total ? (responses / total) * 100 : null,
    rejected: sent.filter((s) => s.rejected).length,
    interviews: sent.filter((s) => s.interviewed).length,
    offers: sent.filter((s) => s.offered).length,
    last7: within(7),
    last30: within(30),
    thisMonth,
    thisYear,
    avgResponseDays: responseDays.length ? responseDays.reduce((a, b) => a + b, 0) / responseDays.length : null,
    medianResponseDays: median(responseDays),
    responseSamples: responseDays.length,
    firstApplied: first,
    lastApplied: last,
    trackingDays,
    perWeek: trackingDays ? (dated.length / trackingDays) * 7 : 0,
    months,
    sources: breakdown(sent.map((s) => s.source)),
    arrangements: breakdown(sent.map((s) => s.arrangement)),
    goals: {
      year: goal(goals.perYear, thisYear),
      rolling30: goal(goals.per30Days, within(30)),
    },
  };
}
