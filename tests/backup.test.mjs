import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
test('backup script saves and verifies private JSON records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'webcandy-backup-'));
 try{
  const source=join(dir,'leads.json'),backups=join(dir,'backups');
  await writeFile(source,JSON.stringify([{id:'sample-1',job:'Demo'}]));
  const env={...process.env,PRIVATE_LEADS_FILE:source,PRIVATE_BACKUP_DIR:backups};
  const output=execFileSync(process.execPath,['scripts/backup.mjs'],{env,encoding:'utf8'});
  assert.match(output,/Backup completed/);
  const entries=await readdir(backups);assert.equal(entries.length,1);
  const verified=execFileSync(process.execPath,['scripts/verify-backup.mjs',join(backups,entries[0])],{encoding:'utf8'});
  assert.match(verified,/Backup verified: 1 records/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
