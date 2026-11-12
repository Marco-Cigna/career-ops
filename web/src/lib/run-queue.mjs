/**
 * A small FIFO limiter for queued evaluations (Score shortlist, scheduled
 * scoring). Every job used to start at once, whatever pipeline.parallel said.
 * Client-side on purpose: a request parked on the server would hold one of the
 * browser's six connections to localhost, and a shortlist of ten would stall
 * every other call the page makes.
 *
 * @param {() => Promise<number>} readLimit resolves to the current limit (>= 1)
 */
export function createRunQueue(readLimit) {
  let active = 0;
  /** @type {Array<() => void>} */
  const waiting = [];
  let limit = 1;
  const pump = () => {
    while (active < limit && waiting.length) {
      active += 1;
      waiting.shift()?.();
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
      pump();
    },
    get waiting() { return waiting.length; },
    get active() { return active; },
  };
}
