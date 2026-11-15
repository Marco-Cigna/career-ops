import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityFromNotes, fillCities, rowsNeedingCity } from '../backfill-city.mjs';

const tracker = [
  '| # | Date | Company | Role | City | Score | Status | PDF | Report | Notes | URL |',
  '|---|------|---------|------|-----|-------|--------|-----|--------|-------|-----|',
  '| 1 | 2026-10-01 | Acme | Engineer | — | N/A | Applied | ❌ | — | n | [ashby](https://jobs.ashbyhq.com/acme/1) |',
  '| 2 | 2026-10-01 | Globex | Analyst | Berlin | N/A | Applied | ❌ | — | n | https://globex.example/jobs/2 |',
  '| 3 | 2026-10-01 | Initech | Dev | — | N/A | Applied | ❌ | — | no link | — |',
];

test('only empty City cells are candidates, and the href is read from a link cell', () => {
  const { hasCityColumn, rows } = rowsNeedingCity(tracker);
  assert.equal(hasCityColumn, true);
  assert.deepEqual(rows.map((r) => [r.num, r.url]), [['1', 'https://jobs.ashbyhq.com/acme/1'], ['3', '']]);
});

test('a City, Region segment in notes gives the city; prose does not', () => {
  assert.equal(cityFromNotes('Applied 2026-06-28; via LinkedIn; Hybrid; listing 3w old when applied; Melbourne, VIC'), 'Melbourne');
  assert.equal(cityFromNotes('Applied; On-site; Great Malvern, United Kingdom'), 'Great Malvern');
  assert.equal(cityFromNotes('Strong fit, salary unstated; posted: 2026-10-29'), '');
  assert.equal(cityFromNotes('Strong ETL fit; Canada role, sponsorship unstated; posted: 2026-10-30'), '');
  assert.equal(cityFromNotes('Applied; The Hague, Netherlands'), 'The Hague');
  assert.equal(cityFromNotes(''), '');
});

test('fillCities writes only the City cell of empty rows, byte for byte elsewhere', () => {
  const { lines, changed } = fillCities(tracker, new Map([['1', 'Sydney'], ['2', 'Paris']]));
  assert.deepEqual(changed, [{ num: '1', city: 'Sydney' }]);
  assert.equal(lines[2], tracker[2].replace('| — | N/A', '| Sydney | N/A'));
  assert.equal(lines[3], tracker[3], 'a city already set is never replaced');
});

test('a tracker without a City column is reported, not changed', () => {
  const noCity = [tracker[0].replace(' City |', ''), tracker[1].replace('-----|', '')];
  assert.equal(rowsNeedingCity(noCity).hasCityColumn, false);
});
