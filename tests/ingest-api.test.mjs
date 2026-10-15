import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIngestServer} from '../scripts/ingest-api.mjs';

test('ingest rejects unauthenticated requests, validates leads and persists duplicates once',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'webcandy-ingest-'));const file=join(dir,'leads.json');
 const server=createIngestServer({token:'test-write-token',file});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/api/ingest';
  const payload={source:'facebook-page',pageId:'1234',leads:[{id:'101',job:'Hiring developer',post:'https://www.facebook.com/example/posts/101',savedAt:'2026-10-15T10:00:00Z'}]};
  const opts={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)};
  assert.equal((await fetch(url,opts)).status,401);
  const headers={...opts.headers,Authorization:'Bearer test-write-token'};
  const first=await fetch(url,{...opts,headers});assert.equal(first.status,200);
  assert.equal((await first.json()).total,1);
  const second=await fetch(url,{...opts,headers});assert.equal((await second.json()).total,1);
  const rows=JSON.parse(await readFile(file,'utf8'));assert.equal(rows.length,1);
  const invalid=await fetch(url,{...opts,headers,body:JSON.stringify({...payload,leads:[{id:'x',job:'test',post:'https://evil.test/'}]})});
  assert.equal(invalid.status,400);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})}
});
