import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metaFromHtml, metaFromPastedText, postingMeta, roleFromLinkedInSlug, companyFromLinkedInSlug, splitHeading } from '../posting-meta.mjs';

const ld = (obj) => `<html><head><title>Careers</title><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>x</body></html>`;

test('JSON-LD JobPosting gives role, company and location', () => {
  const html = ld({ '@type': 'JobPosting', title: 'Data Engineer', hiringOrganization: { name: 'Canva' }, jobLocation: { address: { addressLocality: 'Sydney', addressCountry: 'AU' } } });
  const m = metaFromHtml(html);
  assert.equal(m.role, 'Data Engineer');
  assert.equal(m.company, 'Canva');
  assert.equal(m.location, 'Sydney, AU');
  assert.equal(m.method, 'json-ld');
});

test('a page with several postings is a listing and names nobody', () => {
  const html = ld([{ '@type': 'JobPosting', title: 'A', hiringOrganization: 'X' }, { '@type': 'JobPosting', title: 'B', hiringOrganization: 'X' }]);
  assert.equal(metaFromHtml(html).company, '');
});

test('only an "at" heading names the employer', () => {
  assert.deepEqual(splitHeading('Senior Analyst at Atlassian | LinkedIn'), { role: 'Senior Analyst', company: 'Atlassian' });
  assert.equal(splitHeading('Atlassian - Senior Analyst'), null);
});

test('LinkedIn slugs give role and company without a fetch', () => {
  const url = 'https://www.linkedin.com/jobs/view/senior-data-analyst-at-acme-corp-4470309630/';
  assert.equal(roleFromLinkedInSlug(url), 'Senior Data Analyst');
  assert.equal(companyFromLinkedInSlug(url), 'Acme Corp');
  assert.equal(roleFromLinkedInSlug('https://www.linkedin.com/jobs/view/4470309630/'), '');
});

test('pasted text is read for a heading', () => {
  assert.deepEqual(metaFromPastedText('\nData Engineer at Canva\nSydney'), { role: 'Data Engineer', company: 'Canva', method: 'pasted-text' });
});

test('LinkedIn is never fetched, and the URL is canonicalised', async () => {
  let fetched = false;
  const deps = { fetchPage: async () => { fetched = true; return null; }, fetchApi: async () => { fetched = true; return null; } };
  const r = await postingMeta({ url: 'https://uk.linkedin.com/jobs/view/4470309630/?trk=x' }, deps);
  assert.equal(fetched, false);
  assert.equal(r.url, 'https://www.linkedin.com/jobs/view/4470309630');
  assert.equal(r.linkedin, true);
});

test('fields the page does not state stay empty for the user', async () => {
  const deps = { fetchPage: async () => ({ html: '<title>Join us</title><p>We are Wombat Labs, hiring a Platform Engineer.</p>' }), fetchApi: async () => null };
  const r = await postingMeta({ url: 'https://careers.example.com/jobs/1' }, deps);
  assert.equal(r.company, '');
  assert.equal(r.role, '');
  assert.equal(r.source, 'none');
});

test('a non-http link is refused', async () => {
  assert.equal((await postingMeta({ url: 'file:///etc/passwd' })).ok, false);
});
