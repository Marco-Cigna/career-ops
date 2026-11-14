// When and how a posting reached the inbox, from data/scan-history.tsv.
//
// pipeline.md rows carry no date of their own. The scanner writes one
// scan-history row per posting it adds, with first_seen (col 2) and the source
// it came from (col 3: `{provider}-api` from scan.mjs, `{provider}-full` from
// scan-ats-full.mjs), so the inbox reads both from there. A row the scanners
// never saw (pasted by hand, a LinkedIn alert) has no entry and shows neither.

/**
 * @param {string[]} lines - scan-history.tsv split into lines
 * @returns {Map<string, {date: string, portal: string}>} url → first sighting
 */
export function parseScanOrigins(lines) {
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line || (i === 0 && line.startsWith("url\t"))) continue;
    const cols = line.split("\t");
    const url = cols[0];
    const date = cols[1]?.trim() ?? "";
    if (!url || !/^\d{4}-\d{2}-\d{2}$/.test(date) || out.has(url)) continue;
    out.set(url, { date, portal: cols[2]?.trim() ?? "" });
  }
  return out;
}

/**
 * The scan that found it, in the words the Scan page and scheduled jobs use
 * (schedule-label.mjs). Unknown sources are shown as written.
 *
 * @param {string | undefined} portal
 * @returns {string}
 */
export function addedViaLabel(portal) {
  const p = (portal ?? "").trim().toLowerCase();
  if (!p) return "";
  if (p.endsWith("-full")) return "All job boards";
  if (p.endsWith("-api")) return "Saved companies";
  if (p === "manual") return "Added by hand";
  if (p.startsWith("linkedin")) return "LinkedIn";
  return portal ?? "";
}

/**
 * "today", "yesterday", or a short date ("14 Nov"; with the year when it is not this year).
 *
 * @param {string | undefined} date - YYYY-MM-DD
 * @param {number} now
 * @returns {string}
 */
export function addedLabel(date, now) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  // A fixed format, not toLocaleDateString: the row renders on the server and
  // again in the browser, and two locales would disagree.
  return `${d} ${MONTHS[m - 1]}${y === today.getFullYear() ? "" : ` ${y}`}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
