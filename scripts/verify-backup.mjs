import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const path=process.argv[2];
if(!path)throw Error('Usage: node scripts/verify-backup.mjs <backup-file>');
const data=JSON.parse(await readFile(resolve(path),'utf8'));
if(!Array.isArray(data))throw Error('Invalid backup: expected array');
for(const record of data)if(!record||typeof record!=='object'||!String(record.id||record.post||'').trim())throw Error('Invalid backup record');
console.log('Backup verified: '+data.length+' records');
