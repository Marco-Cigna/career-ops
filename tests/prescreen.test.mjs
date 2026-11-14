// tests/prescreen.test.mjs — the zero-token pre-screen (prescreen.mjs): the
// strict years rule, the title and blacklist checks, config resolution, the
// triage prompt/parse helpers batch-runner.sh relies on, and the CLI's exit
// codes and discard-log line.
//
// The property the years section protects: a JD requiring more than
// pipeline.prescreen.max_years skips in any common wording, and a preferred
// figure, a lower required bar, a degree-substitute bar or no statement at
// all never skips.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import {
  checkYears,
  normalizeYearsWording,
  checkTitle,
  checkBlacklist,
  lookupPipelineEntry,
  prescreen,
  formatDiscardLine,
  resolvePrescreenConfig,
  buildTriagePrompt,
  buildTriageSystem,
  buildTriageUser,
  writeTriageSystemFile,
  parseTriageOutput,
  jdFileName,
  isLinkedInUrl,
} from '../prescreen.mjs';
import { parseBlacklist } from '../scan.mjs';

const ok = async (name, fn) => {
  try { await fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('\nprescreen — zero-token pre-screen');

// [JD text, expected result at max_years 5]
const YEARS_CASES = [
  ['Requirements:\n- 6+ years of professional software engineering experience', 'skip'],
  ['Requirements:\n- Minimum of six (6) years of experience in data engineering', 'skip'],
  ['What you bring:\n- More than 5 years of experience as a backend engineer', 'skip'],
  ['What you bring:\n- Over a decade of experience in platform engineering', 'skip'],
  ['Requirements:\n- 7+ years of experience with Go or Java', 'skip'],
  ['Nice to have:\n- 8+ years of industry experience', 'pass'],
  ['Requirements:\n- 8+ years of experience in data engineering preferred', 'pass'],
  ['Requirements:\n- Ideally 7+ years of professional experience', 'pass'],
  ['Requirements:\n- 7+ years of experience with Go is a plus', 'pass'],
  ['Requirements:\n- 6+ years of experience, or an equivalent combination of education and experience', 'skip'],
  ['Requirements:\n- 5+ years of experience building data pipelines', 'pass'],
  ['Requirements:\n- 4-6 years of experience in a similar role', 'pass'],
  ['Requirements:\n- 3+ years of experience with Python\nPreferred:\n- 7+ years of experience', 'pass'],
  ['Requirements:\n- 3+ years of professional experience\nPreferred:\n- 8+ years of experience', 'pass'],
  ['Requirements:\n- Bachelor degree or 6 years of equivalent experience', 'pass'],
  ['We were founded 10 years ago and have grown 6 years in a row.', 'pass'],
  ['About you:\n- You have at least 5 years of hands-on experience', 'pass'],
];

for (const [jd, want] of YEARS_CASES) {
  await ok(`years ${want}: ${JSON.stringify(jd.split('\n').at(-1))}`, () => {
    const r = checkYears(jd, 5);
    assert.strictEqual(r.result, want, r.detail);
    if (want === 'skip') assert.ok(r.quote, 'a skip quotes the line it read');
  });
}

await ok('years check is off without max_years, and n/a on an unread JD', () => {
  assert.strictEqual(checkYears('Requirements:\n- 9+ years of experience', null).result, 'n/a');
  assert.strictEqual(checkYears('', 5).result, 'n/a');
  assert.strictEqual(checkYears('   ', 5).result, 'n/a');
});

await ok('"more than N" and decade wording read one notch stricter than jd-years', () => {
  assert.match(normalizeYearsWording('more than five years of experience'), /6\+ years/);
  assert.match(normalizeYearsWording('over 5 years of experience'), /6\+ years/);
  assert.match(normalizeYearsWording('a decade of experience'), /10\+ years of experience/);
  assert.match(normalizeYearsWording('nearly a decade of experience'), /9\+ years/);
  assert.doesNotMatch(normalizeYearsWording('over the past 5 years we grew'), /6\+/);
});

await ok('title check applies negatives only, with word: boundaries', () => {
  const filter = { positive: ['Data Engineer'], negative: ['word:Staff', 'Head of'] };
  assert.strictEqual(checkTitle('Staff Data Engineer', filter).result, 'skip');
  assert.strictEqual(checkTitle('Head of Platform', filter).result, 'skip');
  assert.strictEqual(checkTitle('Staffing Coordinator', filter).result, 'pass');
  // No positive match needed: a hand-pasted URL is the user's own choice.
  assert.strictEqual(checkTitle('Solutions Architect', filter).result, 'pass');
  assert.strictEqual(checkTitle('', filter).result, 'n/a');
});

await ok('blacklist check matches company names and domains', () => {
  const bl = parseBlacklist('| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-01 | company | ghosted |\n| badjobs.io | 2026-01-01 | domain | spam |\n');
  assert.strictEqual(checkBlacklist('Acme Corp', 'https://x.com/1', bl).result, 'skip');
  assert.strictEqual(checkBlacklist('Other', 'https://careers.badjobs.io/1', bl).result, 'skip');
  assert.strictEqual(checkBlacklist('Other', 'https://x.com/1', bl).result, 'pass');
  assert.strictEqual(checkBlacklist('Acme Corp', 'https://x.com/1', new Map()).result, 'pass');
});

await ok('pipeline lookup finds company and title by URL', () => {
  const text = '## Pending\n- [ ] https://jobs.example.com/1 | Acme | Staff Engineer | Berlin\n- [x] #-- | https://jobs.example.com/2 | skipped\n';
  assert.deepStrictEqual(lookupPipelineEntry(text, 'https://jobs.example.com/1/'), { company: 'Acme', title: 'Staff Engineer' });
  assert.strictEqual(lookupPipelineEntry(text, 'https://jobs.example.com/9'), null);
});

await ok('prescreen names every reason, and continues when nothing skips', () => {
  const r = prescreen({
    url: 'https://x.com/1',
    text: 'Requirements:\n- 8+ years of experience',
    company: 'Acme',
    title: 'Staff Engineer',
    maxYears: 5,
    titleFilter: { negative: ['word:Staff'] },
    blacklist: new Map(),
  });
  assert.strictEqual(r.verdict, 'skip');
  assert.match(r.reason, /title: .*Staff/);
  assert.match(r.reason, /years: asks 8\+/);
  const ok2 = prescreen({ url: 'https://x.com/1', text: '', company: 'Acme', title: 'Engineer', maxYears: 5, titleFilter: {}, blacklist: new Map() });
  assert.strictEqual(ok2.verdict, 'continue');
});

await ok('discard lines: three fields without an id, four with one, no stray tabs', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  assert.strictEqual(formatDiscardLine({ url: 'https://x.com/1', reason: 'a\tb', now }), '2026-11-02T00:00:00.000Z\thttps://x.com/1\tprescreen: a b\n');
  assert.strictEqual(formatDiscardLine({ url: 'https://x.com/1', reason: 'r', id: '7', now }).split('\t').length, 4);
});

await ok('config: defaults, bounds, and YAML booleans for triage', () => {
  assert.deepStrictEqual(resolvePrescreenConfig({}), { spendTier: 'standard', triageEffort: '', effort: '', maxYears: null, triageThreshold: 3.5, triage: 'auto', parallel: null, outputLanguage: 'en' });
  const c = resolvePrescreenConfig({ pipeline: { triage_threshold: 4, triage: false, parallel: 1, prescreen: { max_years: 5 } }, language: { output: 'es' } });
  assert.deepStrictEqual(c, { spendTier: 'standard', triageEffort: '', effort: '', maxYears: 5, triageThreshold: 4, triage: 'off', parallel: 1, outputLanguage: 'es' });
  assert.strictEqual(resolvePrescreenConfig({ pipeline: { parallel: 0, triage_threshold: 9 } }).parallel, null);
  assert.strictEqual(resolvePrescreenConfig({ pipeline: { triage_threshold: 9 } }).triageThreshold, 3.5);
});

await ok('split triage prompt: the system half is posting-independent, the user half carries only the JD', () => {
  const base = { triageMd: 'TRIAGE-MD', brief: 'BRIEF', threshold: 3.5, language: 'en' };
  const system = buildTriageSystem(base);
  assert.match(system, /TRIAGE-MD/);
  assert.match(system, /BRIEF/);
  assert.match(system, /triage_threshold for this run: 3\.5/);
  assert.match(system, /untrusted/);
  assert.doesNotMatch(system, /https?:\/\//, 'no URL: the same bytes for every posting');
  const user = buildTriageUser({ jdText: 'x'.repeat(50_000), url: 'https://x.com/1' });
  assert.match(user, /URL: https:\/\/x\.com\/1/);
  assert.match(user, /Return only the TRIAGE line\./);
  assert.ok(!user.includes('TRIAGE-MD') && !user.includes('BRIEF'));
  assert.ok(user.length < 21_000, 'the JD cap still applies');
});

await ok('the triage system file is content-named: same text, same file; new text, new file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-triage-sys-'));
  try {
    const a = writeTriageSystemFile('same text', dir);
    const b = writeTriageSystemFile('same text', dir);
    const c = writeTriageSystemFile('edited brief', dir);
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.ok(!a.includes('\\'), 'forward slashes, so a bash caller on Windows can test the path');
    assert.strictEqual(readFileSync(a, 'utf-8'), 'same text');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await ok('config: reasoning effort for triage and the evaluation, valid levels only', () => {
  const c = resolvePrescreenConfig({ pipeline: { triage_effort: 'Medium', effort: ' high ' } });
  assert.strictEqual(c.triageEffort, 'medium');
  assert.strictEqual(c.effort, 'high');
  const bad = resolvePrescreenConfig({ pipeline: { triage_effort: 'extreme', effort: 3 } });
  assert.strictEqual(bad.triageEffort, '');
  assert.strictEqual(bad.effort, '');
});

await ok('triage prompt carries all three inputs and caps the JD', () => {
  const p = buildTriagePrompt({ triageMd: 'TRIAGE-MD', brief: 'BRIEF', jdText: 'x'.repeat(50_000), url: 'https://x.com/1', threshold: 3.5, language: 'en' });
  assert.match(p, /TRIAGE-MD/);
  assert.match(p, /BRIEF/);
  assert.match(p, /triage_threshold for this run: 3\.5/);
  assert.match(p, /untrusted/);
  assert.ok(p.length < 21_000, `prompt too long: ${p.length}`);
});

await ok('triage output: last TRIAGE line wins, markdown tolerated, none → null', () => {
  const r = parseTriageOutput('thinking...\nTRIAGE: PASS | A | B | 4.0/5 | x\n`TRIAGE: FAIL | Acme | Eng | 2.4/5 | Hard DQ: infra | on-call`');
  assert.deepStrictEqual(r, { verdict: 'FAIL', company: 'Acme', role: 'Eng', score: 2.4, reason: 'Hard DQ: infra | on-call' });
  assert.strictEqual(parseTriageOutput('Rate limit reached'), null);
});

await ok('JD file names are slugged and unique per URL; LinkedIn is recognised', () => {
  assert.match(jdFileName('https://x.com/1', 'Acmé GmbH', 'Data Engineer (m/f/d)'), /^acme-gmbh-data-engineer-m-f-d-[0-9a-f]{10}\.md$/);
  assert.notStrictEqual(jdFileName('https://x.com/1', 'A', 'B'), jdFileName('https://x.com/2', 'A', 'B'));
  assert.match(jdFileName('https://x.com/1', '', ''), /^posting-/);
  assert.ok(isLinkedInUrl('https://www.linkedin.com/jobs/view/1'));
  assert.ok(!isLinkedInUrl('https://notlinkedin.com/jobs/1'));
});

await ok('CLI: exit 2 and a discard line on a skip, exit 0 otherwise, config lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'prescreen-'));
  try {
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'config', 'profile.yml'), 'pipeline:\n  parallel: 1\n  prescreen:\n    max_years: 5\n');
    writeFileSync(join(root, 'portals.yml'), 'title_filter:\n  negative:\n    - "word:Staff"\n');
    writeFileSync(join(root, 'data', 'pipeline.md'), '## Pending\n- [ ] https://jobs.example.com/1 | Acme | Data Engineer\n');
    const high = join(root, 'high.txt');
    const low = join(root, 'low.txt');
    writeFileSync(high, 'Requirements:\n- 7+ years of experience in data engineering\n');
    writeFileSync(low, 'Requirements:\n- 2+ years of experience in data engineering\n');
    const log = join(root, 'data', 'discard.log');
    const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' };
    const run = (...args) => spawnSync(NODE, [join(ROOT, 'prescreen.mjs'), ...args], { encoding: 'utf8', env });

    const skip = run('--url', 'https://jobs.example.com/1', '--jd-file', high, '--log', log, '--id', '3');
    assert.strictEqual(skip.status, 2, skip.stderr);
    assert.match(skip.stdout, /^SKIP\tyears: asks 7\+/);
    const line = readFileSync(log, 'utf8').trim().split('\t');
    assert.strictEqual(line.length, 4);
    assert.strictEqual(line[1], '3');

    const input = join(root, 'in.json');
    writeFileSync(input, JSON.stringify({ url: 'https://jobs.example.com/2', company: 'Acme', title: 'Staff Data Engineer' }));
    const title = run('--input', input, '--jd-file', low);
    assert.strictEqual(title.status, 2);
    assert.match(title.stdout, /title: .*Staff/);

    const cont = run('--url', 'https://jobs.example.com/1', '--jd-file', low, '--json');
    assert.strictEqual(cont.status, 0, cont.stderr);
    const out = JSON.parse(cont.stdout);
    assert.strictEqual(out.verdict, 'continue');
    assert.strictEqual(out.title, 'Data Engineer', 'title looked up in data/pipeline.md');

    const cfg = run('--config');
    assert.strictEqual(cfg.status, 0);
    assert.match(cfg.stdout, /^PARALLEL=1$/m);
    assert.match(cfg.stdout, /^MAX_YEARS=5$/m);
    assert.match(cfg.stdout, /^TRIAGE_READY=0$/m, 'no _brief.md, no triage');

    assert.strictEqual(run('--jd-file', low).status, 1, 'no URL is a usage error');
    assert.strictEqual(run('--url', 'https://x.com/1', '--bogus').status, 1, 'unknown flag is a usage error');
    assert.ok(!existsSync(join(root, 'jds')), 'nothing saved without --fetch/--browser');

    const parsed = spawnSync(NODE, [join(ROOT, 'prescreen.mjs'), '--parse-triage'], { input: 'TRIAGE: MARGINAL | A | B | 3.2/5 | travel risk\n', encoding: 'utf8', env });
    assert.strictEqual(parsed.status, 0);
    assert.strictEqual(parsed.stdout, 'MARGINAL\t3.2\ttravel risk\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
