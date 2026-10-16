import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, intake, prepared, due} from './helpers.mjs';
import {Workforce} from '../../src/workforce/service.mjs';
import {makeServer} from '../../src/workforce/server.mjs';
import {Store} from '../../src/workforce/database.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

async function http(t, f, extra = {}) {
  const server = makeServer({store: f.store, clock: f.clock, ...extra});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, input, {key = crypto.randomUUID(), email = 'admin@alpha.example.test', headers = {}} = {}) => {
    const credential = f.credentials.find(c => c.email === email);
    const response = await fetch(origin + path, {method: input ? 'POST' : 'GET', headers: {Authorization: 'Bearer ' + credential.apiToken,
      ...(input ? {'Content-Type': 'application/json', 'Idempotency-Key': key} : {}), ...headers}, body: input ? JSON.stringify(input) : undefined});
    return {status: response.status, data: await response.json()};
  };
  return {server, origin, request};
}

test('QA-01: withdrawal remains possible after suppression and source permission expiry', t => {
  const f = fixture(t); const {lead} = prepared(f);
  f.service.suppress(f.a.admin, {leadId: lead.id, reason: 'opt-out'});
  f.store.put('alpha', 'sources', {...f.a.source, permissionExpiresAt: new Date(f.clock() - 1).toISOString()});
  const result = f.service.consent(f.a.admin, {leadId: lead.id, status: 'withdrawn', channel: 'email', purpose: 'requested_offer', evidence: 'https://example.test/withdrawal'});
  assert.equal(result.status, 'withdrawn');
  assert.throws(() => f.service.consent(f.a.admin, {...result, status: 'granted', expiresAt: new Date(f.clock() + 10000).toISOString()}), /suppressed|expired/);
});
test('QA-02: suppression survives retention when a source record is reintroduced under another URL', t => {
  const f = fixture(t); const lead = intake(f);
  f.service.suppress(f.a.admin, {leadId: lead.id, reason: 'opt-out'});
  f.now.value += 31 * 86400000;
  f.store.transaction(() => f.service.purge(f.a.admin));
  assert.throws(() => intake(f, f.a.admin, {sourceUrl: 'https://example.test/renamed'}), /suppressed/);
});
test('QA-03: idempotency cannot bypass a principal role downgrade', async t => {
  const f = fixture(t); const h = await http(t, f);
  const input = {name: 'Role cache', tags: ['website'], target: {}};
  assert.equal((await h.request('/api/v1/buyers', input, {key: 'role-cache-0001'})).status, 200);
  f.store.db.prepare("UPDATE principals SET role='buyer',buyer=? WHERE id=?").run(f.a.buyer.id, f.a.admin.id);
  assert.equal((await h.request('/api/v1/buyers', input, {key: 'role-cache-0001'})).status, 403);
});
test('QA-04: repeated buyer match queries recheck suppression rather than replay stale inventory', async t => {
  const f = fixture(t); const {lead} = prepared(f); const h = await http(t, f);
  const options = {key: 'match-cache-0001', email: 'buyer@alpha.example.test'};
  assert.equal((await h.request('/api/v1/buyers/match', {}, options)).data.length, 1);
  f.service.suppress(f.a.admin, {leadId: lead.id, reason: 'opt-out'});
  assert.equal((await h.request('/api/v1/buyers/match', {}, options)).data.length, 0);
});
test('QA-05: inactive buyers lose sessions/inventory, matching and campaign eligibility', async t => {
  const f = fixture(t); const {campaign} = prepared(f); due(f, campaign);
  f.store.put('alpha', 'buyers', {...f.a.buyer, active: false});
  assert.throws(() => f.service.leads(f.a.buyerActor), /inactive/);
  assert.throws(() => f.service.match(f.a.admin, {buyerId: f.a.buyer.id}), /inactive/);
  assert.throws(() => f.service.dispatch(f.a.admin, {campaignId: campaign.id, mode: 'mock'}), /allocation|inactive/i);
  const h = await http(t, f);
  assert.equal((await h.request('/api/v1/state', undefined, {email: 'buyer@alpha.example.test'})).status, 401);
});
test('QA-06: AI failure uses an explicit deterministic development fallback without leaking errors', t => {
  const f = fixture(t); const lead = intake(f);
  const service = new Workforce(f.store, {clock: f.clock, ai: {qualify() { throw Error('private-provider-detail'); }, draft() { throw Error('private-provider-detail'); }}});
  const qualified = service.qualify(f.a.admin, {leadId: lead.id});
  assert.equal(qualified.qualification.fallback, true);
  assert.equal(qualified.qualification.provider, 'mock');
  assert.doesNotMatch(JSON.stringify(qualified), /private-provider-detail/);
  const offer = service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id});
  assert.equal(offer.fallback, true); assert.equal(offer.price, f.a.catalog.price);
});
test('QA-07: AI output cannot overwrite offer identity, catalog price or qualification validity', t => {
  const f = fixture(t); const lead = intake(f);
  const service = new Workforce(f.store, {clock: f.clock, ai: {
    qualify: () => ({provider: 'mock', score: 1000, reasons: [], reviewRequired: false}),
    draft: () => ({provider: 'mock', id: f.a.catalog.id, leadId: 'foreign', serviceId: 'foreign', subject: 'Bad price', body: 'Bad', price: 0, currency: 'XXX'})
  }});
  const qualified = service.qualify(f.a.admin, {leadId: lead.id});
  assert.ok(qualified.qualification.score <= 100); assert.equal(qualified.qualification.reviewRequired, true);
  const offer = service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id});
  assert.equal(offer.leadId, lead.id); assert.equal(offer.serviceId, f.a.catalog.id); assert.notEqual(offer.id, f.a.catalog.id);
  assert.equal(offer.price, f.a.catalog.price); assert.equal(offer.currency, f.a.catalog.currency);
});
test('QA-08: campaign cannot include the same recipient twice through separate offer IDs', t => {
  const f = fixture(t); const {lead, offer} = prepared(f);
  const second = f.service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id});
  assert.throws(() => f.service.campaign(f.a.admin, {name: 'Duplicate recipients', offerIds: [offer.id, second.id], channel: 'email', purpose: 'requested_offer'}), /recipient/);
});
test('QA-09: readiness returns 503 for a valid but uninitialized database', async t => {
  const store = new Store(); t.after(() => store.close());
  const server = makeServer({store});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 503); assert.equal((await response.json()).initialized, false);
});

test('QA-10: audit storage failure during a denial returns 503 without crashing the server', async t => {
  const f = fixture(t); const h = await http(t, f);
  f.store.db.exec("CREATE TRIGGER qa_audit_failure BEFORE INSERT ON audit WHEN NEW.action='security.denied' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
  const result = await h.request('/api/v1/sources', {}, {email: 'buyer@alpha.example.test'});
  assert.equal(result.status, 503); assert.deepEqual(result.data, {error: 'Audit service unavailable'});
  assert.equal((await h.request('/api/v1/state')).status, 200);
});
test('QA-11: async/rejected AI results are not accepted inside a synchronous transaction', async t => {
  const f = fixture(t); const lead = intake(f);
  const ai = {qualify: () => Promise.reject(Error('synthetic rejection'))};
  const service = new Workforce(f.store, {clock: f.clock, ai});
  const qualified = f.store.transaction(() => service.qualify(f.a.admin, {leadId: lead.id}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(qualified.qualification.fallback, true);
  assert.equal(qualified.qualification.score, 90);
});
test('QA-12: AI input mutation and extra fields cannot corrupt system-owned lead/offer data', t => {
  const f = fixture(t); const lead = intake(f);
  const service = new Workforce(f.store, {clock: f.clock, ai: {
    qualify(input) { input.title = 'Mutated'; return {provider: 'mock', model: 'test', score: 50, reasons: ['fixture'], reviewRequired: true, title: 'Injected'}; },
    draft(input, catalog) { input.id = 'foreign'; return {provider: 'mock', id: 'injected', leadId: 'foreign', serviceId: 'foreign', subject: 'Draft', body: 'Synthetic draft', price: catalog.price, currency: catalog.currency}; }
  }});
  assert.equal(service.qualify(f.a.admin, {leadId: lead.id}).title, lead.title);
  const offer = service.offer(f.a.admin, {leadId: lead.id, serviceId: f.a.catalog.id});
  assert.equal(offer.leadId, lead.id); assert.notEqual(offer.id, 'injected'); assert.equal(offer.fallback, false);
});
test('QA-13: HTTP AI fallback records an audit marker and leaves all sending approval gates intact', async t => {
  const f = fixture(t); const lead = intake(f);
  const h = await http(t, f, {ai: {qualify() {throw Error('private');}, draft() {throw Error('private');}}});
  const result = await h.request('/api/v1/leads/qualify', {leadId: lead.id});
  assert.equal(result.status, 200); assert.equal(result.data.qualification.fallback, true);
  const offer = await h.request('/api/v1/offers/draft', {leadId: lead.id, serviceId: f.a.catalog.id});
  assert.equal(offer.data.status, 'draft_pending_approval'); assert.equal(offer.data.fallback, true);
  assert.equal(f.store.events('alpha').filter(e => e.action === 'ai.fallback').length, 2);
  assert.equal(f.store.list('alpha', 'receipts').length, 0);
});
test('QA-14: both email and WhatsApp simulators require purpose-specific consent and record the channel', t => {
  const f = fixture(t); const x = prepared(f); due(f, x.campaign);
  const email = f.service.dispatch(f.a.admin, {campaignId: x.campaign.id, mode: 'mock'});
  assert.equal(email.channel, 'email'); assert.equal(email.simulated, true);
  const payload = {name: 'WhatsApp mock', offerIds: [x.offer.id], channel: 'whatsapp', purpose: 'marketing'};
  assert.throws(() => f.service.campaign(f.a.admin, payload), /consent/);
  f.service.consent(f.a.admin, {leadId: x.lead.id, channel: 'whatsapp', purpose: 'marketing', status: 'granted', evidence: 'https://example.test/opt-in', expiresAt: new Date(f.clock() + 10000).toISOString()});
  const campaign = f.service.campaign(f.a.admin, payload); due(f, campaign);
  const whatsapp = f.service.dispatch(f.a.admin, {campaignId: campaign.id, mode: 'mock'});
  assert.equal(whatsapp.channel, 'whatsapp'); assert.equal(whatsapp.purpose, 'marketing'); assert.equal(whatsapp.simulated, true);
  assert.equal(f.store.list('alpha', 'receipts').length, 2);
});
test('QA-15: retained legacy suppression identities are backfilled before the lead is purged', t => {
  const f = fixture(t); const lead = intake(f);
  f.service.suppress(f.a.admin, {leadId: lead.id, reason: 'legacy fixture'});
  const tombstone = f.store.list('alpha', 'suppressions')[0]; delete tombstone.sourceKey;
  f.store.put('alpha', 'suppressions', tombstone);
  f.now.value += 31 * 86400000; f.store.transaction(() => f.service.purge(f.a.admin));
  assert.throws(() => intake(f, f.a.admin, {sourceUrl: 'https://example.test/moved'}), /suppressed/);
});
test('QA-16: changing a buyer principal assignment cannot replay the previous buyer conversion response', async t => {
  const f = fixture(t); const x = prepared(f); const h = await http(t, f);
  const input = {allocationId: x.allocation.id, eventId: 'rebind', type: 'won', value: 500, currency: 'USD'};
  const options = {email: 'buyer@alpha.example.test', key: 'buyer-rebind-0001'};
  assert.equal((await h.request('/api/v1/conversions/events', input, options)).status, 200);
  f.store.db.prepare('UPDATE principals SET buyer=? WHERE id=?').run(f.a.buyer2.id, f.a.buyerActor.id);
  assert.equal((await h.request('/api/v1/conversions/events', input, options)).status, 409);
});

test('QA-17: persisted matching covers global/country/state/city and service-location targeting', t => {
  const f = fixture(t);
  const india = intake(f, f.a.admin, {serviceLocation: {country: 'GB', state: 'GB-ENG', city: 'london'}});
  const us = intake(f, f.a.admin, {externalId: 'us-1', sourceUrl: 'https://example.test/us-1', location: {country: 'US', state: 'US-CA', city: 'oakland'}, remote: false, onsite: true});
  for (const lead of [india, us]) f.service.qualify(f.a.admin, {leadId: lead.id});
  const cases = [
    [{}, [india.id, us.id]],
    [{include: [{country: 'in'}]}, [india.id]],
    [{include: [{country: 'IN', state: 'in-br'}]}, [india.id]],
    [{include: [{country: 'IN', state: 'IN-BR', city: 'PATNA'}]}, [india.id]],
    [{include: [{country: 'IN'}, {country: 'US'}], exclude: [{country: 'IN'}]}, [us.id]],
    [{remote: 'onsite'}, [us.id]],
    [{locationKind: 'service', include: [{country: 'GB'}]}, [india.id]],
    [{denyCountries: ['GB']}, [us.id]]
  ];
  for (const [target, expected] of cases) {
    const buyer = f.service.createBuyer(f.a.admin, {name: 'Geo QA', tags: ['website'], target});
    assert.deepEqual(f.service.match(f.a.admin, {buyerId: buyer.id}).map(l => l.id).sort(), expected.sort());
  }
});
test('QA-18: structured fields cannot coerce invalid location/currency/ownership types into stored data', async t => {
  const f = fixture(t); const x = prepared(f); const h = await http(t, f);
  const base = {name: 'Bad currency', tags: ['website'], price: 1, currency: ['USD'], evidence: 'https://example.test/review', validUntil: new Date(f.clock() + 10000).toISOString()};
  assert.equal((await h.request('/api/v1/catalog/services', base)).status, 400);
  assert.equal((await h.request('/api/v1/conversions/events', {allocationId: x.allocation.id, eventId: 'bad-currency', type: 'won', value: 1, currency: ['USD']})).status, 400);
  for (const extra of [{location: {language: ['en']}}, {serviceLocation: false}, {ownership: false}])
    assert.throws(() => intake(f, f.a.admin, {externalId: crypto.randomUUID(), sourceUrl: 'https://example.test/' + crypto.randomUUID(), ...extra}));
  assert.throws(() => f.service.createBuyer(f.a.admin, {name: 'Bad target', tags: ['website'], target: {remote: false}}));
});

test('QA-19: opening an unknown database schema fails without silently stamping it as version one', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wc-qa-schema-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'future.sqlite'); const db = new DatabaseSync(file);
  db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(2);'); db.close();
  let opened;
  try { assert.throws(() => { opened = new Store(file); }, /schema/i); } finally { opened?.close(); }
  const after = new DatabaseSync(file, {readOnly: true});
  try {
    assert.deepEqual(after.prepare('SELECT version FROM schema_version').all().map(r => r.version), [2]);
    assert.equal(after.prepare("SELECT count(*) n FROM sqlite_master WHERE name='tenants'").get().n, 0);
  } finally { after.close(); }
});
