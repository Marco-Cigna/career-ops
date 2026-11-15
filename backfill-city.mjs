#!/usr/bin/env node
/**
 * backfill-city.mjs — fill empty City cells from each row's notes or job link.
 *
 * `merge-tracker.mjs --migrate-location` fills the City column from evaluation
 * reports. Rows with no report (applications added by hand, imported from
 * another tracker) stay `—`. This fills them from, in order: a `City, Region`
 * segment in the row's own Notes, then the posting link, read with the same
 * zero-token page read as the dashboard's "Fill from link" (posting-meta.mjs:
 * the page's JobPosting data, then the ATS API). No model is called.
 *
 * Only an empty City cell (`—`, `-`, blank) is ever written, and only that
 * cell: every other byte of the line stays as it was. LinkedIn links are not
 * read (AGENTS.md, LinkedIn JD loading guard), and a page that states no place
 * leaves the cell empty. The links are read before the tracker lock is taken;
 * the lock is held only for the re-read and the write, and a cell someone
 * filled in the meantime is left alone. A backup is written next to the
 * tracker before any change.
 *
 * Run: node backfill-city.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { openTrackerTransaction } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { linkedInJobId } from './lib/linkedin-url.mjs';
import { postingMeta } from './posting-meta.mjs';
import { cityFromLocation } from './lib/location-city.mjs';

const UNSET = /^(?:|—|-|n\/a)$/i;
const CONCURRENCY = 3;

/** Rows whose City cell is empty. Pure. */
export function rowsNeedingCity(lines) {
  const COLS = resolveColumns(lines);
  if (COLS.location == null) return { hasCityColumn: false, rows: [] };
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, COLS);
    if (!row || !UNSET.test(String(row.location ?? '').trim())) continue;
    rows.push({
      num: String(row.num), company: row.company, role: row.role,
      url: /^https?:\/\//i.test(row.url || '') ? row.url : '',
      notes: row.notes || '',
    });
  }
  return { hasCityColumn: true, rows };
}

/**
 * A place the row's own Notes state as a `City, Region` segment, reduced to
 * the city: "Applied 2026-06-28; via LinkedIn; Hybrid; Melbourne, VIC" →
 * "Melbourne". Only a whole `;`-separated segment shaped like a place counts,
 * never a word inside prose. The last such segment wins. Pure.
 */
export function cityFromNotes(notes) {
  // Every word on both sides capitalized, as place names are: "Great Malvern,
  // United Kingdom" and "Melbourne, VIC" pass; "Canada role, sponsorship
  // unstated" and "Strong fit, salary unstated" do not.
  const name = String.raw`\p{Lu}[\p{L}.'-]*(?: \p{Lu}[\p{L}.'-]*){0,3}`;
  const place = new RegExp(`^${name},\\s*${name}$`, 'u');
  const segments = String(notes ?? '').split(';').map((s) => s.trim()).filter((s) => place.test(s));
  return segments.length ? cityFromLocation(segments[segments.length - 1]) : '';
}

/**
 * Write cities into empty City cells. `cities` maps tracker number → city.
 * A cell that is no longer empty is skipped. Pure.
 *
 * @param {string[]} lines
 * @param {Map<string, string>} cities
 * @returns {{lines: string[], changed: {num: string, city: string}[]}}
 */
export function fillCities(lines, cities) {
  const COLS = resolveColumns(lines);
  const out = lines.slice();
  const changed = [];
  if (COLS.location == null) return { lines: out, changed };
  for (let i = 0; i < lines.length; i++) {
    const row = parseTrackerRow(lines[i], COLS);
    if (!row) continue;
    const city = cities.get(String(row.num));
    if (!city || !UNSET.test(String(row.location ?? '').trim())) continue;
    // Replace just this cell, keeping its padding (same as fix-report-links.mjs).
    const parts = lines[i].split('|');
    const raw = parts[COLS.location];
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    parts[COLS.location] = `${lead}${city.replace(/[|\t\r\n]+/g, ' ').trim()}${trail || ' '}`;
    out[i] = parts.join('|');
    changed.push({ num: String(row.num), city });
  }
  return { lines: out, changed };
}

function isLinkedIn(url) {
  try { return Boolean(linkedInJobId(new URL(url))); } catch { return false; }
}

/** Read each row's link; resolves to num → city for the rows where a city was found. */
async function lookUpCities(rows, read = postingMeta, log = () => {}) {
  const cities = new Map();
  const queue = rows.slice();
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      const noted = cityFromNotes(row.notes);
      if (noted) { cities.set(row.num, noted); log(row, `${noted} (from notes)`); continue; }
      if (!row.url) { log(row, 'no place in notes and no job link'); continue; }
      if (isLinkedIn(row.url)) { log(row, 'no place in notes; LinkedIn link is not read'); continue; }
      let city = '';
      try { city = (await read({ url: row.url }))?.city || ''; } catch { city = ''; }
      if (city) cities.set(row.num, city);
      log(row, city || 'no place stated on the page');
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return cities;
}

const KNOWN_FLAGS = ['--help', '-h', '--dry-run'];
const USAGE = `Usage: node backfill-city.mjs [options]

  Fills empty City cells in the tracker from each row's job link, with the
  same page read as the dashboard's "Fill from link" (no AI). LinkedIn links
  are skipped. Only empty cells are written.

  Options:
  --dry-run        Show the cities it would write without changing applications.md
  -h, --help       Show this help and exit
  `;

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  const DRY_RUN = args.includes('--dry-run');
  const APPS_FILE = resolveTrackerPath(getCareerOpsRoot());
  if (!existsSync(APPS_FILE)) {
    console.log('No applications.md found. Nothing to fill.');
    process.exit(0);
  }

  const before = rowsNeedingCity(readFileSync(APPS_FILE, 'utf-8').split('\n'));
  if (!before.hasCityColumn) {
    console.log('The tracker has no City column. Add it first: node merge-tracker.mjs --migrate-location');
    process.exit(0);
  }
  console.log(`🔎 ${before.rows.length} row(s) with an empty City.`);
  const cities = await lookUpCities(before.rows, postingMeta, (row, result) => {
    console.log(`  #${row.num} ${row.company} — ${row.role}: ${result}`);
  });

  if (DRY_RUN) {
    console.log(`\n📊 ${cities.size} city/cities found (dry-run — no changes written)`);
    process.exit(0);
  }
  if (!cities.size) {
    console.log('\n✅ No cities found to write.');
    process.exit(0);
  }

  let tx;
  try {
    tx = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    console.error(`Cannot acquire tracker lock: ${err.message}`);
    process.exit(1);
  }
  try {
    const content = tx.read();
    const result = fillCities(content.split('\n'), cities);
    if (!result.changed.length) {
      console.log('\n✅ No changes needed (the cells were filled meanwhile).');
    } else {
      const backupPath = `${tx.path}.bak`;
      writeFileSync(backupPath, content);
      tx.replace(result.lines.join('\n'));
      console.log(`\n✅ Filled ${result.changed.length} City cell(s) in ${tx.path} (backup: ${backupPath})`);
    }
  } finally {
    tx.close();
  }
}
