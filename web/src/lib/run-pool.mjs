/**
 * Run `fn` over `items`, at most `limit` at a time, in order of start. Stops
 * starting new items once `signal` aborts; items already running finish.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} fn
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function runPool(items, limit, fn, signal) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
