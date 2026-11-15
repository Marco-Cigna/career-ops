import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityFromLocation, reportCity, reportLocation } from '../lib/location-city.mjs';

test('a posting location reduces to its city', () => {
  const cases = {
    'Sydney, New South Wales, Australia': 'Sydney',
    '"Sydney, AU"': 'Sydney',
    'Boston, MA; Vancouver, British Columbia, Canada': 'Boston / Vancouver',
    'Oslo (NO), Hamburg (DE), London (UK) or Bucharest (RO)': 'Oslo / Hamburg / London +1',
    'Remote - Sydney, NSW': 'Sydney',
    Remote: 'Remote',
    Australia: 'Australia',
    null: '',
    '—': '',
    '': '',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(cityFromLocation(input), want, input);
});

test('a city never carries a pipe or tab into the tracker', () => {
  assert.equal(cityFromLocation('Sydney | NSW\tAU'), 'Sydney NSW AU');
});

test('the Machine Summary wins over the header line', () => {
  const md = '# Acme\n\n**Location:** London, UK\n\n## Machine Summary\n\n```yaml\nposting_location: "Berlin, Germany"\n```\n';
  assert.equal(reportLocation(md), 'Berlin, Germany');
  assert.equal(reportCity(md), 'Berlin');
});

test('a null posting_location falls back to the Location line', () => {
  const md = '# Acme\n\n**Location:** Toronto, Ontario, Canada\n\n## Machine Summary\n\n```yaml\nposting_location: null\n```\n';
  assert.equal(reportCity(md), 'Toronto');
  assert.equal(reportCity('# Acme\n\nno place stated\n'), '');
});
