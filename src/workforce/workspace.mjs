import {randomUUID} from 'node:crypto';
import {passwordHash} from './database.mjs';
import {check, text, oneOf, httpsUrl, future} from './domain.mjs';
import {processDue} from './jobs.mjs';

// Tenant/company/team workflows. Every caller is a server-authenticated principal;
// mutations execute inside the HTTP transaction (or the operator's transaction).
export class WorkspaceWorkflows {
  manageBuyer(actor, buyerId) {
    this.activeBuyer(actor, buyerId);
    check(actor.role === 'admin' || (actor.accessRole !== 'buyer_team' && actor.buyer === buyerId), 'Company management scope denied', 403);
  }
  teams(actor) {
    const rows = this.store.db.prepare('SELECT id,buyer_id AS buyerId,name,active FROM teams WHERE tenant=? ORDER BY rowid').all(actor.tenant);
    return rows.filter(t => actor.role === 'admin' || (t.buyerId === actor.buyer && (actor.accessRole !== 'buyer_team' || t.id === actor.teamId))).map(t => ({...t, active: !!t.active}));
  }
  team(actor, id, buyerId) {
    const row = this.store.db.prepare('SELECT id,buyer_id AS buyerId,name,active FROM teams WHERE tenant=? AND id=?').get(actor.tenant, text(id, 'teamId'));
    check(row && row.buyerId === buyerId, 'Not found', 404); check(row.active === 1, 'Team is inactive', 409);
    return row;
  }
  createTeam(actor, input) {
    const buyerId = input.buyerId || actor.buyer; this.manageBuyer(actor, buyerId);
    const id = randomUUID(), name = text(input.name, 'team name');
    this.store.db.prepare('INSERT INTO teams VALUES(?,?,?,?,1)').run(actor.tenant, id, buyerId, name);
    this.store.audit(actor, 'team.created', id);
    return {id, buyerId, name, active: true};
  }
  updateTeam(actor, input) {
    const row = this.store.db.prepare('SELECT buyer_id AS buyerId FROM teams WHERE tenant=? AND id=?').get(actor.tenant, input.teamId);
    check(row, 'Not found', 404); this.manageBuyer(actor, row.buyerId);
    check(typeof input.active === 'boolean', 'active must be boolean');
    this.store.db.prepare('UPDATE teams SET active=? WHERE tenant=? AND id=?').run(Number(input.active), actor.tenant, input.teamId);
    for (const user of this.users(actor).filter(u => u.teamId === input.teamId)) {
      this.store.db.prepare('DELETE FROM sessions WHERE principal=?').run(user.id);
      this.store.db.prepare('DELETE FROM api_keys WHERE principal=?').run(user.id);
      this.store.db.prepare('DELETE FROM idempotency WHERE tenant=? AND actor=?').run(actor.tenant, user.id);
    }
    this.store.audit(actor, 'team.updated', input.teamId); return this.teams(actor).find(t => t.id === input.teamId);
  }
  users(actor) {
    const rows = this.store.db.prepare(`SELECT p.id,p.email,p.role,p.buyer AS buyerId,p.active,
      COALESCE(m.access_role,CASE WHEN p.role='admin' THEN 'admin' ELSE 'buyer_company' END) AS accessRole,m.team_id AS teamId
      FROM principals p LEFT JOIN memberships m ON p.id=m.principal_id AND p.tenant=m.tenant WHERE p.tenant=? ORDER BY p.rowid`).all(actor.tenant);
    return rows.filter(u => actor.role === 'admin' || (actor.accessRole !== 'buyer_team' ? u.buyerId === actor.buyer : u.id === actor.id)).map(u => ({...u, active: !!u.active}));
  }
  membershipInput(actor, input, fallback = {}) {
    const accessRole = oneOf(input.accessRole ?? fallback.accessRole, ['admin', 'buyer_company', 'buyer_team'], 'access role');
    const buyerId = accessRole === 'admin' ? null : (input.buyerId ?? fallback.buyerId ?? actor.buyer);
    const teamId = accessRole === 'buyer_team' ? (input.teamId ?? fallback.teamId) : null;
    if (accessRole === 'admin') this.admin(actor);
    else {
      this.manageBuyer(actor, buyerId);
      if (actor.role !== 'admin') check(accessRole === 'buyer_team', 'Only admins may grant company management', 403);
      if (teamId) this.team(actor, teamId, buyerId);
      check(accessRole !== 'buyer_team' || teamId, 'Team membership required');
    }
    return {accessRole, buyerId, teamId};
  }
  saveMembership(actor, id, membership) {
    this.store.db.prepare(`INSERT INTO memberships VALUES(?,?,?,?,?) ON CONFLICT(tenant,principal_id)
      DO UPDATE SET access_role=excluded.access_role,buyer_id=excluded.buyer_id,team_id=excluded.team_id`).run(actor.tenant, id, membership.accessRole, membership.buyerId, membership.teamId);
  }
  validatePassword(password) {
    check(typeof password === 'string' && password.length >= 14 && password.length <= 200 && password.trim().length >= 14, 'Initial password must contain 14–200 characters');
  }
  createUser(actor, input) {
    const membership = this.membershipInput(actor, input);
    const email = text(input.email, 'email').toLowerCase();
    check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Valid email required');
    this.validatePassword(input.password);
    check(!this.store.db.prepare('SELECT id FROM principals WHERE email=?').get(email), 'Email unavailable', 409);
    const principal = this.store.addPrincipal({tenant: actor.tenant, email, password: input.password,
      role: membership.accessRole === 'admin' ? 'admin' : 'buyer', buyer: membership.buyerId});
    this.saveMembership(actor, principal.id, membership);
    this.store.audit(actor, 'user.created', principal.id);
    return this.users(actor).find(u => u.id === principal.id);
  }
  updateUser(actor, input) {
    const user = this.users(actor).find(u => u.id === input.userId); check(user, 'Not found', 404);
    if (user.accessRole === 'admin') this.admin(actor); else this.manageBuyer(actor, user.buyerId);
    const membership = this.membershipInput(actor, input, user);
    const active = input.active ?? user.active; check(typeof active === 'boolean', 'active must be boolean');
    if (user.id === actor.id) check(active && membership.accessRole === user.accessRole && membership.buyerId === user.buyerId && membership.teamId === user.teamId, 'Cannot revoke or reassign your own account', 409);
    if (user.role === 'admin' && (!active || membership.accessRole !== 'admin'))
      check(this.store.db.prepare("SELECT count(*) n FROM principals WHERE tenant=? AND role='admin' AND active=1").get(actor.tenant).n > 1, 'Cannot revoke the last admin', 409);
    if (input.password !== undefined) this.validatePassword(input.password);
    this.store.db.prepare('UPDATE principals SET role=?,buyer=?,active=? WHERE tenant=? AND id=?').run(membership.accessRole === 'admin' ? 'admin' : 'buyer', membership.buyerId, Number(active), actor.tenant, user.id);
    this.saveMembership(actor, user.id, membership);
    if (input.password !== undefined) this.store.db.prepare('UPDATE principals SET password=? WHERE tenant=? AND id=?').run(passwordHash(input.password), actor.tenant, user.id);
    this.store.db.prepare('DELETE FROM sessions WHERE principal=?').run(user.id);
    this.store.db.prepare('DELETE FROM api_keys WHERE principal=?').run(user.id);
    this.store.db.prepare('DELETE FROM idempotency WHERE tenant=? AND actor=?').run(actor.tenant, user.id);
    this.store.audit(actor, 'user.security_updated', user.id);
    return this.users(actor).find(u => u.id === user.id);
  }
  organization(actor) {
    return this.store.db.prepare('SELECT id,name FROM tenants WHERE id=?').get(actor.tenant);
  }
  updateOrganization(actor, input) {
    this.admin(actor);
    this.store.db.prepare('UPDATE tenants SET name=? WHERE id=?').run(text(input.name, 'organization name'), actor.tenant);
    this.store.audit(actor, 'organization.updated', actor.tenant); return this.organization(actor);
  }
  visibleAllocations(actor) {
    return this.list(actor, 'allocations').filter(a => actor.role === 'admin' ||
      (a.buyerId === actor.buyer && (actor.accessRole !== 'buyer_team' || a.teamId === actor.teamId)));
  }
  scopedAllocation(actor, id) {
    const allocation = this.get(actor, 'allocations', id);
    check(this.visibleAllocations(actor).some(a => a.id === allocation.id), 'Buyer/team scope denied', 403);
    this.activeBuyer(actor, allocation.buyerId); this.eligible(actor, allocation.leadId);
    if (allocation.teamId) this.team(actor, allocation.teamId, allocation.buyerId);
    return allocation;
  }
  assignTeam(actor, input) {
    const allocation = this.get(actor, 'allocations', input.allocationId);
    this.manageBuyer(actor, allocation.buyerId); this.eligible(actor, allocation.leadId);
    const team = this.team(actor, input.teamId, allocation.buyerId);
    check(!this.list(actor, 'deliveries').some(d => d.allocationId === allocation.id && d.status === 'accepted'), 'Accepted delivery cannot be reassigned', 409);
    return this.write(actor, 'allocations', {...allocation, teamId: team.id}, 'allocation.team_assigned');
  }
  deliver(actor, input) {
    this.admin(actor); const allocation = this.scopedAllocation(actor, input.allocationId);
    const previous = this.list(actor, 'deliveries').find(d => d.allocationId === allocation.id);
    check(!previous, 'Allocation already delivered', 409);
    const offerIds = input.offerIds ?? [];
    check(Array.isArray(offerIds) && offerIds.length <= 25, 'At most 25 offers required');
    for (const id of offerIds) {
      const offer = this.get(actor, 'offers', id);
      check(offer.leadId === allocation.leadId, 'Offer does not match allocation', 409);
      check(offer.status === 'approved', 'Independently approved offer required', 409);
      check(Date.parse(this.get(actor, 'catalog', offer.serviceId).validUntil) > this.clock(), 'Catalog verification expired', 409);
    }
    return this.write(actor, 'deliveries', {id: randomUUID(), allocationId: allocation.id, leadId: allocation.leadId,
      buyerId: allocation.buyerId, offerIds: [...new Set(offerIds)], status: 'available', channel: 'portal',
      deliveredBy: actor.id, deliveredAt: new Date(this.clock()).toISOString()}, 'delivery.created');
  }
  deliveries(actor) {
    const ids = new Set(this.visibleAllocations(actor).map(a => a.id));
    return this.list(actor, 'deliveries').filter(d => {
      if (!ids.has(d.allocationId)) return false;
      try { this.scopedAllocation(actor, d.allocationId); return true; } catch { return false; }
    });
  }
  ackDelivery(actor, input) {
    const delivery = this.get(actor, 'deliveries', input.deliveryId);
    this.scopedAllocation(actor, delivery.allocationId);
    check(actor.role === 'buyer', 'Buyer acknowledgement required', 403);
    check(delivery.status === 'available', 'Delivery is not available', 409);
    return this.write(actor, 'deliveries', {...delivery, status: 'accepted', acceptedBy: actor.id,
      acceptedAt: new Date(this.clock()).toISOString()}, 'delivery.accepted');
  }
  approveOffer(actor, input) {
    this.admin(actor); const offer = this.get(actor, 'offers', input.offerId);
    this.eligible(actor, offer.leadId);
    check(offer.createdBy !== actor.id, 'A different admin must approve', 403);
    check(offer.status === 'draft_pending_approval', 'Draft offer required', 409);
    check(Date.parse(this.get(actor, 'catalog', offer.serviceId).validUntil) > this.clock(), 'Catalog verification expired', 409);
    return this.write(actor, 'offers', {...offer, status: 'approved', approvedBy: actor.id,
      approvedAt: new Date(this.clock()).toISOString()}, 'offer.approved');
  }
  createFollowup(actor, input) {
    const allocation = this.scopedAllocation(actor, input.allocationId);
    const assignee = this.store.principal(input.assigneeId || actor.id);
    check(assignee?.tenant === actor.tenant && this.visibleAllocations(assignee).some(a => a.id === allocation.id), 'Assignee scope denied', 403);
    if (actor.accessRole === 'buyer_team') check(assignee.id === actor.id, 'Team members may assign only themselves', 403);
    return this.write(actor, 'followups', {id: randomUUID(), allocationId: allocation.id, leadId: allocation.leadId,
      buyerId: allocation.buyerId, assigneeId: assignee.id, title: text(input.title, 'follow-up title', 300),
      dueAt: future(input.dueAt, this.clock()), status: 'open', createdBy: actor.id}, 'followup.created');
  }
  followups(actor) {
    const ids = new Set(this.visibleAllocations(actor).map(a => a.id));
    return this.list(actor, 'followups').filter(f => ids.has(f.allocationId) && (actor.accessRole !== 'buyer_team' || f.assigneeId === actor.id))
      .filter(f => { try { this.scopedAllocation(actor, f.allocationId); return true; } catch { return false; } })
      .map(f => ({...f, overdue: f.status === 'open' && Date.parse(f.dueAt) <= this.clock()}));
  }
  finishFollowup(actor, input) {
    const item = this.followups(actor).find(f => f.id === input.followupId); check(item, 'Not found', 404);
    check(item.status === 'open', 'Follow-up already closed', 409);
    const {overdue, ...record} = item;
    return this.write(actor, 'followups', {...record, status: oneOf(input.status, ['completed', 'cancelled'], 'follow-up status'),
      closedBy: actor.id, closedAt: new Date(this.clock()).toISOString()}, 'followup.closed');
  }
  renewSource(actor, input) {
    this.admin(actor); const source = this.get(actor, 'sources', input.sourceId);
    return this.write(actor, 'sources', {...source, evidence: httpsUrl(input.evidence), permissionExpiresAt: future(input.permissionExpiresAt, this.clock()),
      verifiedBy: actor.id, verifiedAt: new Date(this.clock()).toISOString()}, 'source.renewed');
  }
  configureConnector(actor, input) {
    this.admin(actor); const source = this.get(actor, 'sources', input.sourceId);
    check(['official_api', 'permitted_feed', 'mock'].includes(source.type), 'Use a collection-capable source', 409);
    check(typeof input.enabled === 'boolean', 'enabled must be boolean');
    const records = input.records ?? [];
    check(Array.isArray(records) && records.length <= 25, 'At most 25 synthetic records required');
    const allowed = ['externalId','sourceUrl','title','tags','budget','location','serviceLocation','remote','onsite','retentionDays','synthetic','ownership','occurredAt'];
    const clean = records.map(row => {
      check(row?.synthetic === true && !row.email && !row.phone && !row.contacts, 'Synthetic non-contact records required');
      const result = Object.fromEntries(allowed.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
      text(result.externalId, 'externalId'); httpsUrl(result.sourceUrl); text(result.title, 'title', 1200);
      return result;
    });
    const previous = this.list(actor, 'connectors').find(c => c.sourceId === source.id);
    return this.write(actor, 'connectors', {id: previous?.id || randomUUID(), sourceId: source.id,
      name: source.name, adapter: 'mock-official', enabled: input.enabled, records: clean, externalEnabled: false}, 'connector.configured');
  }
  runConnector(actor, input) {
    this.admin(actor); const connector = this.get(actor, 'connectors', input.connectorId);
    check(connector.enabled, 'Connector is disabled', 409);
    check(Date.parse(this.get(actor, 'sources', connector.sourceId).permissionExpiresAt) > this.clock(), 'Source permission expired', 409);
    return this.collectMock(actor, {sourceId: connector.sourceId, records: connector.records});
  }
  queueJob(actor, kind, objectId, due) {
    this.admin(actor);
    const previous = this.store.db.prepare('SELECT id,status FROM jobs WHERE tenant=? AND kind=? AND object_id=?').get(actor.tenant, kind, objectId);
    check(!previous || previous.status !== 'queued', 'Job already queued', 409);
    const id = previous?.id || randomUUID();
    this.store.db.prepare(`INSERT INTO jobs(tenant,id,kind,object_id,actor_id,due,status) VALUES(?,?,?,?,?,?,'queued')
      ON CONFLICT(tenant,kind,object_id) DO UPDATE SET actor_id=excluded.actor_id,due=excluded.due,status='queued',attempts=0,result=NULL`).run(actor.tenant, id, kind, objectId, actor.id, due);
    this.store.audit(actor, 'job.queued', id, {kind});
    return {id, kind, objectId, due, status: 'queued'};
  }
  queueConnector(actor, input) {
    this.admin(actor); const connector = this.get(actor, 'connectors', input.connectorId);
    check(connector.enabled, 'Connector is disabled', 409);
    return this.queueJob(actor, 'connector', connector.id, Date.parse(future(input.dueAt, this.clock())));
  }
  queueRetention(actor, input) { return this.queueJob(actor, 'retention', 'retention', Date.parse(future(input.dueAt, this.clock()))); }
  runJobs(actor) { this.admin(actor); return processDue(this, {tenant: actor.tenant}); }
  retryJob(actor, input) {
    this.admin(actor);
    const job = this.store.db.prepare('SELECT * FROM jobs WHERE tenant=? AND id=?').get(actor.tenant, input.jobId);
    check(job, 'Not found', 404); check(job.status === 'failed' && job.attempts < 3, 'Job cannot be retried', 409);
    this.store.db.prepare("UPDATE jobs SET status='queued',actor_id=?,due=?,result=NULL WHERE tenant=? AND id=?").run(actor.id, Date.parse(future(input.dueAt, this.clock())), actor.tenant, job.id);
    this.store.audit(actor, 'job.retry_requested', job.id); return {id: job.id, status: 'queued'};
  }
}
