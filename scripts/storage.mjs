import {readFile, writeFile, mkdir, rename, unlink} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

// Serialize writes to the same file within this process. This legacy JSON adapter
// still is not a multi-process database; the workforce uses transactional SQLite.
const pending = new Map();

export function mergeLeads(existing, incoming) {
  const byId = new Map();
  for (const lead of [...existing, ...incoming]) {
    if (!lead || typeof lead !== 'object') continue;
    const key = String(lead.id || lead.post || '').trim();
    if (!key) continue;
    const previous = byId.get(key);
    byId.set(key, previous ? {...previous, ...lead} : lead);
  }
  return [...byId.values()].sort((a,b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
}

export async function saveLocalLeads(incoming, path = process.env.PRIVATE_LEADS_FILE) {
  if (!path) throw new Error('PRIVATE_LEADS_FILE is required');
  const target = resolve(path);
  if (target.includes('/.git/') || target.endsWith('/data/leads.json')) {
    throw new Error('Use a private ignored file, not the tracked demo data');
  }
  const run = () => writeLeads(incoming, target);
  const next = (pending.get(target) || Promise.resolve()).then(run, run);
  pending.set(target, next);
  try { return await next; }
  finally { if (pending.get(target) === next) pending.delete(target); }
}

async function writeLeads(incoming, target) {
  let previous = [];
  try {
    previous = JSON.parse(await readFile(target, 'utf8'));
    if (!Array.isArray(previous)) throw new Error('Stored leads must be a JSON array');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const merged = mergeLeads(previous, incoming);
  await mkdir(dirname(target), {recursive: true, mode: 0o700});
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(merged, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    await rename(temp, target);
  } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  return merged.length;
}
