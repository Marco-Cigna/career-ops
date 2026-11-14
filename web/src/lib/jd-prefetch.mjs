/**
 * Read a posting's JD on the server before an evaluate worker starts.
 *
 * The evaluate worker has no Bash (it reads an untrusted posting, so it cannot
 * be allowed to write), and its only way to read the web is WebFetch, which
 * converts a page to text and drops <script> content. Template-driven career
 * boards (Phenom, most bespoke sites) keep the whole job body in script data,
 * so WebFetch sees a page shell and the worker stops with "Needs review" on a
 * posting that is live. fetch-jd.mjs reads those sources (ATS API, then the
 * page's JSON-LD JobPosting) behind the egress guard, so the platform runs it
 * first and hands the text to the worker.
 *
 * When fetch-jd misses, a headless-browser read (browser-extract.mjs, zero model
 * tokens) is tried next. It renders the page the way WebFetch cannot, so:
 *  - it finds text → the worker gets the posting and never fetches;
 *  - the page rendered but holds no job text, or says the posting is gone →
 *    `unreadable`: the caller starts no model run (one used to spend ~100k
 *    tokens discovering the same thing through WebFetch);
 *  - anything that says nothing about the posting (no Playwright, a bot wall,
 *    a timeout, a LinkedIn URL, which the browser never reads) → a plain miss,
 *    and the worker falls back to WebFetch exactly as before.
 */

// A stub is not a posting. Same intent as MIN_JD_TEXT_CHARS in browser-extract.mjs.
export const MIN_PREFETCH_JD_CHARS = 400;

// Same floor prescreen.mjs and batch-runner.sh apply to a browser read: below it
// the page was a login wall or navigation.
export const MIN_BROWSER_JD_WORDS = 200;

/** browser-extract failure codes that are a finding about the posting itself. */
const UNREADABLE_CODES = Object.freeze({
  empty_text: "the page loaded, but no job text was found on it",
  unavailable: "the page says the posting is no longer available",
});

/** LinkedIn's JD loading guard (AGENTS.md #4121): the browser tier never reads it. */
export function isLinkedInUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

/** Does a prefetched JD carry the cut notice from lib/jd-page-fetch.mjs? Such text is not the whole posting. */
export function isTruncatedJd(text) {
  return typeof text === "string" && /\[Job description truncated here:/.test(text);
}

/** The posting URL when `input` is one; null for report numbers and local refs. */
export function postingUrlFrom(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try { new URL(value); } catch { return null; }
  return value;
}

/**
 * @typedef {{text: string|null, closedEvidence: string|null, unreadable?: string|null, source?: "api"|"browser"|null}} Prefetch
 */

/**
 * @param {unknown} input - the run input (a posting URL for evaluate runs)
 * @param {(script: string, args: string[], opts?: {signal?: AbortSignal}) => Promise<{code: number, stdout: string, stderr?: string, timedOut?: boolean, spawnFailed?: boolean}>} run
 * @param {AbortSignal} [signal] the request's abort signal; an abort kills the child and is a miss
 * @param {{browser?: boolean}} [opts] - `browser: false` skips the headless-browser tier
 * @returns {Promise<Prefetch>} `text` is the JD, or null when the worker should
 *   WebFetch; `closedEvidence` is set when the page's own data says the posting
 *   closed (fetch-jd exit 3), which the worker must not score past; `unreadable`
 *   names why a rendered page gave no posting, and then no worker should start.
 */
export async function prefetchJd(input, run, signal, { browser = true } = {}) {
  const miss = { text: null, closedEvidence: null, unreadable: null, source: null };
  const url = postingUrlFrom(input);
  if (!url || signal?.aborted) return miss;
  try {
    const result = await run("fetch-jd", [url], { signal });
    if (!result.timedOut && !result.spawnFailed) {
      const out = String(result.stdout ?? "").trim();
      if (result.code === 3) {
        const m = /^CLOSED_POSTING ([\s\S]{1,200})$/.exec(out);
        return m ? { ...miss, closedEvidence: m[1] } : miss;
      }
      if (result.code === 0 && out.length >= MIN_PREFETCH_JD_CHARS) return { ...miss, text: out, source: "api" };
    }
  } catch {
    /* fall through to the browser tier */
  }
  if (!browser || signal?.aborted || isLinkedInUrl(url)) return miss;
  return browserTier(url, run, signal, miss);
}

async function browserTier(url, run, signal, miss) {
  try {
    // Under runCoreCli's own 30s kill: a slow page is a miss, not a hang.
    const result = await run("browser-extract", [url, "--mode", "jd", "--timeout", "20000", "--max-chars", "60000"], { signal });
    if (result.timedOut || result.spawnFailed) return miss;
    if (result.code === 0) {
      const parsed = JSON.parse(String(result.stdout ?? ""));
      const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
      // A capped read ends with the helper's literal "…": not the whole posting.
      if (text.endsWith("…") || text.split(/\s+/).length < MIN_BROWSER_JD_WORDS) return miss;
      return { ...miss, text, source: "browser" };
    }
    const failure = lastJsonLine(String(result.stderr ?? ""));
    const reason = failure && Object.hasOwn(UNREADABLE_CODES, failure.code) ? UNREADABLE_CODES[failure.code] : null;
    return reason ? { ...miss, unreadable: reason } : miss;
  } catch {
    return miss;
  }
}

function lastJsonLine(text) {
  const lines = text.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") return value;
    } catch {
      /* not JSON */
    }
  }
  return null;
}
