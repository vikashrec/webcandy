import {createHash} from 'node:crypto';

export class Fault extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function check(ok, message, status = 400) { if (!ok) throw new Fault(status, message); }
export function text(value, name, max = 200) {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${name} required (max ${max})`);
  return value.trim();
}
export function oneOf(value, values, name) { check(values.includes(value), `Invalid ${name}`); return value; }
export const fingerprint = value => createHash('sha256').update(value).digest('hex');
export function httpsUrl(value) {
  let url;
  try { url = new URL(text(value, 'HTTPS URL', 2000)); } catch { throw new Fault(400, 'Valid HTTPS URL required'); }
  check(url.protocol === 'https:' && !url.username && !url.password, 'HTTPS URL without credentials required');
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) url.searchParams.delete(k);
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}
export function future(value, now) {
  check(typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now, 'Future timestamp required');
  return new Date(value).toISOString();
}
export function geography(input = {}) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Location object required');
  const country = String(input.country || '').toUpperCase();
  const state = String(input.state || '').toUpperCase();
  const city = String(input.city || '').toLowerCase();
  check(!country || /^[A-Z]{2}$/.test(country), 'Use ISO country code');
  check(!state || (country && state.startsWith(country + '-') && /^[A-Z]{2}-[A-Z0-9]{1,6}$/.test(state)), 'Use country-prefixed subdivision ID');
  check(!city || (state && /^[a-z0-9-]{1,80}$/.test(city)), 'City ID requires subdivision');
  const language = input.language || 'en';
  try { Intl.getCanonicalLocales(language); } catch { throw new Fault(400, 'Invalid language tag'); }
  const timezone = input.timezone || 'UTC';
  try { new Intl.DateTimeFormat('en', {timeZone: timezone}); } catch { throw new Fault(400, 'Invalid timezone'); }
  const currency = input.currency || 'USD';
  check(/^[A-Z]{3}$/.test(currency), 'Use three-letter currency');
  return {country, state, city, language, timezone, currency};
}
export function target(input = {}) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Target object required');
  const regions = key => {
    check(input[key] === undefined || (Array.isArray(input[key]) && input[key].length <= 50), 'Target regions must be arrays (max 50)');
    return (input[key] || []).map(geography);
  };
  const denyCountries = input.denyCountries || [];
  check(Array.isArray(denyCountries) && denyCountries.every(x => /^[A-Z]{2}$/.test(x)), 'Invalid jurisdiction exclusions');
  return {include: regions('include'), exclude: regions('exclude'), denyCountries,
    remote: oneOf(input.remote || 'any', ['any', 'remote', 'onsite'], 'remote eligibility'),
    locationKind: oneOf(input.locationKind || 'lead', ['lead', 'service'], 'location kind')};
}
export function matches(lead, criteria) {
  const loc = criteria.locationKind === 'service' ? lead.serviceLocation : lead.location;
  const inRegion = r => ['country', 'state', 'city'].every(k => !r[k] || loc[k] === r[k]);
  if (criteria.denyCountries.includes(lead.location.country) || criteria.denyCountries.includes(lead.serviceLocation.country)) return false;
  if (criteria.exclude.some(inRegion)) return false;
  if (criteria.include.length && !criteria.include.some(inRegion)) return false;
  return criteria.remote === 'any' || (criteria.remote === 'remote' ? lead.remote : lead.onsite);
}
export function tags(values) {
  check(Array.isArray(values) && values.length > 0 && values.length <= 20, '1–20 service tags required');
  return [...new Set(values.map(v => text(v, 'tag', 50).toLowerCase()))];
}

// No network implementation is reachable. A real adapter requires a separate reviewed implementation.
export class MockAI {
  qualify(lead) {
    const reasons = ['permitted source recorded', 'explicit requirement'];
    const score = Math.min(100, 40 + (lead.budget > 0 ? 20 : 0) + (lead.location.country ? 15 : 0) + (lead.tags.length ? 15 : 0));
    if (lead.budget > 0) reasons.push('declared budget');
    return {provider: 'mock', model: 'deterministic-v1', score, reasons, reviewRequired: true};
  }
  draft(lead, service) {
    return {provider: 'mock', subject: `${service.name} consultation`,
      body: `Draft for human review: discuss ${service.name} for “${lead.title}”. Scope and price require confirmation.`,
      price: service.price, currency: service.currency};
  }
}
