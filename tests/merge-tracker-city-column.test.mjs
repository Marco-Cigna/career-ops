// tests/merge-tracker-city-column.test.mjs — the tracker's City column.
//
// `--migrate-location` inserts a City column after Role and fills it from each
// row's report; a merge fills it the same way for every new or updated row, so
// evaluations from any writer (web, interactive, batch) get a city without
// each writer having to know about the column. A value a TSV carries wins and
// is reduced to the city; a value already in the row is never replaced.
import { pass, fail, rmSync, ROOT, NODE, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const report = (location) => `# Acme — Engineer\n\n**Location:** ignored\n\n## Machine Summary\n\n\`\`\`yaml\nposting_location: ${location}\n\`\`\`\n`;

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'city-column-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'reports'));
  mkdirSync(join(dir, 'batch', 'tracker-additions'), { recursive: true });
  writeFileSync(join(dir, 'reports', '001-acme-2026-10-01.md'), report('"Sydney, New South Wales, Australia"'));
  writeFileSync(join(dir, 'reports', '003-globex-2026-10-02.md'), report('"Berlin, Germany"'));
  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-10-01 | Acme | Engineer | 4.0/5 | Applied | ❌ | [001](../reports/001-acme-2026-10-01.md) | n |',
    '| 2 | 2026-10-01 | Initech | Analyst | N/A | Applied | ❌ | — | typed by hand |',
    '',
  ].join('\n'));
  const run = (...args) => spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs'), ...args], {
    cwd: dir, encoding: 'utf-8', timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: join(dir, 'batch', 'tracker-additions'), CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(join(dir, 'state')) },
  });
  const rows = () => readFileSync(tracker, 'utf-8').split('\n').filter((l) => l.startsWith('|'));
  return { dir, run, rows };
}

console.log('\nmerge-tracker — City column');

ok('--migrate-location inserts City after Role and fills it from reports', () => {
  const w = workspace();
  try {
    const first = w.run('--migrate-location');
    assert.strictEqual(first.status, 0, `${first.stdout}${first.stderr}`);
    const [header, , row1, row2] = w.rows();
    assert.match(header, /\| Role \| City \| Score \|/, header);
    assert.match(row1, /\| Engineer \| Sydney \| 4\.0\/5 \|/, row1);
    assert.match(row2, /\| Analyst \| — \| N\/A \|/, row2);
    const second = w.run('--migrate-location');
    assert.match(second.stdout, /City column present; 0 filled/, second.stdout);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

ok('a merge fills City from the report, and a TSV value is reduced to its city', () => {
  const w = workspace();
  try {
    assert.strictEqual(w.run('--migrate-location').status, 0);
    const header = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';
    writeFileSync(join(w.dir, 'batch', 'tracker-additions', '003-globex.tsv'),
      `${header}\n3\t2026-10-02\tGlobex\tPlatform Engineer\tEvaluated\t3.5/5\t❌\t[003](reports/003-globex-2026-10-02.md)\tx\n`);
    writeFileSync(join(w.dir, 'batch', 'tracker-additions', '004-umbrella.tsv'),
      `${header}\tlocation\n4\t2026-10-03\tUmbrella\tData Engineer\tEvaluated\tN/A\t❌\t—\ty\tMelbourne, VIC, Australia\n`);
    const merged = w.run();
    assert.strictEqual(merged.status, 0, `${merged.stdout}${merged.stderr}`);
    const rows = w.rows();
    assert.ok(rows.some((r) => /\| Globex \| Platform Engineer \| Berlin \|/.test(r)), rows.join('\n'));
    assert.ok(rows.some((r) => /\| Umbrella \| Data Engineer \| Melbourne \|/.test(r)), rows.join('\n'));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
