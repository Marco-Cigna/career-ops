/**
 * external-applied.mjs: the pure half of "Add applied job" on the Pipeline page.
 *
 * The user applied somewhere on their own (LinkedIn, a careers site) and wants
 * the tracker to know. They type company and role, or prefill them from the
 * link (posting-meta.mjs, a plain scrape, no model), and the row goes in
 * through the normal tracker-addition TSV + merge-tracker.mjs path, dated
 * today, with no score and no report. Everything here is a value in, value out.
 */

const FIELD_MAX = 120;

/** One tracker-safe line: no tabs, newlines or pipes, at most FIELD_MAX characters. */
export function cleanField(value) {
  const text = String(value ?? "").replace(/[\t\r\n|]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > FIELD_MAX ? text.slice(0, FIELD_MAX).trim() : text;
}

/** An absolute http(s) URL with no whitespace, or null. */
export function cleanUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || /\s|\|/.test(raw) || raw.length > 2000) return null;
  try {
    return new URL(raw).hostname ? raw : null;
  } catch {
    return null;
  }
}

/** Today's date in the server's local time zone, YYYY-MM-DD. */
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The posting's host, for the "Applied via" note ("linkedin.com"). */
export function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Labels match TSV_ADDITION_HEADER (tracker-parse.mjs); merge-tracker resolves them by name. */
const LABELS = ["num", "date", "company", "role", "location", "status", "score", "pdf", "report", "notes", "url"];

/**
 * Header plus one data row. The row goes in as Evaluated with the N/A score
 * sentinel and no report, then set-status.mjs moves it to Applied, so the
 * status ledger and follow-up seeding see a real transition.
 */
export function appliedTsv({ num, date, company, role, city = "", notes, url }) {
  const fields = [num, date, cleanField(company), cleanField(role), cleanField(city) || "—", "Evaluated", "N/A", "❌", "—", cleanField(notes), url];
  return `${LABELS.join("\t")}\n${fields.join("\t")}\n`;
}

/** The tracker filename slug for a company. */
export function companySlug(company) {
  return String(company ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";
}

/** The note on the new row: where it was applied. The city has its own column. */
export function appliedNote({ url }) {
  const host = sourceHost(url);
  return `Applied outside career-ops${host ? ` via ${host}` : ""}`;
}

/**
 * Validate a save request. Returns the clean fields or a user-facing error.
 * @returns {{ok: true, url: string, company: string, role: string, city: string} | {ok: false, error: string}}
 */
export function validateSave(body) {
  const url = cleanUrl(body?.url);
  if (!url) return { ok: false, error: "Paste a full job link that starts with https://." };
  const company = cleanField(body?.company);
  const role = cleanField(body?.role);
  if (!company) return { ok: false, error: "Enter the company name." };
  if (!role) return { ok: false, error: "Enter the role." };
  return { ok: true, url, company, role, city: cleanField(body?.city) };
}
