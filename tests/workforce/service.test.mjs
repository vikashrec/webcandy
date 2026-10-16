import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, intake, prepared, due} from './helpers.mjs';

test('intake records provenance, deduplicates canonical URL and source external ID per tenant', t => {
  const f = fixture(t); const lead = intake(f);
  assert.equal(intake(f, f.a.admin, {sourceUrl: lead.sourceUrl + '?utm_source=demo#part', externalId: 'other'}).id, lead.id);
  assert.equal(intake(f, f.a.admin, {sourceUrl: 'https://example.test/different'}).id, lead.id);
  assert.notEqual(intake(f, f.b.admin).id, lead.id);
  assert.equal(f.service.leads(f.a.admin).length, 1);
  assert.equal(lead.resaleAllowed, false);
  assert.equal(lead.capturedAt, lead.occurredAt);
});
test('intake rejects real data, expired permissions, contact fields, invalid timestamps and retention', t => {
  const f = fixture(t);
  for (const extra of [{synthetic: false}, {email: 'contact@example.test'}, {contacts: []}, {retentionDays: 0}, {budget: -1}, {occurredAt: 'bad'}, {remote: false, onsite: false}]) assert.throws(() => intake(f, f.a.admin, extra));
  f.now.value += 366 * 86400000;
  assert.throws(() => intake(f), /permission expired/);
});
test('buyer cannot create sources, intake, qualify, consent, suppress or modify catalog', t => {
  const f = fixture(t); const lead = intake(f);
  for (const method of ['createSource', 'intake', 'qualify', 'consent', 'suppress', 'createService', 'createBuyer', 'offer', 'allocate', 'campaign', 'approve', 'schedule', 'dispatch', 'purge']) {
    assert.throws(() => f.service[method](f.a.buyerActor, {leadId: lead.id}), /Admin role/);
  }
});
test('tenant foreign IDs fail for every relationship and do not mutate foreign records', t => {
  const f = fixture(t); const x = prepared(f);
  const attempts = [
    ['intake', {sourceId: f.a.source.id}],
    ['qualify', {leadId: x.lead.id}], ['offer', {leadId: x.lead.id, serviceId: f.a.catalog.id}],
    ['allocate', {leadId: x.lead.id, buyerId: f.a.buyer.id}], ['consent', {leadId: x.lead.id}],
    ['approve', {campaignId: x.campaign.id}], ['schedule', {campaignId: x.campaign.id}],
    ['cancel', {campaignId: x.campaign.id}], ['suppress', {leadId: x.lead.id}], ['match', {buyerId: f.a.buyer.id}],
    ['conversion', {allocationId: x.allocation.id}]
  ];
  for (const [method, input] of attempts) assert.throws(() => f.service[method](f.b.admin, input), /Not found/);
  assert.equal(f.service.leads(f.b.admin).length, 0);
  assert.equal(f.service.snapshot(f.b.admin).campaigns.length, 0);
});

test('source permission expiry immediately hides buyer inventory as well as matching', t => {
  const f = fixture(t); const x = prepared(f);
  f.store.put('alpha', 'sources', {...f.a.source, permissionExpiresAt: new Date(f.clock() - 1).toISOString()});
  assert.equal(f.service.leads(f.a.buyerActor).length, 0);
  assert.equal(f.service.match(f.a.admin, {buyerId: f.a.buyer.id}).length, 0);
  assert.throws(() => f.service.offer(f.a.admin, {leadId: x.lead.id, serviceId: f.a.catalog.id}), /permission expired/);
});

test('purging one recipient removes shared campaign attribution without leaving dangling conversions', t => {
  const f = fixture(t); const first = prepared(f);
  const second = intake(f, f.a.admin, {externalId: 'second', sourceUrl: 'https://example.test/second', retentionDays: 90});
  f.service.qualify(f.a.admin, {leadId: second.id});
  const allocation = f.service.allocate(f.a.admin, {leadId: second.id, buyerId: f.a.buyer.id, mode: 'exclusive', evidence: 'https://example.test/rights'});
  f.service.consent(f.a.admin, {leadId: second.id, status: 'granted', channel: 'email', purpose: 'requested_offer', evidence: 'https://example.test/consent', expiresAt: new Date(f.clock() + 3600000).toISOString()});
  const offer = f.service.offer(f.a.admin, {leadId: second.id, serviceId: f.a.catalog.id});
  const campaign = f.service.campaign(f.a.admin, {name: 'Two recipients', offerIds: [first.offer.id, offer.id], channel: 'email', purpose: 'requested_offer'});
  due(f, campaign); f.service.dispatch(f.a.admin, {campaignId: campaign.id, mode: 'mock'});
  f.service.conversion(f.a.admin, {allocationId: allocation.id, eventId: 'attributed', type: 'won', value: 50, currency: 'USD', campaignId: campaign.id});
  f.now.value += 31 * 86400000;
  f.store.transaction(() => f.service.purge(f.a.admin));
  assert.equal(f.store.list('alpha', 'leads').length, 1);
  assert.equal(f.store.list('alpha', 'conversions').length, 0);
  assert.equal(f.store.list('alpha', 'receipts').length, 0);
  assert.equal(f.store.list('alpha', 'campaigns').some(c => c.id === campaign.id), false);
});
test('qualification produces persisted mock score and only matches qualified compatible buyers', t => {
  const f = fixture(t); const lead = intake(f);
  assert.equal(f.service.match(f.a.admin, {buyerId: f.a.buyer.id}).length, 0);
  const qualified = f.service.qualify(f.a.admin, {leadId: lead.id});
  assert.equal(qualified.qualification.score, 90);
  assert.equal(f.service.match(f.a.admin, {buyerId: f.a.buyer.id}).length, 1);
  f.store.put('alpha', 'buyers', {...f.a.buyer, tags: ['unrelated']});
  assert.equal(f.service.match(f.a.admin, {buyerId: f.a.buyer.id}).length, 0);
});
test('buyer sees only own allocations with no source URLs, evidence or other buyer inventory', t => {
  const f = fixture(t); const x = prepared(f);
  const a = f.service.snapshot(f.a.buyerActor);
  assert.equal(a.leads.length, 1);
  assert.equal(a.leads[0].sourceUrl, undefined);
  assert.equal(a.allocations[0].evidence, undefined);
  assert.equal(a.sources.length, 0); assert.equal(a.audit.length, 0); assert.equal(a.offers.length, 0);
  assert.equal(f.service.leads(f.a.otherBuyer).length, 0);
  assert.equal(f.service.match(f.a.otherBuyer, {}).length, 0);
  assert.throws(() => f.service.match(f.a.otherBuyer, {buyerId: f.a.buyer.id}), /scope/);
  assert.throws(() => f.service.conversion(f.a.otherBuyer, {allocationId: x.allocation.id}), /scope/);
});
test('exclusive allocations, client ownership and resale controls cannot be bypassed', t => {
  const f = fixture(t); const x = prepared(f);
  const allocate = extra => f.service.allocate(f.a.admin, {leadId: x.lead.id, buyerId: f.a.buyer2.id, mode: 'exclusive', evidence: 'https://example.test/rights', ...extra});
  assert.throws(() => allocate({}), /Exclusive/);
  assert.throws(() => allocate({resale: true}), /Resale/);
  assert.throws(() => allocate({mode: 'shared'}), /shared distribution/);
  f.store.put('alpha', 'leads', {...x.lead, ownership: 'client-owned'});
  assert.throws(() => allocate({}), /Client-owned/);
});
test('shared allocation requires explicit rights for every buyer and is audited', t => {
  const f = fixture(t); const lead = intake(f); f.service.qualify(f.a.admin, {leadId: lead.id});
  for (const buyer of [f.a.buyer, f.a.buyer2]) f.service.allocate(f.a.admin, {leadId: lead.id, buyerId: buyer.id, mode: 'shared', evidence: 'https://example.test/owner', sharedRightsEvidence: 'https://example.test/sharing'});
  assert.equal(f.service.leads(f.a.buyerActor).length, 1);
  assert.equal(f.service.leads(f.a.otherBuyer).length, 1);
  assert.equal(f.store.events('alpha').filter(e => e.action === 'lead.allocated').length, 2);
});
test('offers reject unqualified, mismatched and expired catalog entries', t => {
  const f = fixture(t); const lead = intake(f);
  assert.throws(() => f.service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id}), /Qualification/);
  f.service.qualify(f.a.admin, {leadId: lead.id});
  f.store.put('alpha', 'catalog', {...f.a.catalog, tags: ['other']});
  assert.throws(() => f.service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id}), /does not match/);
  f.store.put('alpha', 'catalog', {...f.a.catalog, validUntil: new Date(f.clock() - 1).toISOString()});
  assert.throws(() => f.service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id}), /expired/);
});
test('consent is channel/purpose scoped, latest decision wins and invalid expiry is rejected', t => {
  const f = fixture(t); const x = prepared(f);
  assert.throws(() => f.service.canContact(f.a.admin, x.lead.id, 'whatsapp', 'requested_offer'), /consent/);
  assert.throws(() => f.service.canContact(f.a.admin, x.lead.id, 'email', 'marketing'), /consent/);
  const decision = {leadId: x.lead.id, channel: 'email', purpose: 'requested_offer', evidence: 'https://example.test/revoke', status: 'withdrawn'};
  f.service.consent(f.a.admin, decision);
  assert.throws(() => f.service.canContact(f.a.admin, x.lead.id, 'email', 'requested_offer'), /consent/);
  assert.throws(() => f.service.consent(f.a.admin, {...decision, status: 'granted', expiresAt: 'not-a-date'}), /timestamp/);
});
test('campaigns require consent, allocation, independent admin approval and due schedule', t => {
  const f = fixture(t); const x = prepared(f);
  assert.throws(() => f.service.approve(f.a.admin, {campaignId: x.campaign.id, acknowledgeMock: true}), /different admin/);
  assert.throws(() => f.service.approve(f.a.reviewer, {campaignId: x.campaign.id}), /Explicit/);
  assert.throws(() => f.service.schedule(f.a.admin, {campaignId: x.campaign.id, scheduledAt: new Date(f.clock() + 1000).toISOString()}), /Approved/);
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'}), /not due/);
  due(f, x.campaign);
  const receipt = f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'});
  assert.equal(receipt.simulated, true); assert.equal(receipt.count, 1);
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'}), /not due/);
});
test('live dispatch is blocked even for an approved, due campaign', t => {
  const f = fixture(t); const x = prepared(f); due(f, x.campaign);
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'live'}), /Live dispatch is disabled/);
  assert.equal(f.service.list(f.a.admin, 'receipts').length, 0);
});
test('withdrawal after scheduling blocks dispatch and leaves no receipt', t => {
  const f = fixture(t); const x = prepared(f); due(f, x.campaign);
  f.service.consent(f.a.admin, {leadId: x.lead.id, status: 'withdrawn', channel: 'email', purpose: 'requested_offer', evidence: 'https://example.test/revoke'});
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'}), /consent/);
  assert.equal(f.service.list(f.a.admin, 'receipts').length, 0);
});
test('suppression after approval blocks matching, buyer visibility, dispatch and re-intake', t => {
  const f = fixture(t); const x = prepared(f); due(f, x.campaign);
  f.service.suppress(f.a.admin, {leadId: x.lead.id, reason: 'Synthetic opt-out'});
  assert.equal(f.service.leads(f.a.buyerActor).length, 0);
  assert.equal(f.service.match(f.a.admin, {buyerId: f.a.buyer.id}).length, 0);
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'}), /suppressed/);
  assert.throws(() => intake(f), /suppressed/);
});
test('expired consent and source permissions are rechecked at execution time', t => {
  const f = fixture(t); const x = prepared(f); due(f, x.campaign);
  f.now.value += 3600000;
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'}), /consent/);
  const source = f.a.source;
  f.store.put('alpha', 'sources', {...source, permissionExpiresAt: new Date(f.clock() - 1).toISOString()});
  assert.throws(() => f.service.qualify(f.a.admin, {leadId: x.lead.id}), /Source permission expired/);
});
test('cancellation is terminal and never creates delivery receipts', t => {
  const f = fixture(t); const x = prepared(f);
  f.service.cancel(f.a.admin, {campaignId: x.campaign.id});
  assert.throws(() => f.service.approve(f.a.reviewer, {campaignId: x.campaign.id, acknowledgeMock: true}), /Draft/);
  assert.equal(f.service.list(f.a.admin, 'receipts').length, 0);
});
test('conversion events enforce allocation ownership, dedupe and campaign attribution; currencies stay separate', t => {
  const f = fixture(t); const x = prepared(f); due(f, x.campaign);
  const payload = {allocationId: x.allocation.id, eventId: 'one', value: 100, currency: 'USD', type: 'won', campaignId: x.campaign.id};
  assert.throws(() => f.service.conversion(f.a.buyerActor, payload), /attribution/);
  f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'});
  f.service.conversion(f.a.buyerActor, payload);
  assert.throws(() => f.service.conversion(f.a.buyerActor, payload), /Duplicate/);
  f.service.conversion(f.a.admin, {...payload, eventId: 'two', currency: 'INR', value: 1000});
  assert.deepEqual(f.service.report(f.a.admin).valuesByCurrency, {USD: 100, INR: 1000});
  assert.equal(f.service.report(f.a.otherBuyer).conversions, 0);
  assert.equal(f.service.report(f.b.admin).conversions, 0);
});
test('retention deletes dependent data and tenant caches while retaining audit and suppression tombstones', t => {
  const f = fixture(t); const x = prepared(f); intake(f, f.b.admin);
  f.service.suppress(f.a.admin, {leadId: x.lead.id, reason: 'Synthetic request'});
  f.now.value += 31 * 86400000;
  const result = f.store.transaction(() => f.service.purge(f.a.admin));
  assert.equal(result.purged, 1);
  for (const kind of ['leads', 'consents', 'offers', 'allocations', 'campaigns', 'receipts', 'conversions']) assert.equal(f.store.list('alpha', kind).length, 0);
  assert.equal(f.store.list('bravo', 'leads').length, 1);
  assert.equal(f.store.list('alpha', 'suppressions').length, 1);
  assert.ok(f.store.events('alpha').some(e => e.action === 'retention.purged'));
  assert.throws(() => intake(f), /suppressed/);
});
