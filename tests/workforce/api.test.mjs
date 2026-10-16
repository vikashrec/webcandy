import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture, intake, prepared} from './helpers.mjs';
import {makeServer} from '../../src/workforce/server.mjs';

async function http(t, options = {}) {
  const f = fixture(t);
  const server = makeServer({store: f.store, clock: f.clock, ...options});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = email => f.credentials.find(c => c.email === email).apiToken;
  const call = async (path, {email = 'admin@alpha.example.test', input, headers = {}, raw, method} = {}) => {
    const response = await fetch(origin + path, {method: method || (input || raw ? 'POST' : 'GET'), headers: {
      ...(email ? {Authorization: 'Bearer ' + token(email)} : {}),
      ...(input || raw ? {'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID()} : {}), ...headers
    }, body: raw || (input ? JSON.stringify(input) : undefined)});
    return {response, data: await response.json()};
  };
  return {...f, call, origin, server};
}
test('API health checks actual database; anonymous data is denied and static routes are allowlisted', async t => {
  const f = await http(t);
  const health = await f.call('/health', {email: null});
  assert.equal(health.response.status, 200); assert.equal(health.data.database, 'ok');
  assert.equal((await f.call('/api/v1/state', {email: null})).response.status, 401);
  const html = await fetch(f.origin + '/workforce'); assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await f.call('/private-data/development-credentials.json')).response.status, 404);
  assert.equal((await f.call('/assets/../database.mjs')).response.status, 404);
});
test('API rejects tenant headers/body spoofing and handles tenant IDs as credentials-bound values', async t => {
  const f = await http(t);
  assert.equal((await f.call('/api/v1/state', {headers: {'X-Tenant-Id': 'bravo'}})).response.status, 403);
  assert.equal((await f.call('/api/v1/buyers', {input: {tenantId: 'bravo', name: 'Injected'}})).response.status, 403);
  assert.equal((await f.call('/api/v1/state')).data.actor.tenant, 'alpha');
  assert.equal((await f.call('/api/v1/state', {email: 'admin@bravo.example.test'})).data.leads.length, 0);
});
test('API idempotency is actor and tenant scoped, detects changed payloads and writes one audit', async t => {
  const f = await http(t); const input = {name: 'Buyer', tags: ['website'], target: {}};
  const headers = {'Idempotency-Key': 'same-key-1234'};
  const first = await f.call('/api/v1/buyers', {input, headers});
  const repeat = await f.call('/api/v1/buyers', {input, headers});
  assert.equal(first.response.status, 200); assert.deepEqual(first.data, repeat.data);
  assert.equal((await f.call('/api/v1/buyers', {input: {...input, name: 'Changed'}, headers})).response.status, 409);
  const other = await f.call('/api/v1/buyers', {email: 'admin@bravo.example.test', input, headers});
  assert.equal(other.response.status, 200); assert.notEqual(first.data.id, other.data.id);
  assert.equal(f.store.events('alpha').filter(e => e.action === 'buyer.created').length, 3);
});
test('API validates body shape, size, content type, idempotency keys and unknown routes', async t => {
  const f = await http(t);
  assert.equal((await f.call('/api/v1/buyers', {raw: '{bad'})).response.status, 400);
  assert.equal((await f.call('/api/v1/buyers', {raw: '[]'})).response.status, 400);
  assert.equal((await f.call('/api/v1/buyers', {input: {}, headers: {'Content-Type': 'text/plain'}})).response.status, 415);
  assert.equal((await f.call('/api/v1/buyers', {input: {}, headers: {'Idempotency-Key': 'short'}})).response.status, 400);
  assert.equal((await f.call('/api/v1/buyers', {input: {name: 'x'.repeat(66000)}})).response.status, 413);
  assert.equal((await f.call('/api/v1/unknown', {input: {}})).response.status, 404);
});
test('API login sets HttpOnly SameSite cookie; CSRF, logout, session expiry and password failure work', async t => {
  const f = await http(t); const credential = f.credentials[0];
  const login = input => f.call('/auth/login', {email: null, input, headers: {Origin: f.origin}});
  assert.equal((await login({email: credential.email, password: 'wrong'})).response.status, 401);
  const result = await login({email: credential.email, password: credential.password});
  assert.equal(result.response.status, 200);
  const cookie = result.response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const headers = {Cookie: cookie.split(';')[0]};
  assert.equal((await f.call('/api/v1/state', {email: null, headers})).data.actor.tenant, 'alpha');
  assert.equal((await f.call('/api/v1/buyers', {email: null, input: {}, headers})).response.status, 403);
  assert.equal((await f.call('/api/v1/buyers', {email: null, input: {}, headers: {...headers, Origin: 'https://evil.test'}})).response.status, 403);
  assert.equal((await f.call('/auth/logout', {email: null, input: {}, headers: {...headers, Origin: f.origin}})).response.status, 200);
  assert.equal((await f.call('/api/v1/state', {email: null, headers})).response.status, 401);
  const another = await login({email: credential.email, password: credential.password});
  f.now.value += 9 * 3600000;
  assert.equal((await f.call('/api/v1/state', {email: null, headers: {Cookie: another.response.headers.get('set-cookie').split(';')[0]}})).response.status, 401);
});
test('API buyers cannot mutate admin resources or access audit; foreign IDs reveal no records', async t => {
  const f = await http(t); const x = prepared(f);
  for (const action of ['sources', 'opportunities/intake', 'leads/qualify', 'consents', 'suppressions', 'catalog/services', 'offers/draft', 'allocations', 'campaigns', 'campaigns/approve', 'campaigns/schedule', 'outreach/dispatch', 'retention/purge']) {
    const result = await f.call('/api/v1/' + action, {email: 'buyer@alpha.example.test', input: {leadId: x.lead.id}});
    assert.equal(result.response.status, 403, action);
  }
  assert.equal((await f.call('/api/v1/audit', {email: 'buyer@alpha.example.test'})).response.status, 403);
  assert.equal((await f.call('/api/v1/leads/qualify', {email: 'admin@bravo.example.test', input: {leadId: x.lead.id}})).response.status, 404);
  const buyer = (await f.call('/api/v1/state', {email: 'other-buyer@alpha.example.test'})).data;
  assert.equal(buyer.leads.length, 0); assert.equal(buyer.allocations.length, 0);
});
test('API SQL injection payload stays a value and transactions rollback on internal failure', async t => {
  const f = await http(t);
  const name = "Buyer'); DROP TABLE tenants; --";
  const created = await f.call('/api/v1/buyers', {input: {name, tags: ['website'], target: {}}});
  assert.equal(created.data.name, name);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM tenants').get().n, 2);
  // Force a late audit failure: business record + idempotency response must not commit.
  f.store.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit WHEN NEW.action='buyer.created' BEGIN SELECT RAISE(ABORT,'injected test failure'); END;");
  const before = f.store.list('alpha', 'buyers').length;
  const failure = await f.call('/api/v1/buyers', {input: {name: 'Rollback', tags: ['website'], target: {}}});
  assert.equal(failure.response.status, 500); assert.equal(failure.data.error, 'Internal service error');
  assert.equal(f.store.list('alpha', 'buyers').length, before);
});
test('API revoking a principal invalidates its keys immediately', async t => {
  const f = await http(t);
  f.store.db.prepare('UPDATE principals SET active=0 WHERE id=?').run(f.a.admin.id);
  assert.equal((await f.call('/api/v1/state')).response.status, 401);
});
test('API rate limits authentication independently of normal requests', async t => {
  const f = await http(t, {rateLimit: 2});
  assert.equal((await f.call('/health', {email: null})).response.status, 200);
  assert.equal((await f.call('/health', {email: null})).response.status, 200);
  assert.equal((await f.call('/health', {email: null})).response.status, 429);
  for (let i = 0; i < 10; i++) assert.equal((await f.call('/auth/login', {email: null, input: {email: 'nobody@example.test', password: 'wrong'}, headers: {Origin: f.origin}})).response.status, 401);
  assert.equal((await f.call('/auth/login', {email: null, input: {}, headers: {Origin: f.origin}})).response.status, 429);
});
test('signed webhook binds source and tenant, rejects signature/staleness/replay, and never accepts live intake', async t => {
  const f = await http(t);
  const source = f.service.createSource(f.a.admin, {name: 'Synthetic webhook', type: 'webhook', evidence: 'https://example.test/permission', permissionExpiresAt: new Date(f.clock() + 3600000).toISOString()});
  // A second server receives test-only runtime connector secrets, never stored in records.
  const secret = 'test-only-signing-secret-32-characters';
  const server = makeServer({store: f.store, clock: f.clock, webhookKeys: {sample: {sourceId: source.id, principalId: f.a.admin.id, secret}}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const lead = intake(f);
  const body = {...lead, externalId: 'webhook-1', sourceId: source.id, sourceUrl: 'https://example.test/webhook-1'};
  const send = async (input, {timestamp = String(f.clock()), signature} = {}) => {
    const raw = JSON.stringify(input);
    return fetch(`http://127.0.0.1:${server.address().port}/api/v1/connectors/sample/webhook`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Wc-Timestamp': timestamp, 'X-Wc-Signature': signature || createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}, body: raw});
  };
  assert.equal((await send(body, {signature: '0'.repeat(64)})).status, 401);
  assert.equal((await send(body, {timestamp: String(f.clock() - 400000)})).status, 401);
  assert.equal((await send({...body, tenantId: 'bravo'})).status, 403);
  assert.equal((await send({...body, synthetic: false})).status, 403);
  assert.equal((await send(body)).status, 201);
  assert.equal((await send(body)).status, 409);
  assert.equal(f.service.leads(f.b.admin).length, 0);
});
test('API concurrent duplicate intakes and exclusive allocations commit once', async t => {
  const f = await http(t); const lead = intake(f); f.service.qualify(f.a.admin, {leadId: lead.id});
  const request = {sourceId: f.a.source.id, title: 'Need website', tags: ['website'], sourceUrl: lead.sourceUrl, externalId: 'same', synthetic: true, remote: true, onsite: false};
  const results = await Promise.all(Array.from({length: 10}, () => f.call('/api/v1/opportunities/intake', {input: request})));
  assert.ok(results.every(r => r.response.status === 200 && r.data.lead.id === lead.id));
  const allocated = await Promise.all([f.a.buyer, f.a.buyer2].map(b => f.call('/api/v1/allocations', {input: {leadId: lead.id, buyerId: b.id, mode: 'exclusive', evidence: 'https://example.test/rights'}})));
  assert.deepEqual(allocated.map(r => r.response.status).sort(), [200, 409]);
});

test('official API mock collection is atomic, source scoped and never accepts real records', async t => {
  const f = await http(t);
  const source = f.service.createSource(f.a.admin, {name: 'Official API mock', type: 'official_api', evidence: 'https://example.test/permission', permissionExpiresAt: new Date(f.clock() + 3600000).toISOString()});
  const record = {externalId: 'official-1', sourceUrl: 'https://example.test/official-1', title: 'Need website', tags: ['website'], remote: true, onsite: false, synthetic: true};
  assert.equal((await f.call('/api/v1/connectors/collect-mock', {input: {sourceId: source.id, records: [{...record, synthetic: false}]}})).response.status, 403);
  const failed = await f.call('/api/v1/connectors/collect-mock', {input: {sourceId: source.id, records: [record, {...record, externalId: 'bad', sourceUrl: 'http://bad.test'}]}});
  assert.equal(failed.response.status, 400);
  assert.equal(f.store.list('alpha', 'leads').length, 0);
  const ok = await f.call('/api/v1/connectors/collect-mock', {input: {sourceId: source.id, records: [record]}});
  assert.equal(ok.response.status, 200); assert.equal(ok.data.externalRequests, 0);
  assert.equal(ok.data.results[0].lead.sourceId, source.id);
});
