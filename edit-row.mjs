#!/usr/bin/env node
/**
 * edit-row.mjs — change the Company, Role or City of one tracker row.
 *
 * The other tracker writers own their cells: set-status.mjs the status and
 * notes, mark-pdf-ready.mjs the PDF flag, merge-tracker.mjs whole rows from an
 * evaluation. A typo in a company name, a role retitled by the employer, or a
 * city the posting never stated had no writer at all: a merge can only rename
 * a row that has a report, and hand-editing the table races every locked
 * writer. This is that writer, for those three display cells only.
 *
 * It holds the shared tracker lock across the read and the atomic write, finds
 * the row by its tracker number (the `#` column), and replaces only the named
 * cells, keeping every other byte of the line. Values pass through cell()
 * (tracker-utils.mjs), so a pipe or line break can never split the row.
 * Company and Role cannot be emptied; an empty City is written as `—`.
 *
 * Run: node edit-row.mjs --row N [--company TEXT] [--role TEXT] [--city TEXT] [--json]
 * Exit: 0 written (or nothing to change), 1 bad request, 2 no such row,
 *       3 the tracker has no City column, 4 tracker lock busy.
 */

import { existsSync } from 'fs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { openTrackerTransaction, cell } from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const FIELD_MAX = 160;
const FIELDS = /** @type {const} */ (['company', 'role', 'city']);

/**
 * Apply an edit to tracker lines. Pure: touches no files.
 *
 * @param {string[]} lines
 * @param {string} row - tracker number
 * @param {{company?: string, role?: string, city?: string}} edit
 * @returns {{ok: true, lines: string[], changed: string[], before: object, after: object} | {ok: false, code: string, message: string}}
 */
export function editRow(lines, row, edit) {
  const COLS = resolveColumns(lines);
  const want = {};
  for (const field of FIELDS) {
    if (edit[field] === undefined) continue;
    const value = cell(edit[field]).slice(0, FIELD_MAX).trim();
    if ((field === 'company' || field === 'role') && !value) {
      return { ok: false, code: 'usage', message: `The ${field} cannot be empty.` };
    }
    want[field] = field === 'city' ? (value || '—') : value;
  }
  if (!Object.keys(want).length) return { ok: false, code: 'usage', message: 'Nothing to change: pass --company, --role or --city.' };
  if (want.city !== undefined && COLS.location == null) {
    return { ok: false, code: 'no-city-column', message: 'The tracker has no City column. Add it with: node merge-tracker.mjs --migrate-location' };
  }
  const index = { company: COLS.company, role: COLS.role, city: COLS.location };
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTrackerRow(lines[i], COLS);
    if (!parsed || String(parsed.num) !== String(row)) continue;
    const parts = lines[i].split('|');
    const before = { company: parsed.company, role: parsed.role, city: parsed.location ?? '' };
    const changed = [];
    for (const [field, value] of Object.entries(want)) {
      const raw = parts[index[field]];
      if (raw.trim() === value) continue;
      const lead = raw.match(/^\s*/)[0] || ' ';
      const trail = raw.match(/\s*$/)[0] || ' ';
      parts[index[field]] = `${lead}${value}${trail}`;
      changed.push(field);
    }
    const out = lines.slice();
    out[i] = parts.join('|');
    const after = { ...before, ...want };
    return { ok: true, lines: out, changed, before, after };
  }
  return { ok: false, code: 'not-found', message: `No tracker row with #${row}.` };
}

const KNOWN_FLAGS = ['--row', '--company', '--role', '--city', '--json', '--help', '-h'];
const USAGE = `Usage: node edit-row.mjs --row N [--company TEXT] [--role TEXT] [--city TEXT] [--json]

  Changes the Company, Role or City cell of tracker row #N. Nothing else in the
  file changes. Company and Role cannot be emptied; --city "" clears the city.
`;

const EXIT = { usage: 1, 'not-found': 2, 'no-city-column': 3, 'lock-busy': 4 };

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: ['--row', '--company', '--role', '--city'] });
  const json = args.includes('--json');
  const finish = (result, code) => {
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else console[code ? 'error' : 'log'](result.message);
    process.exit(code);
  };
  const row = flagValue(args, '--row');
  if (!/^\d+$/.test(String(row ?? ''))) finish({ ok: false, code: 'usage', message: '--row needs a tracker number.' }, 1);
  const edit = {};
  for (const field of FIELDS) {
    // Both spellings: `--city Sydney` and `--city=Sydney` (the form callers
    // use for a value that could itself start with a dash).
    if (args.some((a) => a === `--${field}` || a.startsWith(`--${field}=`))) edit[field] = flagValue(args, `--${field}`) ?? '';
  }
  const APPS_FILE = resolveTrackerPath(getCareerOpsRoot());
  if (!existsSync(APPS_FILE)) finish({ ok: false, code: 'not-found', message: 'No applications.md found.' }, 2);

  let tx;
  try {
    tx = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    finish({ ok: false, code: err?.code === 'LOCK_TIMEOUT' ? 'lock-busy' : 'lock-error', message: `Cannot acquire tracker lock: ${err.message}` }, err?.code === 'LOCK_TIMEOUT' ? 4 : 1);
  }
  try {
    const result = editRow(tx.read().split('\n'), row, edit);
    if (!result.ok) finish(result, EXIT[result.code] ?? 1);
    if (result.changed.length) tx.replace(result.lines.join('\n'));
    finish({
      ok: true, row: String(row), changed: result.changed, before: result.before, after: result.after,
      message: result.changed.length ? `#${row}: updated ${result.changed.join(', ')}.` : `#${row}: nothing to change.`,
    }, 0);
  } finally {
    tx.close();
  }
}
