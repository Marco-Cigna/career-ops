import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { editRow } from '../edit-row.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracker = [
  '| # | Date | Company | Role | City | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-10-01 | Acme | Engineer | — | 4.0/5 | Applied | ❌ | — | n |',
  '| 2 | 2026-10-01 | Globex | Analyst | Berlin | N/A | Applied | ❌ | — | n |',
];

test('only the named cells change, every other byte stays', () => {
  const r = editRow(tracker, '1', { company: 'Acme Corp', city: 'Sydney' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, ['company', 'city']);
  assert.equal(r.lines[2], '| 1 | 2026-10-01 | Acme Corp | Engineer | Sydney | 4.0/5 | Applied | ❌ | — | n |');
  assert.equal(r.lines[3], tracker[3]);
});

test('a pipe cannot split the row, an empty city becomes —, and company/role cannot be emptied', () => {
  assert.match(editRow(tracker, '2', { role: 'Data | Analyst' }).lines[3], /\| Data \/ Analyst \|/);
  assert.match(editRow(tracker, '2', { city: '' }).lines[3], /\| Analyst \| — \|/);
  assert.equal(editRow(tracker, '2', { company: '  ' }).code, 'usage');
});

test('unknown rows and a missing City column are refused', () => {
  assert.equal(editRow(tracker, '9', { role: 'X' }).code, 'not-found');
  const noCity = tracker.map((l) => l.replace(/\| (City|—|Berlin|------) (?=\| (Score|4\.0|N\/A|-------))/, ''));
  assert.equal(editRow(noCity, '1', { city: 'Sydney' }).code, 'no-city-column');
});

test('the CLI writes under the lock and reports JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edit-row-'));
  try {
    mkdirSync(join(dir, 'data'));
    const file = join(dir, 'data', 'applications.md');
    writeFileSync(file, ['# Applications Tracker', '', ...tracker, ''].join('\n'));
    const run = spawnSync(process.execPath, [join(ROOT, 'edit-row.mjs'), '--row', '1', '--role=--Lead Engineer', '--city=Sydney', '--json'], {
      encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: file },
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(run.stdout);
    assert.deepEqual(out.changed, ['role', 'city']);
    assert.match(readFileSync(file, 'utf-8'), /\| Acme \| --Lead Engineer \| Sydney \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
