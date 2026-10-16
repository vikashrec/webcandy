import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store} from './database.mjs';
import {Workforce} from './service.mjs';
import {check, Fault, fingerprint} from './domain.mjs';

const assets = new Map([
  ['/workforce', ['../../public/workforce/index.html', 'text/html; charset=utf-8']],
  ['/assets/portal.js', ['../../public/workforce/portal.js', 'text/javascript; charset=utf-8']],
  ['/assets/style.css', ['../../public/workforce/style.css', 'text/css; charset=utf-8']],
  ['/legacy', ['../../index.html', 'text/html; charset=utf-8']]
]);
const actions = new Map([
  ['/sources', 'createSource'], ['/connectors/collect-mock', 'collectMock'], ['/opportunities/intake', 'intake'], ['/leads/qualify', 'qualify'],
  ['/consents', 'consent'], ['/suppressions', 'suppress'], ['/buyers', 'createBuyer'],
  ['/buyers/match', 'match'], ['/catalog/services', 'createService'], ['/offers/draft', 'offer'],
  ['/allocations', 'allocate'], ['/campaigns', 'campaign'], ['/campaigns/approve', 'approve'],
  ['/campaigns/schedule', 'schedule'], ['/campaigns/cancel', 'cancel'], ['/outreach/dispatch', 'dispatch'],
  ['/conversions/events', 'conversion'], ['/retention/purge', 'purge']
]);
async function readBody(req) {
  check(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON content type required', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; check(size <= 65536, 'Request too large', 413); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  let input;
  try { input = JSON.parse(raw); } catch { throw new Fault(400, 'Invalid JSON'); }
  check(input && typeof input === 'object' && !Array.isArray(input), 'JSON object required');
  return {input, raw};
}
export function makeServer({store, clock = Date.now, webhookKeys = {}, rateLimit = 150, ai} = {}) {
  check(store, 'Store required');
  const service = new Workforce(store, {clock, ai});
  const limits = new Map();
  const server = createServer(async (req, res) => {
    let requestActor;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const isLogin = path === '/auth/login';
      const bucket = `${req.socket.remoteAddress}:${isLogin ? 'login' : 'api'}`;
      const window = Math.floor(clock() / 60000);
      if (limits.size > 5000) for (const [k, v] of limits) if (v.window !== window) limits.delete(k);
      const count = limits.get(bucket)?.window === window ? limits.get(bucket).count + 1 : 1;
      limits.set(bucket, {window, count});
      check(count <= (isLogin ? 10 : rateLimit), 'Rate limit exceeded', 429);
      if (req.method === 'GET' && path === '/') { res.writeHead(302, {Location: '/workforce'}); res.end(); return; }
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path);
        if (path === '/legacy') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
        res.writeHead(200, {'Content-Type': type}); res.end(await readFile(new URL(file, import.meta.url))); return;
      }
      if (req.method === 'GET' && path === '/health') {
        const ok = store.db.prepare('PRAGMA quick_check').get().quick_check === 'ok';
        const initialized = store.db.prepare("SELECT count(*) AS n FROM principals WHERE active=1 AND role='admin'").get().n > 0;
        return json(ok && initialized ? 200 : 503, {ok: ok && initialized, database: ok ? 'ok' : 'failed', initialized,
          schema: 1, mode: 'synthetic-development', externalDispatch: false});
      }
      const port = server.address().port;
      const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
      const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1];
      const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('wc_session='))?.slice(11);
      if (req.method !== 'GET' && req.headers.origin) check(allowedOrigins.includes(req.headers.origin), 'Origin denied', 403);
      if (isLogin && req.method === 'POST') {
        check(allowedOrigins.includes(req.headers.origin), 'Same-origin login required', 403);
        const {input} = await readBody(req);
        check(typeof input.email === 'string' && input.email.length <= 200 && typeof input.password === 'string' && input.password.length <= 200, 'Email and password required');
        const result = store.transaction(() => {
          const session = store.login(input.email, input.password, clock());
          store.audit(session.actor, 'auth.login', session.actor.id);
          return session;
        });
        res.setHeader('Set-Cookie', `wc_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        return json(200, {actor: result.actor});
      }
      const webhook = path.match(/^\/api\/v1\/connectors\/([a-z0-9-]+)\/webhook$/);
      if (webhook && req.method === 'POST') {
        const config = webhookKeys[webhook[1]];
        check(config, 'Unknown connector', 404);
        const timestamp = req.headers['x-wc-timestamp'];
        check(/^\d{13}$/.test(timestamp || '') && Math.abs(clock() - Number(timestamp)) <= 300000, 'Stale webhook', 401);
        const {input, raw} = await readBody(req);
        const expected = createHmac('sha256', config.secret).update(`${timestamp}.${raw}`).digest('hex');
        const actual = req.headers['x-wc-signature'] || '';
        check(/^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)), 'Invalid webhook signature', 401);
        const actor = store.principal(config.principalId);
        check(actor?.role === 'admin', 'Connector principal inactive', 403);
        const result = store.transaction(() => {
          const source = service.get(actor, 'sources', config.sourceId);
          check(['webhook', 'mock'].includes(source.type), 'Webhook source type required', 409);
          check(!input.tenant && !input.tenantId && (!input.sourceId || input.sourceId === config.sourceId), 'Connector scope mismatch', 403);
          const replay = fingerprint(`${timestamp}.${raw}`);
          check(!service.list(actor, 'webhookEvents').some(e => e.id === replay), 'Webhook replay', 409);
          const result = service.intake(actor, {...input, sourceId: config.sourceId});
          service.write(actor, 'webhookEvents', {id: replay, at: new Date(clock()).toISOString()}, 'connector.webhook_received');
          return result;
        });
        return json(201, result);
      }
      const actor = store.authenticate(bearer || cookie || '', clock());
      check(actor, 'Authentication required', 401);
      requestActor = actor;
      check(!req.headers['x-tenant-id'] || req.headers['x-tenant-id'] === actor.tenant, 'Tenant scope denied', 403);
      if (req.method !== 'GET' && !bearer) check(allowedOrigins.includes(req.headers.origin), 'Same-origin mutation required', 403);
      if (req.method === 'POST' && path === '/auth/logout') {
        if (cookie) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(fingerprint(cookie));
        res.setHeader('Set-Cookie', 'wc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        store.audit(actor, 'auth.logout', actor.id);
        return json(200, {ok: true});
      }
      if (req.method === 'GET' && path === '/api/v1/state') return json(200, service.snapshot(actor));
      if (req.method === 'GET' && path === '/api/v1/opportunities') return json(200, service.leads(actor));
      if (req.method === 'GET' && path === '/api/v1/catalog/services') return json(200, service.snapshot(actor).catalog);
      if (req.method === 'GET' && path === '/api/v1/reports') return json(200, service.report(actor));
      if (req.method === 'GET' && path === '/api/v1/audit') { service.admin(actor); return json(200, store.events(actor.tenant)); }
      if (req.method === 'POST' && actions.has(path.replace(/^\/api\/v1/, '')) && path.startsWith('/api/v1/')) {
        const {input, raw} = await readBody(req);
        check(!input.tenant && !input.tenantId, 'Tenant is derived from authentication', 403);
        const key = req.headers['idempotency-key'];
        check(typeof key === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(key), 'Idempotency-Key (8–100 characters) required');
        const method = actions.get(path.slice(7));
        // A cached success is never authorization. Evaluate current role before
        // consulting cache, and bind cached results to the current buyer context.
        if (!['match', 'conversion'].includes(method)) service.admin(actor);
        const hash = fingerprint(JSON.stringify([path, raw, actor.role, actor.buyer]));
        const result = store.transaction(() => {
          // Matching is a query: suppression and allocation changes must be visible
          // even if a client reuses its POST key.
          const previous = method !== 'match' && store.db.prepare('SELECT hash,result FROM idempotency WHERE tenant=? AND actor=? AND key=?').get(actor.tenant, actor.id, key);
          if (previous) { check(previous.hash === hash, 'Idempotency key conflict', 409); return JSON.parse(previous.result); }
          const value = service[method](actor, input);
          // Purge must never retain a response containing expired records.
          if (!['purge', 'match'].includes(method)) store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run(actor.tenant, actor.id, key, hash, JSON.stringify(value));
          return value;
        });
        return json(200, result);
      }
      return json(404, {error: 'Not found'});
    } catch (error) {
      // Internal errors never disclose SQL, payloads, credentials or filesystem paths.
      const status = error instanceof Fault ? error.status : 500;
      if (requestActor && [403, 409].includes(status)) {
        try { store.audit(requestActor, 'security.denied', '-', {status}); }
        catch { return json(503, {error: 'Audit service unavailable'}); }
      }
      if (!res.headersSent) return json(status, {error: status === 500 ? 'Internal service error' : error.message});
      res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
export function start() {
  const file = process.env.WORKFORCE_DB || new URL('../../private-data/workforce.sqlite', import.meta.url).pathname;
  const store = new Store(file);
  const server = makeServer({store});
  server.listen(Number(process.env.WORKFORCE_PORT || 8790), '127.0.0.1', () => console.log('Workforce development server listening (loopback only, mock dispatch)'));
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return {server, store};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start();
