import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

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
  let previous = [];
  try {
    previous = JSON.parse(await readFile(target, 'utf8'));
    if (!Array.isArray(previous)) throw new Error('Stored leads must be a JSON array');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const merged = mergeLeads(previous, incoming);
  await mkdir(dirname(target), {recursive: true, mode: 0o700});
  const temp = target + '.tmp';
  await writeFile(temp, JSON.stringify(merged, null, 2) + '\n', {mode: 0o600, flag: 'w'});
  await rename(temp, target);
  return merged.length;
}
