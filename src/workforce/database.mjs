import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {check, fingerprint} from './domain.mjs';

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, hash) {
  const [salt, expected] = hash.split(':');
  const actual = Buffer.from(passwordHash(password, salt).split(':')[1], 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
export class Store {
  constructor(file = ':memory:') {
    this.file = file === ':memory:' ? file : resolve(file);
    if (file !== ':memory:') mkdirSync(dirname(this.file), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(this.file);
    if (file !== ':memory:') chmodSync(this.file, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY CHECK(version=1));
      INSERT OR IGNORE INTO schema_version VALUES(1);
      CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS principals(
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','buyer')), buyer TEXT, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS api_keys(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id));
      CREATE TABLE IF NOT EXISTS records(
        tenant TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
        PRIMARY KEY(tenant,kind,id));
      CREATE UNIQUE INDEX IF NOT EXISTS lead_source_key ON records(tenant,json_extract(data,'$.sourceId'),json_extract(data,'$.externalId')) WHERE kind='leads';
      CREATE UNIQUE INDEX IF NOT EXISTS lead_url_key ON records(tenant,json_extract(data,'$.sourceUrl')) WHERE kind='leads';
      CREATE TABLE IF NOT EXISTS audit(
        seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL REFERENCES tenants(id), actor TEXT NOT NULL,
        action TEXT NOT NULL, object_id TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL CHECK(json_valid(detail)));
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
      CREATE TABLE IF NOT EXISTS idempotency(
        tenant TEXT NOT NULL, actor TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(tenant,actor,key));`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(tenant, kind) { return this.db.prepare('SELECT data FROM records WHERE tenant=? AND kind=? ORDER BY rowid').all(tenant, kind).map(r => JSON.parse(r.data)); }
  get(tenant, kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE tenant=? AND kind=? AND id=?').get(tenant, kind, id);
    check(row, 'Not found', 404); return JSON.parse(row.data);
  }
  put(tenant, kind, data) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(tenant,kind,id) DO UPDATE SET data=excluded.data').run(tenant, kind, data.id, JSON.stringify(data));
    return data;
  }
  remove(tenant, kind, id) { this.db.prepare('DELETE FROM records WHERE tenant=? AND kind=? AND id=?').run(tenant, kind, id); }
  audit(actor, action, id, detail = {}) {
    this.db.prepare('INSERT INTO audit(tenant,actor,action,object_id,at,detail) VALUES(?,?,?,?,?,?)').run(actor.tenant, actor.id, action, id, new Date().toISOString(), JSON.stringify(detail));
  }
  events(tenant) { return this.db.prepare('SELECT seq,actor,action,object_id AS objectId,at,detail FROM audit WHERE tenant=? ORDER BY seq').all(tenant).map(r => ({...r, detail: JSON.parse(r.detail)})); }
  principal(id) { return this.db.prepare('SELECT id,tenant,role,buyer,email FROM principals WHERE id=? AND active=1').get(id); }
  authenticate(token, now) {
    const hash = fingerprint(token);
    const row = this.db.prepare('SELECT principal FROM api_keys WHERE hash=? UNION ALL SELECT principal FROM sessions WHERE hash=? AND expires>? LIMIT 1').get(hash, hash, now);
    return row && this.principal(row.principal);
  }
  login(email, password, now) {
    const row = this.db.prepare('SELECT * FROM principals WHERE email=? AND active=1').get(email);
    // Equal-cost password hashing for unknown users; no email enumeration.
    const dummy = '00000000000000000000000000000000:' + '0'.repeat(128);
    check(passwordMatches(password, row?.password || dummy) && row, 'Invalid credentials', 401);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(fingerprint(token), row.id, now + 8 * 3600_000);
    return {token, actor: this.principal(row.id)};
  }
  addPrincipal({tenant, email, role, buyer = null, password, apiToken}) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO principals(id,tenant,email,password,role,buyer) VALUES(?,?,?,?,?,?)').run(id, tenant, email, passwordHash(password), role, buyer);
    if (apiToken) this.db.prepare('INSERT INTO api_keys VALUES(?,?)').run(fingerprint(apiToken), id);
    return this.principal(id);
  }
  close() { this.db.close(); }
}
