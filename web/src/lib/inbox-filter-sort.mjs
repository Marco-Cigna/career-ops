import { orderInbox } from "./core/inbox-rank.mjs";

/**
 * Filter scores highest first, unscored rows last. Reuse the core's recency
 * and stable tie-breaking rules, keeping profile fit separate from triage.
 * @template {{triage?: {score?: number|null}, postedAt?: string}} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function orderInboxByFilterScore(rows) {
  return orderInbox(rows.map((row) => {
    const score = row.triage?.score;
    return {
      row,
      postedAt: row.postedAt,
      fit: typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 5 ? { score } : null,
    };
  })).map((entry) => entry.row);
}
