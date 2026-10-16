import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {check, fingerprint} from './domain.mjs';

export function verifySchema(db, {allowEmpty = false} = {}) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (allowEmpty && tables.length === 0) return;
  check(tables.some(t => t.name === 'schema_version'), 'Unsupported database schema');
  const versions = db.prepare('SELECT version FROM schema_version').all();
  check(versions.length === 1 && versions[0].version === 1, 'Unsupported database schema');
}

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
    try { verifySchema(this.db, {allowEmpty: true}); }
    catch (error) { this.db.close(); throw error; }
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
        PRIMARY KEY(tenant,actor,key));
      CREATE UNIQUE INDEX IF NOT EXISTS principal_tenant_key ON principals(tenant,id);
      CREATE TABLE IF NOT EXISTS buyer_companies(tenant TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL, PRIMARY KEY(tenant,id));
      INSERT OR IGNORE INTO buyer_companies SELECT tenant,id FROM records WHERE kind='buyers';
      CREATE TABLE IF NOT EXISTS teams(
        tenant TEXT NOT NULL, id TEXT NOT NULL, buyer_id TEXT NOT NULL, name TEXT NOT NULL,
        active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(tenant,id), UNIQUE(tenant,buyer_id,id),
        FOREIGN KEY(tenant,buyer_id) REFERENCES buyer_companies(tenant,id));
      CREATE TABLE IF NOT EXISTS memberships(
        tenant TEXT NOT NULL, principal_id TEXT NOT NULL, access_role TEXT NOT NULL,
        buyer_id TEXT, team_id TEXT, PRIMARY KEY(tenant,principal_id),
        FOREIGN KEY(tenant,principal_id) REFERENCES principals(tenant,id),
        FOREIGN KEY(tenant,buyer_id) REFERENCES buyer_companies(tenant,id),
        FOREIGN KEY(tenant,buyer_id,team_id) REFERENCES teams(tenant,buyer_id,id),
        CHECK((access_role='admin' AND buyer_id IS NULL AND team_id IS NULL) OR
          (access_role='buyer_company' AND buyer_id IS NOT NULL AND team_id IS NULL) OR
          (access_role='buyer_team' AND buyer_id IS NOT NULL AND team_id IS NOT NULL)));
      CREATE TABLE IF NOT EXISTS jobs(
        tenant TEXT NOT NULL REFERENCES tenants(id), id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('campaign','connector','retention')),
        object_id TEXT NOT NULL, actor_id TEXT NOT NULL, due INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','succeeded','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0,
        result TEXT CHECK(result IS NULL OR json_valid(result)), PRIMARY KEY(tenant,id), UNIQUE(tenant,kind,object_id),
        FOREIGN KEY(tenant,actor_id) REFERENCES principals(tenant,id));
      CREATE TABLE IF NOT EXISTS worker_state(id TEXT PRIMARY KEY CHECK(id='mock-worker'),last_seen INTEGER NOT NULL);`);
  }
  transaction(fn) {
    const nested = (this.depth || 0) > 0, point = 'wc_' + (this.depth || 0);
    this.db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE'); this.depth = (this.depth || 0) + 1;
    try {
      const result = fn(); check(!result?.then, 'Synchronous transaction required', 500);
      this.db.exec(nested ? `RELEASE SAVEPOINT ${point}` : 'COMMIT'); return result;
    } catch (error) {
      if (nested) this.db.exec(`ROLLBACK TO SAVEPOINT ${point}; RELEASE SAVEPOINT ${point}`); else this.db.exec('ROLLBACK');
      throw error;
    } finally { this.depth--; }
  }
  list(tenant, kind) { return this.db.prepare('SELECT data FROM records WHERE tenant=? AND kind=? ORDER BY rowid').all(tenant, kind).map(r => JSON.parse(r.data)); }
  get(tenant, kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE tenant=? AND kind=? AND id=?').get(tenant, kind, id);
    check(row, 'Not found', 404); return JSON.parse(row.data);
  }
  put(tenant, kind, data) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(tenant,kind,id) DO UPDATE SET data=excluded.data').run(tenant, kind, data.id, JSON.stringify(data));
    if (kind === 'buyers') this.db.prepare('INSERT OR IGNORE INTO buyer_companies VALUES(?,?)').run(tenant, data.id);
    return data;
  }
  remove(tenant, kind, id) { this.db.prepare('DELETE FROM records WHERE tenant=? AND kind=? AND id=?').run(tenant, kind, id); }
  audit(actor, action, id, detail = {}) {
    this.db.prepare('INSERT INTO audit(tenant,actor,action,object_id,at,detail) VALUES(?,?,?,?,?,?)').run(actor.tenant, actor.id, action, id, new Date().toISOString(), JSON.stringify(detail));
  }
  events(tenant) { return this.db.prepare('SELECT seq,actor,action,object_id AS objectId,at,detail FROM audit WHERE tenant=? ORDER BY seq').all(tenant).map(r => ({...r, detail: JSON.parse(r.detail)})); }
  principal(id) {
    const actor = this.db.prepare(`SELECT p.id,p.tenant,p.role,p.buyer,p.email,
      COALESCE(m.access_role,CASE WHEN p.role='admin' THEN 'admin' ELSE 'buyer_company' END) AS accessRole,m.team_id AS teamId
      FROM principals p LEFT JOIN memberships m ON m.tenant=p.tenant AND m.principal_id=p.id WHERE p.id=? AND p.active=1
      AND (p.role='admin' OR EXISTS(SELECT 1 FROM records r WHERE r.tenant=p.tenant AND r.kind='buyers' AND r.id=p.buyer AND json_extract(r.data,'$.active')=1))
      AND (m.principal_id IS NULL OR ((p.role='admin' AND m.access_role='admin') OR (p.role='buyer' AND m.access_role IN ('buyer_company','buyer_team') AND p.buyer=m.buyer_id)))
      AND (m.team_id IS NULL OR EXISTS(SELECT 1 FROM teams t WHERE t.tenant=p.tenant AND t.id=m.team_id AND t.buyer_id=p.buyer AND t.active=1))`).get(id);
    return actor;
  }
  authenticate(token, now) {
    const hash = fingerprint(token);
    const row = this.db.prepare('SELECT principal FROM api_keys WHERE hash=? UNION ALL SELECT principal FROM sessions WHERE hash=? AND expires>? LIMIT 1').get(hash, hash, now);
    return row && this.principal(row.principal);
  }
  login(email, password, now) {
    const row = this.db.prepare('SELECT * FROM principals WHERE email=? AND active=1').get(email);
    // Equal-cost password hashing for unknown users; no email enumeration.
    const dummy = '00000000000000000000000000000000:' + '0'.repeat(128);
    check(passwordMatches(password, row?.password || dummy) && row && this.principal(row.id), 'Invalid credentials', 401);
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
