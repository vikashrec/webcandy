import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

test('workforce container: non-root persistent web and worker complete approved synthetic campaign', {timeout:180000}, async t=>{
  const root=resolve(import.meta.dirname,'..'),config=resolve(root,'private-data/docker'),results=resolve(root,'test-results/execution');
  mkdirSync(config,{recursive:true,mode:0o700});mkdirSync(results,{recursive:true});
  const docker=(...args)=>execFileSync('docker',['--config',config,...args],{cwd:root,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
  const suffix=randomBytes(5).toString('hex'),image='webcandy-workforce:'+suffix,volume='webcandy-workforce-'+suffix;
  const web='webcandy-web-'+suffix,worker='webcandy-worker-'+suffix,containers=[];
  let hasImage=false,hasVolume=false;
  t.after(()=>{for(const name of containers)docker('rm','-f',name);if(hasVolume)docker('volume','rm',volume);if(hasImage)docker('image','rm',image);});
  const log=openSync(resolve(results,'workforce-build.txt'),'w');
  try{execFileSync('docker',['--config',config,'build','-f','Dockerfile.workforce','-t',image,'.'],{cwd:root,stdio:['ignore',log,log],timeout:120000});hasImage=true;}finally{closeSync(log);}
  docker('compose','-f','compose.workforce.yaml','config','--quiet');
  docker('volume','create',volume);hasVolume=true;
  docker('run','--rm','-v',volume+':/var/lib/webcandy',image,'node','src/workforce/seed.mjs');
  const flags=['--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges:true','-v',volume+':/var/lib/webcandy'];
  docker('run','-d','--name',web,...flags,'-p','127.0.0.1::8790',image);containers.push(web);
  docker('run','-d','--name',worker,...flags,image,'node','src/workforce/worker.mjs');containers.push(worker);
  let origin='http://127.0.0.1:'+docker('port',web,'8790').split(':').at(-1);
  async function wait(fn){for(let i=0;i<100;i++){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Container readiness timed out');}
  await wait(async()=> (await fetch(origin+'/health/worker')).status===200);
  // Never emit this response: generated credentials remain in the disposable volume.
  const credentials=JSON.parse(docker('exec',web,'cat','/var/lib/webcandy/development-credentials.json'));
  async function call(path,input,role='admin'){
    const token=credentials.find(c=>c.email===`${role}@alpha.example.test`).apiToken;
    const r=await fetch(origin+'/api/v1/'+path,{method:input?'POST':'GET',headers:{Authorization:'Bearer '+token,...(input?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:{})},body:input?JSON.stringify(input):undefined});
    assert.equal(r.status,200,path);return r.json();
  }
  const state=await call('state');
  const lead=(await call('opportunities/intake',{sourceId:state.sources[0].id,externalId:'container',sourceUrl:'https://example.test/container',title:'Synthetic website requirement',tags:['website'],budget:1000,remote:true,onsite:false,synthetic:true})).lead;
  await call('leads/qualify',{leadId:lead.id});
  await call('allocations',{leadId:lead.id,buyerId:state.buyers[0].id,mode:'exclusive',evidence:'https://example.test/rights'});
  await call('consents',{leadId:lead.id,channel:'email',purpose:'requested_offer',status:'granted',evidence:'https://example.test/consent',expiresAt:new Date(Date.now()+3600000).toISOString()});
  const offer=await call('offers/draft',{leadId:lead.id,serviceId:state.catalog[0].id});
  const campaign=await call('campaigns',{name:'Synthetic container campaign',offerIds:[offer.id],channel:'email',purpose:'requested_offer'});
  await call('campaigns/approve',{campaignId:campaign.id,acknowledgeMock:true},'reviewer');
  await call('campaigns/schedule',{campaignId:campaign.id,scheduledAt:new Date(Date.now()+1000).toISOString()});
  await wait(async()=> (await call('state')).jobs[0]?.status==='succeeded');
  assert.equal((await call('state')).report.campaignsSimulated,1);
  docker('restart',web);origin='http://127.0.0.1:'+docker('port',web,'8790').split(':').at(-1);await wait(async()=> (await fetch(origin+'/health')).status===200);
  assert.equal((await call('state')).report.campaignsSimulated,1);
  assert.equal(docker('exec',web,'id','-u'),'1000');
  assert.equal(docker('inspect',web,'--format','{{.HostConfig.ReadonlyRootfs}}'),'true');
  docker('exec',worker,'node','src/workforce/healthcheck.mjs','worker');
  docker('exec',web,'sh','-c','test ! -e /app/.git && test ! -e /app/private-data && test ! -e /app/node_modules');
  assert.equal((await fetch(origin+'/private-data/development-credentials.json')).status,401);
  assert.equal((await fetch(origin+'/private-data/development-credentials.json',{headers:{Authorization:'Bearer '+credentials[0].apiToken}})).status,404);
  writeFileSync(resolve(results,'workforce-container.json'),JSON.stringify({status:'PASS',scope:'synthetic development only',imageId:docker('image','inspect',image,'--format','{{.Id}}'),checks:['compose validates','non-root read-only web','worker health','independently approved scheduled mock campaign','one receipt after web restart','persistent shared volume','private files excluded'],externalRequests:0},null,2)+'\n');
});
