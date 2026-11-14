/**
 * token-tips.mjs — what the user can do, before they spend, to make scoring cheaper.
 *
 * The levers are real mechanisms, not general advice:
 *  - every evaluation shares one cached context pack (eval-context-pack.mjs);
 *    the API keeps it for about 5 minutes after its last use, so evaluations run
 *    back to back reuse it and an isolated one pays to load it;
 *  - a posting the platform can read itself (an employer ATS link) costs no
 *    tokens to fetch; an aggregator link may need the model to fetch it, or a
 *    paste;
 *  - editing the profile files rebuilds the shared pack (one full-price run);
 *  - output is the largest remaining cost: unticked sections are not written.
 *
 * Plain module, so the tip rules are tested as values.
 */

/**
 * How long the shared context is CERTAINLY still cached after an evaluation.
 * Claude Code writes it with a 5-minute or a 1-hour lifetime depending on the
 * account (a subscription account was measured at 1 hour), so this stays under
 * the shorter one: a "warm" claim is never wrong, only sometimes modest.
 */
export const CACHE_WARM_MS = 4 * 60_000;

const AGGREGATOR_HOSTS = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|seek\.com(\.au)?|glassdoor\.[a-z.]+|ziprecruiter\.com|wellfound\.com|naukri\.com|instahyre\.com|cutshort\.io|internshala\.com)$/i;

/** @param {string} url */
export function isAggregatorUrl(url) {
  try {
    return AGGREGATOR_HOSTS.test(new URL(url).hostname.replace(/\.$/, ""));
  } catch {
    return false;
  }
}

/**
 * Is the shared context likely still in the prompt cache? True while an
 * evaluation runs, and for CACHE_WARM_MS after the last one ended.
 * @param {{kind?: string, status: string, endedAt?: number}[]} jobs
 * @param {number} now
 */
export function sharedContextWarm(jobs, now) {
  return jobs.some((j) => j.kind === "evaluate" && (j.status === "running" || (typeof j.endedAt === "number" && now - j.endedAt < CACHE_WARM_MS)));
}

/**
 * @typedef {{ id: string, tone: "good" | "warn" | "info", text: string }} Tip
 * @param {{ items: {url: string}[], jobs: {kind?: string, status: string, endedAt?: number}[], now: number, allSections: boolean }} input
 * @returns {Tip[]} the situational tips first, then the standing ones
 */
export function scoringTips({ items, jobs, now, allSections }) {
  /** @type {Tip[]} */
  const tips = [];
  const warm = sharedContextWarm(jobs, now);
  if (warm) {
    tips.push({ id: "warm", tone: "good", text: "The shared evaluation context is still cached from your last run, so scoring now reuses it at a fraction of the cost." });
  } else if (items.length > 1) {
    tips.push({ id: "batch", tone: "good", text: `These ${items.length} run back to back: the first loads the shared evaluation context, and each one after it reuses it from the cache for a fraction of the input cost.` });
  } else {
    tips.push({ id: "single", tone: "info", text: "Shortlist a few roles and score them in one sitting. The first evaluation loads the shared context; the ones after it reuse it from the cache for a fraction of the cost, for 5 minutes to an hour after each run depending on your Claude plan. Spread across the day, each one pays the full load." });
  }
  const aggregators = items.filter((it) => isAggregatorUrl(it.url)).length;
  if (aggregators > 0) {
    tips.push({ id: "aggregator", tone: "warn", text: `${aggregators === 1 ? "1 link is" : `${aggregators} links are`} from a job aggregator (LinkedIn, Indeed, SEEK…). The platform reads employer links (Greenhouse, Lever, Ashby, Workday, the company's careers page) for free; an aggregator link may cost the AI a fetch or need the job text pasted. Use the employer's own link where you can.` });
  }
  if (allSections) {
    tips.push({ id: "sections", tone: "info", text: "Writing the report is the biggest part of the cost. Only need the score? Untick the sections you won't read below." });
  }
  tips.push({ id: "profile", tone: "info", text: "Finish edits to your profile, target roles and house rules before a batch: changing them rebuilds the shared context, and the next evaluation pays the full load again. CV edits don't." });
  tips.push({ id: "triage", tone: "info", text: "Keep triage on (pipeline.triage: auto). A cheap first pass screens out weak matches before the full evaluation runs." });
  tips.push({ id: "drafts", tone: "info", text: "Cover letters and tailored CVs are not part of scoring. Create them from the report, only for roles you will apply to." });
  return tips;
}
