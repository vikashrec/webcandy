import {Store} from '../../src/workforce/database.mjs';
import {seed} from '../../src/workforce/seed.mjs';
import {Workforce} from '../../src/workforce/service.mjs';

export function fixture(t, file) {
  const store = new Store(file);
  const seeded = seed(store);
  const now = {value: Date.now()};
  const clock = () => now.value;
  const service = new Workforce(store, {clock});
  t.after(() => store.close());
  return {store, service, clock, now, ...seeded, a: seeded.fixtures.alpha, b: seeded.fixtures.bravo};
}
export function intake(f, actor = f.a.admin, extra = {}) {
  const source = f.fixtures[actor.tenant].source;
  return f.service.intake(actor, {sourceId: source.id, externalId: 'sample-1', sourceUrl: 'https://example.test/opportunities/1',
    title: 'Need a company website', tags: ['website'], budget: 1000, location: {country: 'IN', state: 'IN-BR', city: 'patna'},
    remote: true, onsite: false, synthetic: true, ...extra}).lead;
}
export function prepared(f) {
  const actor = f.a.admin;
  const lead = intake(f);
  f.service.qualify(actor, {leadId: lead.id});
  const allocation = f.service.allocate(actor, {leadId: lead.id, buyerId: f.a.buyer.id, mode: 'exclusive', evidence: 'https://example.test/rights'});
  f.service.consent(actor, {leadId: lead.id, channel: 'email', purpose: 'requested_offer', status: 'granted', evidence: 'https://example.test/consent', expiresAt: new Date(f.clock() + 3600000).toISOString()});
  const offer = f.service.offer(actor, {leadId: lead.id, serviceId: f.a.catalog.id});
  const campaign = f.service.campaign(actor, {name: 'Synthetic campaign', offerIds: [offer.id], channel: 'email', purpose: 'requested_offer'});
  return {lead, allocation, offer, campaign};
}
export function due(f, campaign) {
  f.service.approve(f.a.reviewer, {campaignId: campaign.id, acknowledgeMock: true});
  f.service.schedule(f.a.admin, {campaignId: campaign.id, scheduledAt: new Date(f.clock() + 1000).toISOString()});
  f.now.value += 2000;
}
