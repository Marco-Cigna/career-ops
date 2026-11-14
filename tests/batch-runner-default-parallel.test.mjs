import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBatch } from './helpers/batch-runner-fixture.mjs';

test('claude batches default to 3 workers and drop to 1 after a rate limit', () => {
  const { stdout, starts } = runBatch({ offers: 6 });
  assert.match(stdout, /Parallel: 3 \|/);
  assert.match(stdout, /Rate limited: running the remaining offers on 1 worker/);
  assert.equal(Math.max(starts['2'], starts['3']), 2, 'offers 2 and 3 ran next to each other');
  assert.deepEqual([starts['4'], starts['5'], starts['6']], [1, 1, 1]);
});

test('the prompt-cache warm-up starts the first worker alone, then the rest together', () => {
  // Ends when that worker exits, so a 30 s setting costs this run about a second.
  const { stdout, starts } = runBatch({ offers: 3, rateLimitFirst: false, env: { CACHE_WARMUP_SECONDS: '30' } });
  assert.match(stdout, /Cache warm-up: starting other workers in 30s/);
  assert.equal(starts['1'], 1, 'offer 1 ran alone');
  assert.equal(Math.max(starts['2'], starts['3']), 2, 'offers 2 and 3 then ran next to each other');
});

test('an explicit --parallel 1 keeps one worker', () => {
  const { stdout } = runBatch({ offers: 2, args: ['--parallel', '1'] });
  assert.match(stdout, /Parallel: 1 \|/);
});
