import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLeadServer} from '../scripts/leads-api.mjs';

test('private lead API rejects unauthenticated requests and returns authorized records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'webcandy-api-'));const file=join(dir,'leads.json');
 await writeFile(file,JSON.stringify([{id:'job-101',job:'Demo'}]));
 const server=createLeadServer({token:'test-read-token',file});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
   const url='http://127.0.0.1:'+server.address().port+'/api/leads';
   const unauth=await fetch(url);assert.equal(unauth.status,401);
   const auth=await fetch(url,{headers:{Authorization:'Bearer test-read-token'}});
   assert.equal(auth.status,200);assert.equal((await auth.json()).leads[0].id,'job-101');
   assert.equal(auth.headers.get('cache-control'),'no-store');
 } finally {await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
