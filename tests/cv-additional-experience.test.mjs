// An Additional Experience section (#additional_experience) keeps roles outside
// the candidate's field off the main history, the way hand-written CVs do. It
// renders from its own payload key, disappears when empty, and the
// reverse-chronological guard checks it as a list of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripEmptySections } from '../cv-sections-core.mjs';
import { validatePayload } from '../lib/cv-payload-schema.mjs';
import { validateCvExperienceOrder } from '../cv-experience-order.mjs';

const TEMPLATE = [
  '<!-- WORK EXPERIENCE -->', '<div>{{EXPERIENCE}}</div>',
  '<!-- EDUCATION -->', '<div>{{EDUCATION}}</div>',
  '<!-- ADDITIONAL EXPERIENCE -->', '<div>{{SECTION_ADDITIONAL_EXPERIENCE}} {{ADDITIONAL_EXPERIENCE}}</div>',
  '<!-- SKILLS -->', '<div>{{SKILLS}}</div>', '<!-- END -->',
].join('\n');

const job = (period) => `<div class="job"><span class="job-period">${period}</span></div>`;

test('an empty additional_experience removes the whole section', () => {
  const out = stripEmptySections(TEMPLATE, { experience: [{}], education: [{}], skills: [{}] }, 'html');
  assert.ok(!out.includes('ADDITIONAL'));
  assert.ok(out.includes('{{EDUCATION}}') && out.includes('{{SKILLS}}'));
});

test('a populated additional_experience keeps the section', () => {
  const out = stripEmptySections(TEMPLATE, { experience: [{}], education: [{}], additional_experience: [{}], skills: [{}] }, 'html');
  assert.ok(out.includes('{{ADDITIONAL_EXPERIENCE}}'));
});

test('the payload schema accepts additional_experience with the experience keys', () => {
  const entry = { company: 'Cafe', role: 'Barista', location: 'Copenhagen', dates: 'Apr 2025 - Dec 2025', bullets: ['Served'] };
  const { errors, warnings } = validatePayload({ experience: [], additional_experience: [entry] }, 'html');
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  // The section is really validated, the same way experience is: an unknown key
  // warns, a missing required field is an error.
  assert.match(validatePayload({ additional_experience: [{ ...entry, employer: 'x' }] }, 'html').warnings.join(), /unrecognised key employer/);
  assert.match(validatePayload({ additional_experience: [{ role: 'Barista' }] }, 'html').errors.join(), /missing required field company/);
});

test('the order guard checks the additional list on its own', () => {
  const main = `<!-- WORK EXPERIENCE -->${job('Feb 2026 - Present')}${job('Nov 2021 - Jan 2024')}`;
  assert.doesNotThrow(() => validateCvExperienceOrder(`${main}<!-- ADDITIONAL EXPERIENCE -->${job('Apr 2025 - Dec 2025')}<!-- SKILLS -->`));
  assert.throws(() => validateCvExperienceOrder(`${main}<!-- ADDITIONAL EXPERIENCE -->${job('Jan 2019 - Dec 2019')}${job('Apr 2025 - Dec 2025')}<!-- SKILLS -->`), /reverse-chronological/);
  assert.throws(() => validateCvExperienceOrder(`<!-- WORK EXPERIENCE -->${job('Nov 2021 - Jan 2024')}${job('Feb 2026 - Present')}`), /reverse-chronological/);
});
