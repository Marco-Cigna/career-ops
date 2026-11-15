/**
 * location-city.mjs: the tracker's City column, from a posting location.
 *
 * Evaluation reports record where a job is in two places: the Machine Summary's
 * `posting_location` and the `**Location:**` header line. Both hold the JD's own
 * wording ("Sydney, New South Wales, Australia", "Hybrid - London, Berlin",
 * "Oslo (NO), Hamburg (DE) or Bucharest (RO)"). The tracker keeps only the
 * city, so the same city is one value however the posting spelled its region,
 * and analytics can group on it. Pure: no file access.
 */

const MAX_CITIES = 3;
const EMPTY = /^(?:null|none|n\/a|—|-|unknown|not (?:stated|specified)|tbd)$/i;
const WORK_MODE = /^(?:remote|hybrid|on[- ]?site|in[- ]?office|flexible)\b\s*[-–—:,]?\s*/i;
// "(NO)", "(UK)", "(Germany)": a country label after a city.
const COUNTRY_TAG = /\s*\([^)]{1,30}\)/g;

/** One line, no pipes or tabs (they would split a tracker row). */
function clean(value) {
  return String(value ?? '').replace(/[|\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The city (or cities) in a posting location, "" when none is stated.
 *   "Sydney, New South Wales, Australia" → "Sydney"
 *   "Boston, MA; Vancouver, British Columbia, Canada" → "Boston / Vancouver"
 *   "Oslo (NO), Hamburg (DE), London (UK) or Bucharest (RO)" → "Oslo / Hamburg / London +1"
 *   "Hybrid - London, Berlin" → "London" (a comma after a city is its region)
 *   "Remote" → "Remote";  "Australia" → "Australia" (only a country is stated)
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function cityFromLocation(raw) {
  let text = clean(raw).replace(/^["']|["']$/g, '').trim();
  if (!text || EMPTY.test(text)) return '';
  if (/^remote\b/i.test(text) && !/[,;(]/.test(text.replace(/^remote\b\s*[-–—:]?\s*/i, ''))) {
    const rest = text.replace(/^remote\b\s*[-–—:]?\s*/i, '').trim();
    if (!rest) return 'Remote';
  }
  text = text.replace(WORK_MODE, '').trim();
  if (!text) return '';
  // Alternatives: "A; B", "A or B", "A / B", "A | B".
  let options = text.split(/\s*(?:;|\s\/\s|\bor\b|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  // With country tags, commas separate cities, not a city from its region.
  if (COUNTRY_TAG.test(text)) {
    options = options.flatMap((s) => s.split(','));
  }
  const cities = [];
  for (const option of options) {
    const city = option.replace(COUNTRY_TAG, '').split(',')[0].replace(WORK_MODE, '').trim();
    if (city && !EMPTY.test(city) && !cities.some((c) => c.toLowerCase() === city.toLowerCase())) cities.push(city);
  }
  if (!cities.length) return '';
  const shown = cities.slice(0, MAX_CITIES).join(' / ');
  const more = cities.length - MAX_CITIES;
  return clean(more > 0 ? `${shown} +${more}` : shown).slice(0, 80);
}

/**
 * The posting location an evaluation report states: the Machine Summary's
 * `posting_location`, else the `**Location:**` header line. "" when neither.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function reportLocation(markdown) {
  const text = String(markdown ?? '');
  const summary = text.match(/^##\s+Machine Summary[\s\S]*?```(?:ya?ml)?\s*([\s\S]*?)```/im)?.[1] ?? '';
  const fromSummary = summary.match(/^\s*posting_location:\s*(.+)$/m)?.[1]?.trim() ?? '';
  if (fromSummary && !EMPTY.test(fromSummary.replace(/^["']|["']$/g, ''))) return fromSummary.replace(/^["']|["']$/g, '');
  // The first one: the report header, or the archived JD's own, which is the
  // same posting's location.
  return text.match(/^\*\*Location:\*\*\s*(.+)$/m)?.[1]?.trim() ?? '';
}

/** The City cell for a report: its stated location reduced to the city. */
export function reportCity(markdown) {
  return cityFromLocation(reportLocation(markdown));
}
