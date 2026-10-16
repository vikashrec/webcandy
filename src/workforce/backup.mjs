import {backup, DatabaseSync} from 'node:sqlite';
import {readFile, writeFile, copyFile, mkdir, chmod, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store, verifySchema} from './database.mjs';
import {check, fingerprint} from './domain.mjs';

export function validateSnapshot(file) {
  const db = new DatabaseSync(resolve(file), {readOnly: true});
  try {
    check(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'Backup integrity failed');
    check(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Backup foreign keys invalid');
    verifySchema(db);
    const tenants = db.prepare('SELECT count(*) AS n FROM tenants').get().n;
    check(tenants > 0, 'Empty backup');
    return {tenants, records: db.prepare('SELECT count(*) AS n FROM records').get().n};
  } finally { db.close(); }
}
export async function createBackup(store, destination) {
  const target = resolve(destination);
  check(target !== store.file, 'Backup destination must differ from source');
  await mkdir(dirname(target), {recursive: true, mode: 0o700});
  // Reserve without overwriting existing snapshots.
  await writeFile(target, '', {flag: 'wx', mode: 0o600});
  try {
    await backup(store.db, target);
    await chmod(target, 0o600);
    const result = validateSnapshot(target);
    const sha256 = fingerprint(await readFile(target));
    await writeFile(target + '.sha256', sha256 + '\n', {flag: 'wx', mode: 0o600});
    return {...result, sha256};
  } catch (error) { await unlink(target); throw error; }
}
export async function restoreBackup(source, destination) {
  const expected = (await readFile(source + '.sha256', 'utf8')).trim();
  const data = await readFile(source);
  check(/^[a-f0-9]{64}$/.test(expected) && expected === fingerprint(data), 'Backup checksum mismatch');
  const result = validateSnapshot(source);
  await mkdir(dirname(resolve(destination)), {recursive: true, mode: 0o700});
  // Offline restore only. Never overwrite a live or existing database.
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(destination, 0o600);
  const restored = new Store(destination);
  try {
    // Restored sessions and API keys must not silently restore old access.
    restored.db.exec('DELETE FROM sessions; DELETE FROM api_keys; DELETE FROM idempotency;');
  } finally { restored.close(); }
  return result;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, source, destination] = process.argv.slice(2);
  check(source && destination && ['backup', 'restore'].includes(command), 'Usage: node src/workforce/backup.mjs backup|restore <source.sqlite> <new-target.sqlite>');
  if (command === 'backup') {
    // Source existence must be established; do not create an empty source by typo.
    const probe = new DatabaseSync(resolve(source), {readOnly: true}); probe.close();
    const store = new Store(source);
    try { console.log(JSON.stringify(await createBackup(store, destination))); } finally { store.close(); }
  } else console.log(JSON.stringify(await restoreBackup(source, destination)));
}
