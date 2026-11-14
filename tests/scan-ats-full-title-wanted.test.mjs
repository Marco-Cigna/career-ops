// tests/scan-ats-full-title-wanted.test.mjs — the reverse sweep tells each
// provider which titles its title filter keeps (ctx.titleWanted), so
// workday.mjs spends no detail GET on a multi-location posting the sweep will
// drop on its title anyway.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — titleWanted for providers');

const { withTitleWanted } = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { default: workday } = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);

// The helper: binds the board's slug, keeps the rest of ctx, and is a no-op
// without a filter.
{
  const seen = [];
  const titleFilter = (title, slug) => { seen.push(slug); return /engineer/i.test(title); };
  const ctx = { sinceMs: 1, idCache: 'slice' };
  const out = withTitleWanted(ctx, titleFilter, 'acme');
  const ok = out !== ctx && out.sinceMs === 1 && out.idCache === 'slice' && ctx.titleWanted === undefined
    && out.titleWanted('Data Engineer') === true && out.titleWanted('Nurse') === false && seen.every((s) => s === 'acme');
  if (ok) pass('withTitleWanted() adds titleWanted bound to the board slug and leaves the original ctx untouched');
  else fail(`withTitleWanted() wrong: ${JSON.stringify({ keys: Object.keys(out), seen })}`);
  if (withTitleWanted(ctx, undefined, 'acme') === ctx) pass('withTitleWanted() returns ctx unchanged without a title filter');
  else fail('withTitleWanted() changed ctx without a title filter');
}

// End to end with the real Workday provider: a board with two multi-location
// postings fetches the detail document only for the wanted title.
{
  const entry = { name: 'acme', careers_url: 'https://acme.wd1.myworkdayjobs.com/External' };
  const detailUrls = [];
  const row = (title, id) => ({ title, externalPath: `/job/x/${id}`, locationsText: '3 Locations', postedOn: 'Posted Today' });
  const fetchJson = async (url, opts) => {
    if (opts?.method === 'POST') return { total: 2, jobPostings: [row('Data Engineer', 'a'), row('Staff Nurse', 'b')], facets: [] };
    detailUrls.push(url);
    return { jobPostingInfo: { location: 'Austin, TX', additionalLocations: ['Denver, CO'] } };
  };
  const ctx = withTitleWanted({ fetchJson, sinceMs: Date.now() - 7 * 86_400_000 }, (t) => /engineer/i.test(t), 'acme');
  const origErr = console.error;
  console.error = () => {};
  let jobs;
  try { jobs = await workday.fetch(entry, ctx); } finally { console.error = origErr; }
  const engineer = jobs.find((j) => j.title === 'Data Engineer');
  const nurse = jobs.find((j) => j.title === 'Staff Nurse');
  if (detailUrls.length === 1 && detailUrls[0].endsWith('/job/x/a') && /Austin/.test(engineer?.location || '') && nurse?.location === '3 Locations') {
    pass('workday fetches the detail document only for the wanted title; the other keeps its placeholder and is still returned');
  } else {
    fail(`workday detail fetches wrong: ${JSON.stringify({ detailUrls, engineer: engineer?.location, nurse: nurse?.location })}`);
  }
}
