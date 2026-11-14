/**
 * A small FIFO limiter for queued evaluations (Score shortlist, scheduled
 * scoring). Every job used to start at once, whatever pipeline.parallel said.
 * Client-side on purpose: a request parked on the server would hold one of the
 * browser's six connections to localhost, and a shortlist of ten would stall
 * every other call the page makes.
 *
 * Prompt-cache warm-up (`warmupMs`): every evaluation shares one system-prompt
 * context pack (eval-context-pack.mjs), cached by the API for a few minutes after
 * its last use. Jobs that start together on a cold cache each pay to write that
 * whole prefix. So when the queue has been idle longer than the cache lives, the
 * first job runs alone for `warmupMs` (or until it finishes) and the rest then
 * read its cache. With a limit of 1 it changes nothing.
 *
 * @param {() => Promise<number>} readLimit resolves to the current limit (>= 1)
 * @param {{ warmupMs?: number, coldAfterMs?: number, now?: () => number, schedule?: (fn: () => void, ms: number) => unknown }} [opts]
 */
export function createRunQueue(readLimit, { warmupMs = 0, coldAfterMs = 4 * 60_000, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  let active = 0;
  /** @type {Array<() => void>} */
  const waiting = [];
  let limit = 1;
  let warmUntil = 0;
  let lastActivity = -Infinity;
  let timer = null;
  const pump = () => {
    while (waiting.length) {
      const cap = now() < warmUntil ? 1 : limit;
      if (active >= cap) break;
      // A start from idle on a cache that has expired: hold the other slots.
      if (active === 0 && warmupMs > 0 && limit > 1 && now() - lastActivity > coldAfterMs) {
        warmUntil = now() + warmupMs;
      }
      active += 1;
      lastActivity = now();
      waiting.shift()?.();
    }
    if (waiting.length && active < limit && now() < warmUntil && timer === null) {
      timer = schedule(() => { timer = null; pump(); }, Math.max(0, warmUntil - now()));
    }
  };
  return {
    /** Resolves when a slot is free. `queued` is true when the caller had to wait. */
    async acquire() {
      try {
        const next = await readLimit();
        if (Number.isInteger(next) && next >= 1) limit = next;
      } catch { /* keep the last known limit */ }
      const queued = active >= limit || waiting.length > 0;
      await new Promise((resolve) => { waiting.push(() => resolve(undefined)); pump(); });
      return { queued };
    },
    release() {
      active = Math.max(0, active - 1);
      lastActivity = now();
      // The first job finished: its cache is written, so the rest need not wait.
      warmUntil = 0;
      pump();
    },
    get waiting() { return waiting.length; },
    get active() { return active; },
    /** True while the first job of a burst runs alone to prime the prompt cache. */
    get warmingUp() { return now() < warmUntil && waiting.length > 0; },
  };
}
