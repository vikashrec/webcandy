import test from 'node:test';
import assert from 'node:assert/strict';
import {geography, target, matches, httpsUrl, MockAI} from '../../src/workforce/domain.mjs';

const lead = {title: 'Website', budget: 100, tags: ['website'], location: geography({country: 'IN', state: 'IN-BR', city: 'patna'}), serviceLocation: geography({country: 'US', state: 'US-CA', city: 'oakland'}), remote: true, onsite: false};
test('geography: global and multiple region inclusions with exclusion precedence', () => {
  assert.equal(matches(lead, target()), true);
  assert.equal(matches(lead, target({include: [{country: 'US'}, {country: 'IN'}]})), true);
  assert.equal(matches(lead, target({include: [{country: 'IN'}], exclude: [{country: 'IN', state: 'IN-BR', city: 'patna'}]})), false);
});
test('geography: country, subdivision, city and location hierarchy are enforced', () => {
  assert.equal(matches(lead, target({include: [{country: 'IN', state: 'IN-MH', city: 'mumbai'}]})), false);
  assert.throws(() => geography({country: 'IN', state: 'US-CA'}));
  assert.throws(() => geography({city: 'patna'}));
  assert.throws(() => geography({country: 'India'}));
});
test('geography: service location, remote eligibility and jurisdiction denials', () => {
  assert.equal(matches(lead, target({locationKind: 'service', include: [{country: 'US'}], remote: 'remote'})), true);
  assert.equal(matches(lead, target({remote: 'onsite'})), false);
  assert.equal(matches(lead, target({denyCountries: ['US']})), false);
});
test('geography: invalid timezones, language, region arrays and currency fail closed', () => {
  for (const data of [{timezone: 'Nowhere/Invalid'}, {language: 'bad_tag'}, {currency: 'usd'}]) assert.throws(() => geography(data));
  assert.throws(() => target({include: 'IN'}));
  assert.throws(() => target({remote: 'maybe'}));
});
test('provenance URL canonicalization removes trackers, fragments and sorts query parameters', () => {
  assert.equal(httpsUrl('https://EXAMPLE.test/item/?b=2&utm_source=x&a=1#hash'), 'https://example.test/item?a=1&b=2');
  for (const url of ['http://example.test/', 'https://user:pass@example.test/', 'javascript:alert(1)', 'not a URL']) assert.throws(() => httpsUrl(url));
});
test('mock AI is deterministic, tagged and never invents a confirmed offer price', () => {
  const ai = new MockAI();
  assert.deepEqual(ai.qualify(lead), ai.qualify(lead));
  assert.equal(ai.qualify(lead).provider, 'mock');
  assert.equal(ai.draft(lead, {name: 'Website', price: 500, currency: 'USD'}).price, 500);
  assert.match(ai.draft(lead, {name: 'Website'}).body, /human review/);
});
