import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store, passwordMatches} from '../../src/workforce/database.mjs';
import {seed} from '../../src/workforce/seed.mjs';
import {createBackup, restoreBackup, validateSnapshot} from '../../src/workforce/backup.mjs';
import {fixture, intake, prepared} from './helpers.mjs';

test('database enforces tenant FKs, unique lead keys, JSON validity and append-only audit', t => {
  const f = fixture(t); const lead = intake(f);
  assert.throws(() => f.store.put('missing', 'leads', lead), /FOREIGN KEY/);
  assert.throws(() => f.store.put('alpha', 'leads', {...lead, id: 'another'}), /UNIQUE/);
  assert.throws(() => f.store.db.prepare('INSERT INTO records VALUES(?,?,?,?)').run('alpha', 'leads', 'bad', '{'), /CHECK/);
  assert.throws(() => f.store.db.exec('DELETE FROM audit'), /Append-only/);
  assert.throws(() => f.store.db.exec("UPDATE audit SET action='fake'"), /Append-only/);
});

test('identical entity IDs in distinct tenants remain isolated on reads, writes and deletion', t => {
  const f = fixture(t);
  f.store.put('alpha', 'test', {id: 'same-id', value: 'alpha'});
  f.store.put('bravo', 'test', {id: 'same-id', value: 'bravo'});
  assert.equal(f.store.get('alpha', 'test', 'same-id').value, 'alpha');
  f.store.put('alpha', 'test', {id: 'same-id', value: 'changed'});
  assert.equal(f.store.get('bravo', 'test', 'same-id').value, 'bravo');
  f.store.remove('alpha', 'test', 'same-id');
  assert.equal(f.store.get('bravo', 'test', 'same-id').value, 'bravo');
});
test('database persists tenant data across connections and rolls back atomic record/audit mutations', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wc-db-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'db.sqlite'); const store = new Store(path); seed(store);
  assert.throws(() => store.transaction(() => { store.put('alpha', 'test', {id: 'rollback'}); throw Error('abort'); }), /abort/);
  store.put('alpha', 'test', {id: 'persist', value: 'alpha-only'}); store.close();
  const next = new Store(path);
  try { assert.equal(next.list('alpha', 'test').length, 1); assert.equal(next.list('bravo', 'test').length, 0); assert.equal((await stat(path)).mode & 0o777, 0o600); }
  finally { next.close(); }
});
test('database passwords and API keys are hashed and credential verification is exact', t => {
  const f = fixture(t); const credential = f.credentials[0];
  const row = f.store.db.prepare('SELECT password FROM principals WHERE email=?').get(credential.email);
  assert.notEqual(row.password, credential.password);
  assert.equal(passwordMatches(credential.password, row.password), true);
  assert.equal(passwordMatches('wrong', row.password), false);
  assert.notEqual(f.store.db.prepare('SELECT hash FROM api_keys LIMIT 1').get().hash, credential.apiToken);
});
test('database two-connection write transactions cannot silently overwrite allocation state', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wc-lock-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'db.sqlite'); const first = new Store(path); seed(first); const second = new Store(path);
  try {
    second.db.exec('PRAGMA busy_timeout=1'); first.db.exec('BEGIN IMMEDIATE');
    first.put('alpha', 'test', {id: 'held'});
    assert.throws(() => second.transaction(() => second.put('alpha', 'test', {id: 'other'})), /locked/);
    first.db.exec('COMMIT');
    second.transaction(() => second.put('alpha', 'test', {id: 'other'}));
    assert.equal(first.list('alpha', 'test').length, 2);
  } finally { first.close(); second.close(); }
});
test('online backup and offline restore preserve both tenants; sessions, API keys and caches are invalidated', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wc-restore-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const f = fixture(t, join(dir, 'source.sqlite')); const x = prepared(f); intake(f, f.b.admin);
  f.store.login(f.credentials[0].email, f.credentials[0].password, f.clock());
  const snapshot = join(dir, 'backup.sqlite');
  const result = await createBackup(f.store, snapshot); assert.equal(result.tenants, 2);
  assert.equal(validateSnapshot(snapshot).tenants, 2);
  const restoredFile = join(dir, 'restored.sqlite'); await restoreBackup(snapshot, restoredFile);
  const restored = new Store(restoredFile);
  try {
    assert.equal(restored.get('alpha', 'leads', x.lead.id).title, x.lead.title);
    assert.equal(restored.list('bravo', 'leads').length, 1);
    assert.ok(restored.events('alpha').length > 0);
    assert.equal(restored.db.prepare('SELECT count(*) n FROM sessions').get().n, 0);
    assert.equal(restored.db.prepare('SELECT count(*) n FROM api_keys').get().n, 0);
    assert.ok(restored.login(f.credentials[0].email, f.credentials[0].password, f.clock()));
  } finally { restored.close(); }
  await assert.rejects(() => restoreBackup(snapshot, restoredFile), /EEXIST/);
  await assert.rejects(() => createBackup(f.store, snapshot), /EEXIST/);
});
test('restore rejects corrupted or tampered backup checksums without creating a destination', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wc-tamper-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const f = fixture(t); const snapshot = join(dir, 'backup.sqlite'); await createBackup(f.store, snapshot);
  const bytes = await readFile(snapshot); bytes[100] ^= 1; await writeFile(snapshot, bytes);
  await assert.rejects(() => restoreBackup(snapshot, join(dir, 'bad.sqlite')), /checksum/);
  await assert.rejects(() => stat(join(dir, 'bad.sqlite')), /ENOENT/);
});
test('retention purge removes cached lead responses for all principals in the tenant', t => {
  const f = fixture(t); const lead = intake(f);
  f.store.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?,?)').run('alpha', f.a.admin.id, 'cache-key', 'hash', JSON.stringify(lead));
  f.now.value += 31 * 86400000;
  f.store.transaction(() => f.service.purge(f.a.admin));
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM idempotency').get().n, 0);
});
