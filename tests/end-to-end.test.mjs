import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIngestServer} from '../scripts/ingest-api.mjs';
import {createLeadServer} from '../scripts/leads-api.mjs';

test('end-to-end: authorized ingest -> deduplicate -> authenticated read', async () => {
 const directory=await mkdtemp(join(tmpdir(),'webcandy-e2e-'));
 const file=join(directory,'leads.json');
 const ingest=createIngestServer({token:'test-write',file});
 const reader=createLeadServer({token:'test-read',file});
 await new Promise(resolve=>ingest.listen(0,'127.0.0.1',resolve));
 await new Promise(resolve=>reader.listen(0,'127.0.0.1',resolve));
 try {
  const ingestUrl='http://127.0.0.1:'+ingest.address().port+'/api/ingest';
  const readUrl='http://127.0.0.1:'+reader.address().port+'/api/leads';
  const payload={source:'facebook-page',pageId:'123456',leads:[{id:'example-1',job:'Hiring website developer',post:'https://www.facebook.com/example/posts/101',email:'jobs@example.com',savedAt:'2026-10-15T10:00:00Z'}]};
  const headers={'Content-Type':'application/json',Authorization:'Bearer test-write'};
  for(let i=0;i<2;i++){
   const response=await fetch(ingestUrl,{method:'POST',headers,body:JSON.stringify(payload)});
   assert.equal(response.status,200);
   assert.equal((await response.json()).total,1);
  }
  assert.equal((await fetch(readUrl)).status,401);
  const response=await fetch(readUrl,{headers:{Authorization:'Bearer test-read'}});
  assert.equal(response.status,200);
  const {leads}=await response.json();
  assert.equal(leads.length,1);
  assert.equal(leads[0].email,'jobs@example.com');
 } finally {
  await Promise.all([new Promise(resolve=>ingest.close(resolve)),new Promise(resolve=>reader.close(resolve))]);
  await rm(directory,{recursive:true,force:true});
 }
});
