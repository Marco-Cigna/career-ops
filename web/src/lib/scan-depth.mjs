// Scan depth for the full-network scanner (scan-ats-full.mjs): how many
// companies per source a scan checks, and how long that takes. Plain JS with no
// node imports, so the Explore form, the server route and the scheduled runner
// all read the same numbers.

/** "Every company the source lists". Larger than any source's directory, so the
 *  scanner's `--limit` slice returns the whole list. */
export const DEPTH_ALL = 100_000;
export const DEPTH_MIN = 50;
export const DEPTH_DEFAULT = 150;
/** The slider's stops. Spaced roughly geometrically: going from 50 to 100 matters
 *  as much as going from 2,000 to 4,000. */
export const DEPTH_STOPS = [50, 100, 150, 250, 500, 1_000, 2_000, 4_000, 8_000, DEPTH_ALL];

/** No Explore scan runs longer than this, however deep: someone is watching it. */
export const DEPTH_BUDGET_CEILING_MS = 60 * 60 * 1_000;
/** No scheduled scan runs longer than this. It runs unattended in the
 *  background, so it gets more room than Explore. */
export const SCHEDULED_BUDGET_CEILING_MS = 2 * 60 * 60 * 1_000;
/** The longest one scheduled run can take: up to three attempts
 *  (scheduled-jobs-runner.mjs MAX_ATTEMPTS) at the ceiling, plus a minute. The
 *  runner's lock and the Run now route both wait this long before giving up on
 *  it; web/scripts/install-scan-schedule.* give the OS task more than this. */
export const SCHEDULED_RUN_LIMIT_MS = SCHEDULED_BUDGET_CEILING_MS * 3 + 60_000;

// Seconds per company at the scanner's own per-host concurrency, measured with
// `--shuffle --dry-run` sweeps on 2026-11-14 (Greenhouse 120 companies in 6.6s,
// Lever 300 in 40s, Ashby 300 in 12s, Workday 120 in 197s), rounded up. The
// company counts are the directory sizes that day; they only cap the estimate
// for "All", and the directories grow, so they are rounded up too.
const SOURCE_SPEED = {
  greenhouse: { secondsPerCompany: 0.06, companies: 8_400 },
  lever: { secondsPerCompany: 0.14, companies: 4_400 },
  ashby: { secondsPerCompany: 0.045, companies: 3_200 },
  workday: { secondsPerCompany: 1.7, companies: 12_000 },
};
const UNKNOWN_SOURCE = { secondsPerCompany: 0.2, companies: 5_000 };

/** A depth from any input (number, numeric string, or "all"), kept within
 *  DEPTH_MIN..DEPTH_ALL. Anything unreadable gives `fallback`. */
export function clampDepth(value, fallback = DEPTH_DEFAULT) {
  if (typeof value === "string" && value.trim().toLowerCase() === "all") return DEPTH_ALL;
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(DEPTH_ALL, Math.max(DEPTH_MIN, Math.round(n)));
}

/** Index of the slider stop closest to `depth` (a depth from an old URL, such as
 *  300, lands on the nearest stop). */
export function depthStopIndex(depth) {
  let best = 0;
  for (let i = 1; i < DEPTH_STOPS.length; i += 1) {
    if (Math.abs(DEPTH_STOPS[i] - depth) < Math.abs(DEPTH_STOPS[best] - depth)) best = i;
  }
  return best;
}

export function depthLabel(depth) {
  return depth >= DEPTH_ALL ? "All companies" : `${depth.toLocaleString("en-US")} companies`;
}

/** Estimated seconds for one source at this depth. */
export function estimateSourceSeconds(ats, depth) {
  const speed = SOURCE_SPEED[ats] ?? UNKNOWN_SOURCE;
  return Math.min(depth, speed.companies) * speed.secondsPerCompany;
}

/** Estimated seconds for a whole scan. Explore runs one scanner per source in
 *  parallel (the slowest source decides); a scheduled scan runs every source in
 *  one scanner, one after another (they add up). */
export function estimateScanSeconds(atsList, depth, { parallel = true } = {}) {
  const each = atsList.map((ats) => estimateSourceSeconds(ats, depth));
  if (!each.length) return 0;
  return parallel ? Math.max(...each) : each.reduce((sum, s) => sum + s, 0);
}

/** Time budget for a scanner run: the estimate with 50% headroom plus a minute
 *  for the dataset download and start-up, never below `floorMs` (the configured or
 *  default budget) and never above `ceilingMs`. */
export function depthBudgetMs(estimateSeconds, floorMs, ceilingMs = DEPTH_BUDGET_CEILING_MS) {
  const wanted = Math.ceil(estimateSeconds * 1.5 + 60) * 1_000;
  return Math.max(floorMs, Math.min(ceilingMs, wanted));
}

export function formatScanDuration(seconds) {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min` : `about ${hours} h`;
}
