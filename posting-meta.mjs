#!/usr/bin/env node
/**
 * posting-meta.mjs: company, role and location for one posting link, with no
 * model call. Used by the dashboard's "Add applied job" form, which records an
 * application the user sent on their own.
 *
 * Order, cheapest and most reliable first:
 *   1. the page's schema.org JobPosting (title, hiringOrganization, location);
 *   2. the ATS's public API (fetchJdViaKnownApi), for the title when the page
 *      carries no JSON-LD;
 *   3. a "Role at Company" heading in the page title or og:title.
 * Whatever is still missing is left empty for the user to type.
 *
 * LinkedIn is never fetched (AGENTS.md, LinkedIn JD loading guard). For a
 * LinkedIn link the role comes from the words in /jobs/view/{title}-{id}, and
 * any text the user pasted is parsed instead.
 *
 * Input: one JSON object on stdin, {"url": "...", "text": "..."} (text
 * optional), so posting text never reaches argv. Output: one JSON object.
 * Exit 0 with a result, 2 when the URL is unusable.
 */

import { fetchHtml } from './lib/jd-page-fetch.mjs';
import { ldJsonBlocks } from './lib/jd-parse.mjs';
import { linkedInJobId } from './lib/linkedin-url.mjs';
import { canonicalLinkedInJobUrl } from './lib/linkedin-import.mjs';
import { fetchJdViaKnownApi } from './browser-extract.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { cityFromLocation } from './lib/location-city.mjs';

const FIELD_MAX = 120;

/** One line, no tabs or pipes (they would split a tracker row), at most FIELD_MAX characters. */
export function cleanField(value) {
  const text = decodeEntities(String(value ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\t\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > FIELD_MAX ? text.slice(0, FIELD_MAX).trim() : text;
}

/** The posting URL when it is an absolute http(s) URL, else null. */
export function postingUrl(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value) || /[\s]/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

function jobPostingNodes(html) {
  const found = [];
  for (const block of ldJsonBlocks(html)) {
    let parsed;
    try { parsed = JSON.parse(block.trim()); } catch { continue; }
    const queue = [parsed];
    for (let i = 0; i < queue.length && i < 500; i += 1) {
      const node = queue[i];
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
      const type = node['@type'];
      if (Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting') found.push(node);
    }
  }
  return found;
}

function orgName(org) {
  if (!org) return '';
  if (typeof org === 'string') return org;
  if (Array.isArray(org)) return orgName(org[0]);
  return typeof org.name === 'string' ? org.name : '';
}

function locationName(loc) {
  if (!loc) return '';
  if (Array.isArray(loc)) return locationName(loc[0]);
  const a = loc.address ?? loc;
  if (typeof a === 'string') return a;
  return [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry]
    .filter((p) => typeof p === 'string' && p.trim()).join(', ');
}

function metaTag(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = String(html).slice(0, 400_000).match(re)?.[0];
  return tag?.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i)?.slice(1).find(Boolean) ?? '';
}

function titleTag(html) {
  return String(html).slice(0, 400_000).match(/<title[^>]*>([^<]{1,400})<\/title>/i)?.[1] ?? '';
}

/**
 * "Role at Company", "Role - Company | Careers" and friends. Only the "at"
 * shape names which side is the employer, so it is the only one trusted.
 *
 * @returns {{role: string, company: string}|null}
 */
export function splitHeading(heading) {
  const text = cleanField(String(heading).replace(/\s+[|·–—-]\s+(?:careers?|jobs?|linkedin|indeed|seek)\b.*$/i, ''));
  const m = text.match(/^(.{2,100}?)\s+(?:at|@)\s+(.{2,80})$/i);
  if (!m) return null;
  return { role: cleanField(m[1]), company: cleanField(m[2]) };
}

/**
 * Company, role and location read from posting HTML without a model. Pure.
 *
 * @param {string} html
 * @returns {{role: string, company: string, location: string, method: string, hints: string[]}}
 */
export function metaFromHtml(html) {
  const postings = jobPostingNodes(html);
  const hints = [titleTag(html), metaTag(html, 'og:title'), metaTag(html, 'og:site_name')]
    .map(cleanField).filter(Boolean);
  // More than one posting on the page is a listing: none of them is this link's.
  if (postings.length === 1) {
    const p = postings[0];
    const role = cleanField(p.title ?? p.name);
    const company = cleanField(orgName(p.hiringOrganization));
    const location = cleanField(locationName(p.jobLocation));
    if (role || company) return { role, company, location, method: 'json-ld', hints };
  }
  for (const h of hints) {
    const split = splitHeading(h);
    if (split) return { ...split, location: '', method: 'page-title', hints };
  }
  return { role: '', company: '', location: '', method: 'none', hints };
}

/** The role words in a LinkedIn /jobs/view/{title-slug}-{id} path, or "". */
export function roleFromLinkedInSlug(url) {
  try {
    const m = new URL(url).pathname.match(/^\/(?:comm\/)?jobs\/view\/(.+)-\d+\/?$/);
    if (!m) return '';
    const words = decodeURIComponent(m[1]).split('-').filter(Boolean);
    // LinkedIn slugs end "-at-{company}"; that part is the company.
    const at = words.lastIndexOf('at');
    const roleWords = at > 0 ? words.slice(0, at) : words;
    return cleanField(roleWords.map((w) => (w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));
  } catch {
    return '';
  }
}

/** Company from a LinkedIn slug's "-at-{company}" tail, or "". */
export function companyFromLinkedInSlug(url) {
  try {
    const m = new URL(url).pathname.match(/^\/(?:comm\/)?jobs\/view\/(.+)-\d+\/?$/);
    if (!m) return '';
    const words = decodeURIComponent(m[1]).split('-').filter(Boolean);
    const at = words.lastIndexOf('at');
    if (at <= 0 || at === words.length - 1) return '';
    return cleanField(words.slice(at + 1).map((w) => w[0].toUpperCase() + w.slice(1)).join(' '));
  } catch {
    return '';
  }
}

/** Read pasted text: its first lines may be "Role at Company", or "Role" then "Company". */
export function metaFromPastedText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(cleanField).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    const split = splitHeading(line);
    if (split) return { ...split, method: 'pasted-text' };
  }
  return { role: '', company: '', method: 'none' };
}

/**
 * @param {{url: string, text?: string}} input
 * @param {{fetchPage?: typeof fetchHtml, fetchApi?: typeof fetchJdViaKnownApi}} [deps]
 */
export async function postingMeta(input, deps = {}) {
  const fetchPage = deps.fetchPage ?? fetchHtml;
  const fetchApi = deps.fetchApi ?? fetchJdViaKnownApi;
  const url = postingUrl(input?.url);
  if (!url) return { ok: false, error: 'Paste a full job link that starts with https://.' };
  const pasted = typeof input?.text === 'string' ? input.text.slice(0, 20_000) : '';

  const out = { ok: true, url, company: '', role: '', location: '', source: 'none', linkedin: false };
  const fill = (meta, source) => {
    let used = false;
    for (const key of ['company', 'role', 'location']) {
      if (!out[key] && meta[key]) { out[key] = meta[key]; used = true; }
    }
    if (used && out.source === 'none') out.source = source;
  };

  if (pasted.trim()) fill(metaFromPastedText(pasted), 'pasted-text');

  const linkedInId = linkedInJobId(new URL(url));
  if (linkedInId) {
    out.linkedin = true;
    out.url = canonicalLinkedInJobUrl(linkedInId);
    fill({ role: roleFromLinkedInSlug(url), company: companyFromLinkedInSlug(url) }, 'link-words');
  } else if (!out.company || !out.role) {
    const [page, api] = await Promise.all([
      fetchPage(url, 15_000).catch(() => null),
      fetchApi(url, 6_000, 15_000).catch(() => null),
    ]);
    if (page?.html) {
      const meta = metaFromHtml(page.html);
      fill(meta, meta.method);
    }
    if (api) fill({ role: cleanField(api.title) }, `ats-api:${api.ats}`);
  }
  // The tracker's City column holds the city alone (lib/location-city.mjs).
  out.city = cityFromLocation(out.location);
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let input;
  try {
    input = JSON.parse((await readStdin()).replace(/^﻿/, ''));
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'Expected one JSON object on stdin: {"url": "..."}' })}\n`);
    process.exit(2);
  }
  const result = await postingMeta(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 2);
}

if (isMainModule(import.meta.url)) main();
