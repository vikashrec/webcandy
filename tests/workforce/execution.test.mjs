import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture, prepared, due} from './helpers.mjs';
import {processDue} from '../../src/workforce/jobs.mjs';
import {Store} from '../../src/workforce/database.mjs';
import {createBackup, restoreBackup} from '../../src/workforce/backup.mjs';
import {makeServer} from '../../src/workforce/server.mjs';

function teamMember(f, name = 'one', buyerId = f.a.buyer.id) {
  const team = f.service.createTeam(f.a.admin, {buyerId, name});
  const user = f.service.createUser(f.a.admin, {email: `${name}@alpha.example.test`, password: 'Synthetic-password-2026', accessRole: 'buyer_team', buyerId, teamId: team.id});
  return {team, user, actor: f.store.principal(user.id)};
}

test('company and team memberships enforce database tenant/company foreign keys', t => {
  const f = fixture(t), {team, user} = teamMember(f);
  assert.equal(f.store.principal(user.id).accessRole, 'buyer_team');
  assert.throws(() => f.store.db.prepare('UPDATE memberships SET buyer_id=? WHERE principal_id=?').run(f.a.buyer2.id, user.id), /FOREIGN KEY/);
  assert.throws(() => f.store.db.prepare('UPDATE memberships SET tenant=? WHERE principal_id=?').run('bravo', user.id), /FOREIGN KEY/);
  assert.throws(() => f.service.createUser(f.a.buyerActor, {email:'escape@example.test',password:'Synthetic-password-2026',accessRole:'admin'}), /Admin/);
  assert.throws(() => f.service.createTeam(f.a.otherBuyer, {buyerId: team.buyerId, name: 'Escape'}), /scope/);
  assert.throws(() => f.service.createUser(f.a.buyerActor, {email:'manager@example.test',password:'Synthetic-password-2026',accessRole:'buyer_company'}), /Only admins/);
  assert.equal(JSON.stringify(f.service.users(f.a.admin)).includes('password'), false);
  f.service.updateTeam(f.a.buyerActor,{teamId:team.id,active:false});
  assert.equal(f.store.principal(user.id),undefined);
});

test('portal delivery requires independent offer approval and preserves team isolation', t => {
  const f = fixture(t), x = prepared(f), one = teamMember(f), two = teamMember(f, 'two');
  f.service.assignTeam(f.a.buyerActor, {allocationId:x.allocation.id,teamId:one.team.id});
  assert.equal(f.service.leads(one.actor).length, 1);
  assert.equal(f.service.leads(two.actor).length, 0);
  assert.throws(() => f.service.deliver(f.a.admin,{allocationId:x.allocation.id,offerIds:[x.offer.id]}), /approved/);
  assert.throws(() => f.service.approveOffer(f.a.admin,{offerId:x.offer.id}), /different admin/);
  f.service.approveOffer(f.a.reviewer,{offerId:x.offer.id});
  const delivery = f.service.deliver(f.a.admin,{allocationId:x.allocation.id,offerIds:[x.offer.id]});
  assert.equal(f.service.snapshot(one.actor).offers.length, 1);
  assert.equal(f.service.snapshot(two.actor).offers.length, 0);
  assert.throws(() => f.service.ackDelivery(two.actor,{deliveryId:delivery.id}), /scope/);
  assert.equal(f.service.ackDelivery(one.actor,{deliveryId:delivery.id}).status, 'accepted');
  assert.throws(() => f.service.assignTeam(f.a.admin,{allocationId:x.allocation.id,teamId:two.team.id}), /Accepted/);
  assert.equal(f.service.deliveries(f.b.admin).length, 0);
});

test('follow-ups enforce allocation and assignee scope with overdue and terminal states', t => {
  const f = fixture(t), x = prepared(f), one = teamMember(f), two = teamMember(f, 'two');
  f.service.assignTeam(f.a.admin,{allocationId:x.allocation.id,teamId:one.team.id});
  assert.throws(() => f.service.createFollowup(one.actor,{allocationId:x.allocation.id,assigneeId:two.actor.id,title:'Synthetic task',dueAt:new Date(f.clock()+1000).toISOString()}), /scope/);
  const task = f.service.createFollowup(one.actor,{allocationId:x.allocation.id,title:'Synthetic task',dueAt:new Date(f.clock()+1000).toISOString()});
  f.now.value += 2000;
  assert.equal(f.service.followups(one.actor)[0].overdue,true);
  assert.equal(f.service.followups(two.actor).length,0);
  assert.throws(() => f.service.finishFollowup(two.actor,{followupId:task.id,status:'completed'}), /Not found/);
  assert.equal(f.service.finishFollowup(one.actor,{followupId:task.id,status:'completed'}).status,'completed');
  assert.throws(() => f.service.finishFollowup(one.actor,{followupId:task.id,status:'completed'}), /already closed/);
});

test('durable campaign job executes exactly once and remains tenant scoped', t => {
  const f = fixture(t), x = prepared(f); due(f,x.campaign);
  assert.equal(f.service.runJobs(f.b.admin).processed,0);
  assert.equal(processDue(f.service).outcomes[0].status,'succeeded');
  assert.equal(processDue(f.service).processed,0);
  assert.equal(f.store.list('alpha','receipts').length,1);
  assert.equal(f.store.db.prepare('SELECT attempts FROM jobs').get().attempts,1);
});

test('job rechecks current consent; failed jobs can be retried without duplicate receipts', t => {
  const f = fixture(t), x = prepared(f); due(f,x.campaign);
  f.service.consent(f.a.admin,{leadId:x.lead.id,channel:'email',purpose:'requested_offer',status:'withdrawn',evidence:'https://example.test/withdrawal'});
  assert.equal(processDue(f.service).outcomes[0].status,'failed');
  assert.equal(f.store.list('alpha','receipts').length,0);
  const job=f.store.db.prepare('SELECT * FROM jobs').get();
  assert.deepEqual(JSON.parse(job.result),{error:'job_failed',status:409});
  f.service.consent(f.a.admin,{leadId:x.lead.id,channel:'email',purpose:'requested_offer',status:'granted',evidence:'https://example.test/renewal',expiresAt:new Date(f.clock()+3600000).toISOString()});
  f.service.retryJob(f.a.reviewer,{jobId:job.id,dueAt:new Date(f.clock()+1000).toISOString()});
  f.now.value += 2000;
  assert.equal(processDue(f.service).outcomes[0].status,'succeeded');
  assert.equal(f.store.list('alpha','receipts').length,1);
});

test('connector failure rolls back the full collection and stores no fixture payload in job result', t => {
  const f=fixture(t);
  const source=f.service.createSource(f.a.admin,{name:'Synthetic API',type:'official_api',evidence:'https://example.test/permission',permissionExpiresAt:new Date(f.clock()+3600000).toISOString()});
  const connector=f.service.configureConnector(f.a.admin,{sourceId:source.id,enabled:true,records:[
    {externalId:'valid',sourceUrl:'https://example.test/valid',title:'Synthetic website',synthetic:true,remote:true,onsite:false},
    {externalId:'invalid',sourceUrl:'https://example.test/invalid',title:'Synthetic invalid',synthetic:true,budget:-1}
  ]});
  f.service.queueConnector(f.a.admin,{connectorId:connector.id,dueAt:new Date(f.clock()+1000).toISOString()});
  f.now.value+=2000;
  assert.equal(processDue(f.service).outcomes[0].status,'failed');
  assert.equal(f.store.list('alpha','leads').length,0);
  assert.equal(f.store.db.prepare('SELECT result FROM jobs').get().result.includes('Synthetic'),false);
});

test('deactivating a queued job actor fails closed and removes their access', t => {
  const f=fixture(t),x=prepared(f); due(f,x.campaign);
  f.service.updateUser(f.a.reviewer,{userId:f.a.admin.id,active:false});
  assert.equal(f.store.principal(f.a.admin.id),undefined);
  assert.equal(processDue(f.service).outcomes[0].status,'failed');
  assert.equal(f.store.list('alpha','receipts').length,0);
});

test('backup/restore preserves memberships, deliveries and queued jobs while revoking sessions and keys', async t => {
  const dir=mkdtempSync(join(tmpdir(),'webcandy-execution-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const f=fixture(t,join(dir,'source.sqlite')),x=prepared(f),member=teamMember(f);
  f.service.assignTeam(f.a.admin,{allocationId:x.allocation.id,teamId:member.team.id});
  f.service.deliver(f.a.admin,{allocationId:x.allocation.id});due(f,x.campaign);
  await createBackup(f.store,join(dir,'backup.sqlite'));
  await restoreBackup(join(dir,'backup.sqlite'),join(dir,'restored.sqlite'));
  const restored=new Store(join(dir,'restored.sqlite'));t.after(()=>restored.close());
  assert.equal(restored.principal(member.user.id).teamId,member.team.id);
  assert.equal(restored.list('alpha','deliveries').length,1);
  assert.equal(restored.db.prepare("SELECT status FROM jobs").get().status,'queued');
  assert.equal(restored.db.prepare('SELECT count(*) n FROM api_keys').get().n,0);
  assert.equal(restored.db.prepare('PRAGMA foreign_key_check').all().length,0);
  f.service.createFollowup(member.actor,{allocationId:x.allocation.id,title:'Synthetic purge task',dueAt:new Date(f.clock()+1000).toISOString()});
  f.now.value=Date.parse(x.lead.expiresAt)+1;f.service.purge(f.a.admin);
  for(const kind of ['leads','allocations','deliveries','followups','campaigns']) assert.equal(f.store.list('alpha',kind).length,0,kind);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});

test('HTTP company provisioning, team login, revocation, tenant spoof and HTTPS cookie origin', async t => {
  const f=fixture(t),server=makeServer({store:f.store,clock:f.clock,publicOrigin:'https://webcandy.example.test'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,token=f.credentials.find(c=>c.email==='buyer@alpha.example.test').apiToken;
  async function call(path,body,auth=token){return fetch(origin+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:`Bearer ${auth}`}:{Origin:'https://webcandy.example.test'}),...(body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:{})},body:body?JSON.stringify(body):undefined});}
  const tr=await call('/api/v1/teams',{name:'HTTP team'});assert.equal(tr.status,200);const team=await tr.json();
  const ur=await call('/api/v1/users',{email:'http-team@example.test',password:'Synthetic-password-2026',accessRole:'buyer_team',teamId:team.id});assert.equal(ur.status,200);const user=await ur.json();
  const login=await call('/auth/login',{email:user.email,password:'Synthetic-password-2026'},null);assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');assert.match(cookie,/Secure/);
  const state=await fetch(origin+'/api/v1/state',{headers:{Cookie:cookie.split(';')[0]}});assert.equal((await state.json()).actor.accessRole,'buyer_team');
  assert.equal((await call('/api/v1/teams',{name:'escape',tenant:'bravo'})).status,403);
  assert.equal((await call('/api/v1/users/update',{userId:user.id,active:false})).status,200);
  assert.equal((await fetch(origin+'/api/v1/state',{headers:{Cookie:cookie.split(';')[0]}})).status,401);
});

test('operator initialization creates isolated organization with distinct admins and rolls back duplicate emails', async t=>{
  const {initializeOrganization}=await import('../../src/workforce/initialize.mjs');
  const f=fixture(t),before=f.store.db.prepare('SELECT count(*) n FROM tenants').get().n;
  assert.throws(()=>initializeOrganization(f.store,{name:'Synthetic conflict',adminEmail:'admin@alpha.example.test',reviewerEmail:'new-reviewer@example.test'}));
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM tenants').get().n,before);
  const org=initializeOrganization(f.store,{name:'Synthetic organization',adminEmail:'new-admin@example.test',reviewerEmail:'new-reviewer@example.test'});
  const account=f.store.login(org.credentials[0].email,org.credentials[0].password,f.clock());
  assert.equal(account.actor.tenant,org.id);assert.equal(account.actor.accessRole,'admin');
  assert.equal(f.service.snapshot(account.actor).leads.length,0);
  assert.equal(f.service.users(f.a.admin).some(u=>u.email==='new-admin@example.test'),false);
});
