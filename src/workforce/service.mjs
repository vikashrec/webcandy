import {randomUUID} from 'node:crypto';
import {check, text, oneOf, httpsUrl, future, geography, target, matches, tags, fingerprint, currency} from './domain.mjs';
import {MockOfficialConnector} from './connectors.mjs';
import {SafeDevelopmentAI} from './ai.mjs';
import {WorkspaceWorkflows} from './workspace.mjs';

export class Workforce extends WorkspaceWorkflows {
  constructor(store, {clock = Date.now, ai} = {}) { super(); this.store = store; this.clock = clock; this.ai = new SafeDevelopmentAI(ai); }
  admin(actor) { check(actor.role === 'admin', 'Admin role required', 403); }
  get(actor, kind, id) { return this.store.get(actor.tenant, kind, text(id, 'id', 100)); }
  list(actor, kind) { return this.store.list(actor.tenant, kind); }
  activeBuyer(actor, id) {
    const buyer = this.get(actor, 'buyers', id);
    check(buyer.active === true, 'Buyer is inactive', 409);
    return buyer;
  }
  write(actor, kind, item, action) {
    this.store.put(actor.tenant, kind, item);
    this.store.audit(actor, action, item.id);
    return item;
  }
  createSource(actor, input) {
    this.admin(actor);
    return this.write(actor, 'sources', {id: randomUUID(), name: text(input.name, 'name'),
      type: oneOf(input.type, ['manual', 'official_api', 'webhook', 'permitted_feed', 'mock'], 'source type'),
      evidence: httpsUrl(input.evidence), permissionExpiresAt: future(input.permissionExpiresAt, this.clock()),
      verifiedBy: actor.id, verifiedAt: new Date(this.clock()).toISOString(),
      scope: 'synthetic-development', externalEnabled: false}, 'source.verified');
  }
  collectMock(actor, input) {
    this.admin(actor);
    const source = this.get(actor, 'sources', input.sourceId);
    const records = new MockOfficialConnector().collect({source, syntheticRecords: input.records});
    const results = records.map(record => this.intake(actor, record));
    this.store.audit(actor, 'connector.mock_collected', source.id, {count: results.length});
    return {provider: 'mock', externalRequests: 0, results};
  }
  intake(actor, input) {
    this.admin(actor);
    const source = this.get(actor, 'sources', input.sourceId);
    check(Date.parse(source.permissionExpiresAt) > this.clock(), 'Source permission expired', 409);
    check(input.synthetic === true, 'Only synthetic development intake is enabled', 403);
    check(!input.email && !input.phone && !input.contacts, 'Contact harvesting is not supported', 400);
    const sourceUrl = httpsUrl(input.sourceUrl);
    const externalId = text(input.externalId, 'externalId');
    const key = fingerprint(sourceUrl);
    const sourceKey = fingerprint(source.id + '\n' + externalId);
    check(!this.list(actor, 'suppressions').some(s => s.key === key || s.sourceKey === sourceKey), 'Source is suppressed', 409);
    const duplicate = this.list(actor, 'leads').find(l => l.sourceUrl === sourceUrl || (l.sourceId === source.id && l.externalId === externalId));
    if (duplicate) return {created: false, lead: duplicate};
    const capturedAt = new Date(this.clock()).toISOString();
    const occurredAt = input.occurredAt || capturedAt;
    check(Number.isFinite(Date.parse(occurredAt)) && Date.parse(occurredAt) <= this.clock(), 'Valid past source timestamp required');
    const retentionDays = input.retentionDays ?? 30;
    check(Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 90, 'Retention must be 1–90 days');
    const budget = input.budget ?? 0;
    check(Number.isFinite(budget) && budget >= 0 && budget <= 1e9, 'Invalid budget');
    check(typeof input.remote === 'boolean' && typeof input.onsite === 'boolean' && (input.remote || input.onsite), 'Specify remote/on-site eligibility');
    const lead = {id: randomUUID(), sourceId: source.id, sourceUrl, externalId,
      title: text(input.title, 'title', 1200), tags: tags(input.tags), budget,
      location: geography(input.location), serviceLocation: geography(input.serviceLocation ?? input.location),
      remote: input.remote, onsite: input.onsite, capturedAt, occurredAt: new Date(occurredAt).toISOString(),
      expiresAt: new Date(this.clock() + retentionDays * 86400_000).toISOString(),
      synthetic: true, stage: 'discovered', suppressed: false,
      ownership: oneOf(input.ownership ?? 'tenant-owned', ['tenant-owned', 'client-owned'], 'ownership'),
      distribution: 'internal-only', resaleAllowed: false};
    this.write(actor, 'leads', lead, 'lead.intake');
    return {created: true, lead};
  }
  eligible(actor, id) {
    const lead = this.get(actor, 'leads', id);
    check(!lead.suppressed && Date.parse(lead.expiresAt) > this.clock(), 'Lead suppressed or expired', 409);
    const source = this.get(actor, 'sources', lead.sourceId);
    check(Date.parse(source.permissionExpiresAt) > this.clock(), 'Source permission expired', 409);
    return lead;
  }
  qualify(actor, input) {
    this.admin(actor);
    const lead = this.eligible(actor, input.leadId);
    const qualification = {...this.ai.qualify(lead), at: new Date(this.clock()).toISOString()};
    if (qualification.fallback) this.store.audit(actor, 'ai.fallback', lead.id, {operation: 'qualify'});
    return this.write(actor, 'leads', {...lead, qualification, stage: 'qualified'}, 'lead.qualified');
  }
  consent(actor, input) {
    this.admin(actor);
    const lead = this.get(actor, 'leads', input.leadId);
    const status = oneOf(input.status, ['granted', 'withdrawn', 'denied'], 'consent status');
    // Revocation is allowed even when acquisition permission/retention expired
    // or the lead has already been suppressed. A new grant still fails closed.
    if (status === 'granted') this.eligible(actor, lead.id);
    const channel = oneOf(input.channel, ['email', 'whatsapp'], 'channel');
    const purpose = oneOf(input.purpose, ['requested_offer', 'marketing'], 'purpose');
    const entry = {id: randomUUID(), leadId: lead.id, status, channel, purpose,
      evidence: httpsUrl(input.evidence), verifiedBy: actor.id, at: new Date(this.clock()).toISOString(),
      expiresAt: status === 'granted' ? future(input.expiresAt, this.clock()) : null};
    return this.write(actor, 'consents', entry, 'consent.' + status);
  }
  canContact(actor, leadId, channel, purpose) {
    this.eligible(actor, leadId);
    const entry = this.list(actor, 'consents').filter(c => c.leadId === leadId && c.channel === channel && c.purpose === purpose).at(-1);
    check(entry?.status === 'granted' && Date.parse(entry.expiresAt) > this.clock(), 'Current verified consent required', 409);
  }
  suppress(actor, input) {
    this.admin(actor);
    const lead = this.get(actor, 'leads', input.leadId);
    text(input.reason, 'reason', 300);
    // Keep only an irreversible URL fingerprint in the durable re-intake tombstone.
    this.write(actor, 'suppressions', {id: randomUUID(), key: fingerprint(lead.sourceUrl),
      sourceKey: fingerprint(lead.sourceId + '\n' + lead.externalId), at: new Date(this.clock()).toISOString()}, 'lead.suppressed');
    return this.write(actor, 'leads', {...lead, suppressed: true}, 'lead.suppression_applied');
  }
  createBuyer(actor, input) {
    this.admin(actor);
    return this.write(actor, 'buyers', {id: randomUUID(), name: text(input.name, 'name'), tags: tags(input.tags), target: target(input.target), active: true}, 'buyer.created');
  }
  match(actor, input) {
    const buyerId = actor.role === 'buyer' ? actor.buyer : input.buyerId;
    if (actor.role === 'buyer') check(!input.buyerId || input.buyerId === actor.buyer, 'Buyer scope denied', 403);
    const buyer = this.activeBuyer(actor, buyerId);
    const allowed = new Set(this.visibleAllocations(actor).filter(a => a.buyerId === buyerId).map(a => a.leadId));
    return this.list(actor, 'leads').filter(lead => {
      if (actor.role === 'buyer' && !allowed.has(lead.id)) return false;
      try { this.eligible(actor, lead.id); } catch { return false; }
      return lead.qualification && matches(lead, buyer.target) && lead.tags.some(t => buyer.tags.includes(t));
    }).map(lead => this.publicLead(lead));
  }
  publicLead(lead) {
    return {id: lead.id, title: lead.title, location: lead.location, serviceLocation: lead.serviceLocation,
      remote: lead.remote, onsite: lead.onsite, tags: lead.tags, stage: lead.stage, qualification: lead.qualification};
  }
  leads(actor) {
    if (actor.role === 'admin') return this.list(actor, 'leads');
    this.activeBuyer(actor, actor.buyer);
    const allocated = new Set(this.visibleAllocations(actor).map(a => a.leadId));
    return this.list(actor, 'leads').filter(l => {
      if (!allocated.has(l.id)) return false;
      try { this.eligible(actor, l.id); return true; } catch { return false; }
    }).map(l => this.publicLead(l));
  }
  createService(actor, input) {
    this.admin(actor);
    check(Number.isFinite(input.price) && input.price >= 0 && input.price <= 1e9, 'Valid catalog price required');
    currency(input.currency);
    return this.write(actor, 'catalog', {id: randomUUID(), name: text(input.name, 'name'), tags: tags(input.tags),
      price: input.price, currency: input.currency, evidence: httpsUrl(input.evidence), verifiedBy: actor.id,
      verifiedAt: new Date(this.clock()).toISOString(), validUntil: future(input.validUntil, this.clock()),
      synthetic: true, target: target(input.target)}, 'catalog.verified');
  }
  offer(actor, input) {
    this.admin(actor);
    const lead = this.eligible(actor, input.leadId);
    const service = this.get(actor, 'catalog', input.serviceId);
    check(Date.parse(service.validUntil) > this.clock(), 'Catalog verification expired', 409);
    check(lead.tags.some(t => service.tags.includes(t)) && matches(lead, service.target), 'Service does not match', 409);
    check(lead.qualification, 'Qualification required', 409);
    const draft = this.ai.draft(lead, service);
    if (draft.fallback) this.store.audit(actor, 'ai.fallback', lead.id, {operation: 'draft'});
    return this.write(actor, 'offers', {id: randomUUID(), leadId: lead.id, serviceId: service.id,
      ...draft, status: 'draft_pending_approval', version: 1,
      createdBy: actor.id, at: new Date(this.clock()).toISOString()}, 'offer.drafted');
  }
  allocate(actor, input) {
    this.admin(actor);
    const lead = this.eligible(actor, input.leadId);
    const buyer = this.activeBuyer(actor, input.buyerId);
    const teamId = input.teamId ? this.team(actor, input.teamId, buyer.id).id : null;
    check(input.resale !== true, 'Resale is disabled; owner approval and verified rights required', 403);
    check(lead.ownership === 'tenant-owned', 'Client-owned lead distribution is blocked', 409);
    check(this.match(actor, {buyerId: buyer.id}).some(l => l.id === lead.id), 'Lead does not match buyer', 409);
    const mode = oneOf(input.mode, ['exclusive', 'shared'], 'allocation mode');
    if (mode === 'shared') check(input.sharedRightsEvidence, 'Explicit shared distribution rights required', 409);
    const evidence = httpsUrl(input.evidence);
    const sharedRightsEvidence = mode === 'shared' ? httpsUrl(input.sharedRightsEvidence) : null;
    const existing = this.list(actor, 'allocations').filter(a => a.leadId === lead.id);
    check(!existing.some(a => a.buyerId === buyer.id), 'Already allocated', 409);
    check(!existing.length || (mode === 'shared' && existing.every(a => a.mode === 'shared')), 'Exclusive ownership conflict', 409);
    return this.write(actor, 'allocations', {id: randomUUID(), leadId: lead.id, buyerId: buyer.id, teamId, mode, evidence,
      sharedRightsEvidence, resale: false, allocatedBy: actor.id, at: new Date(this.clock()).toISOString()}, 'lead.allocated');
  }
  campaign(actor, input) {
    this.admin(actor);
    check(Array.isArray(input.offerIds) && input.offerIds.length > 0 && input.offerIds.length <= 100, '1–100 offers required');
    const channel = oneOf(input.channel, ['email', 'whatsapp'], 'channel');
    const purpose = oneOf(input.purpose, ['requested_offer', 'marketing'], 'purpose');
    const campaign = {id: randomUUID(), name: text(input.name, 'name'), offerIds: [...new Set(input.offerIds)], channel, purpose,
      mode: 'mock', status: 'draft', createdBy: actor.id, createdAt: new Date(this.clock()).toISOString()};
    this.campaignEligibility(actor, campaign);
    return this.write(actor, 'campaigns', campaign, 'campaign.drafted');
  }
  campaignEligibility(actor, campaign) {
    const recipients = new Set();
    for (const id of campaign.offerIds) {
      const offer = this.get(actor, 'offers', id);
      const lead = this.eligible(actor, offer.leadId);
      check(!recipients.has(lead.id), 'Duplicate campaign recipient', 409);
      recipients.add(lead.id);
      this.canContact(actor, lead.id, campaign.channel, campaign.purpose);
      const service = this.get(actor, 'catalog', offer.serviceId);
      check(Date.parse(service.validUntil) > this.clock(), 'Catalog verification expired', 409);
      check(this.list(actor, 'allocations').some(a => {
        if (a.leadId !== lead.id || !this.get(actor, 'buyers', a.buyerId).active) return false;
        try { if (a.teamId) this.team(actor, a.teamId, a.buyerId); return true; } catch { return false; }
      }), 'Active buyer allocation required', 409);
    }
  }
  approve(actor, input) {
    this.admin(actor);
    const campaign = this.get(actor, 'campaigns', input.campaignId);
    check(campaign.status === 'draft', 'Draft campaign required', 409);
    check(campaign.createdBy !== actor.id, 'A different admin must approve', 403);
    check(input.acknowledgeMock === true, 'Explicit mock-only approval required');
    this.campaignEligibility(actor, campaign);
    return this.write(actor, 'campaigns', {...campaign, status: 'approved', approvedBy: actor.id,
      approvedAt: new Date(this.clock()).toISOString()}, 'campaign.approved');
  }
  schedule(actor, input) {
    this.admin(actor);
    const campaign = this.get(actor, 'campaigns', input.campaignId);
    check(campaign.status === 'approved', 'Approved campaign required', 409);
    this.campaignEligibility(actor, campaign);
    const scheduledAt = future(input.scheduledAt, this.clock());
    this.queueJob(actor, 'campaign', campaign.id, Date.parse(scheduledAt));
    return this.write(actor, 'campaigns', {...campaign, status: 'scheduled', scheduledAt}, 'campaign.scheduled');
  }
  dispatch(actor, input) {
    this.admin(actor);
    check(input.mode === 'mock', 'Live dispatch is disabled; owner approval and connector verification required', 403);
    const campaign = this.get(actor, 'campaigns', input.campaignId);
    check(campaign.status === 'scheduled' && Date.parse(campaign.scheduledAt) <= this.clock(), 'Scheduled campaign is not due', 409);
    this.campaignEligibility(actor, campaign);
    const receipt = {id: randomUUID(), campaignId: campaign.id, channel: campaign.channel, purpose: campaign.purpose,
      simulated: true, provider: 'mock', at: new Date(this.clock()).toISOString(), count: campaign.offerIds.length};
    this.write(actor, 'receipts', receipt, 'dispatch.simulated');
    this.write(actor, 'campaigns', {...campaign, status: 'simulated_complete'}, 'campaign.simulated_complete');
    this.store.db.prepare("UPDATE jobs SET status='succeeded',result=? WHERE tenant=? AND kind='campaign' AND object_id=? AND status='queued'").run(JSON.stringify({provider:'mock',receiptId:receipt.id,count:receipt.count}), actor.tenant, campaign.id);
    return receipt;
  }
  cancel(actor, input) {
    this.admin(actor);
    const campaign = this.get(actor, 'campaigns', input.campaignId);
    check(['draft', 'approved', 'scheduled'].includes(campaign.status), 'Campaign cannot be cancelled', 409);
    this.store.db.prepare("UPDATE jobs SET status='cancelled' WHERE tenant=? AND kind='campaign' AND object_id=? AND status='queued'").run(actor.tenant, campaign.id);
    return this.write(actor, 'campaigns', {...campaign, status: 'cancelled'}, 'campaign.cancelled');
  }
  conversion(actor, input) {
    const allocation = this.get(actor, 'allocations', input.allocationId);
    check(actor.role === 'admin' || allocation.buyerId === actor.buyer, 'Buyer scope denied', 403);
    this.scopedAllocation(actor, allocation.id);
    this.activeBuyer(actor, allocation.buyerId);
    this.eligible(actor, allocation.leadId);
    check(Number.isFinite(input.value) && input.value >= 0 && input.value <= 1e9, 'Invalid conversion value');
    currency(input.currency);
    const eventId = text(input.eventId, 'eventId');
    check(!this.list(actor, 'conversions').some(c => c.eventId === eventId), 'Duplicate conversion event', 409);
    const campaignId = input.campaignId || null;
    if (campaignId) {
      const campaign = this.get(actor, 'campaigns', campaignId);
      check(campaign.status === 'simulated_complete' && campaign.offerIds.some(id => this.get(actor, 'offers', id).leadId === allocation.leadId), 'Conversion attribution does not match completed campaign', 409);
    }
    return this.write(actor, 'conversions', {id: randomUUID(), eventId, allocationId: allocation.id, buyerId: allocation.buyerId,
      leadId: allocation.leadId, campaignId, type: oneOf(input.type, ['consultation', 'won', 'lost'], 'conversion type'),
      value: input.value, currency: input.currency, synthetic: true, at: new Date(this.clock()).toISOString()}, 'conversion.recorded');
  }
  report(actor) {
    const allocations = new Set(this.visibleAllocations(actor).map(a => a.id));
    const conversions = this.list(actor, 'conversions').filter(c => allocations.has(c.allocationId));
    const totals = {};
    for (const c of conversions.filter(c => c.type === 'won')) totals[c.currency] = (totals[c.currency] || 0) + c.value;
    return {synthetic: true, leads: this.leads(actor).length, conversions: conversions.length,
      wins: conversions.filter(c => c.type === 'won').length, valuesByCurrency: totals,
      deliveries: this.deliveries(actor).length, followupsOpen: this.followups(actor).filter(f => f.status === 'open').length,
      campaignsSimulated: actor.role === 'admin' ? this.list(actor, 'campaigns').filter(c => c.status === 'simulated_complete').length : undefined};
  }
  purge(actor) {
    this.admin(actor);
    const expired = this.list(actor, 'leads').filter(l => Date.parse(l.expiresAt) <= this.clock());
    for (const lead of expired) {
      // Upgrade a pre-QA URL-only tombstone while the source identity still
      // exists. Already-purged legacy identities cannot be reconstructed.
      if (lead.suppressed) {
        const tombstone = this.list(actor, 'suppressions').find(s => s.key === fingerprint(lead.sourceUrl));
        if (tombstone && !tombstone.sourceKey) this.write(actor, 'suppressions', {...tombstone,
          sourceKey: fingerprint(lead.sourceId + '\n' + lead.externalId)}, 'suppression.identity_backfilled');
      }
      const offers = this.list(actor, 'offers').filter(o => o.leadId === lead.id).map(o => o.id);
      const campaigns = this.list(actor, 'campaigns').filter(c => c.offerIds.some(id => offers.includes(id))).map(c => c.id);
      for (const kind of ['consents', 'allocations', 'conversions', 'offers', 'deliveries', 'followups']) {
        for (const record of this.list(actor, kind).filter(r => r.leadId === lead.id)) this.store.remove(actor.tenant, kind, record.id);
      }
      for (const id of campaigns) this.store.remove(actor.tenant, 'campaigns', id);
      for (const id of campaigns) this.store.db.prepare("DELETE FROM jobs WHERE tenant=? AND kind='campaign' AND object_id=?").run(actor.tenant, id);
      for (const receipt of this.list(actor, 'receipts').filter(r => campaigns.includes(r.campaignId))) this.store.remove(actor.tenant, 'receipts', receipt.id);
      for (const event of this.list(actor, 'conversions').filter(r => campaigns.includes(r.campaignId))) this.store.remove(actor.tenant, 'conversions', event.id);
      this.store.remove(actor.tenant, 'leads', lead.id);
      this.store.audit(actor, 'retention.purged', lead.id);
    }
    // Cached mutation responses may contain lead data. Purge all tenant caches, even for other actors.
    this.store.db.prepare('DELETE FROM idempotency WHERE tenant=?').run(actor.tenant);
    return {purged: expired.length};
  }
  snapshot(actor) {
    const allocations = this.visibleAllocations(actor);
    const allocationIds = new Set(allocations.map(a => a.id));
    const deliveries = this.deliveries(actor);
    const deliveredOfferIds = new Set(deliveries.flatMap(d => d.offerIds));
    return {actor, leads: this.leads(actor), buyers: this.list(actor, 'buyers').filter(b => actor.role === 'admin' || b.id === actor.buyer),
      catalog: this.list(actor, 'catalog').map(({evidence, verifiedBy, ...s}) => s),
      sources: actor.role === 'admin' ? this.list(actor, 'sources') : [],
      offers: actor.role === 'admin' ? this.list(actor, 'offers') : this.list(actor, 'offers').filter(o => deliveredOfferIds.has(o.id))
        .map(({id,leadId,subject,body,price,currency,status,provider}) => ({id,leadId,subject,body,price,currency,status,provider})),
      campaigns: actor.role === 'admin' ? this.list(actor, 'campaigns') : [],
      allocations: allocations.map(({evidence, sharedRightsEvidence, ...a}) => a), deliveries, followups: this.followups(actor),
      organization: this.organization(actor), teams: this.teams(actor), users: this.users(actor),
      connectors: actor.role === 'admin' ? this.list(actor, 'connectors').map(({records,...c}) => ({...c,recordCount:records.length})) : [],
      jobs: actor.role === 'admin' ? this.store.db.prepare('SELECT id,kind,object_id AS objectId,due,status,attempts,result FROM jobs WHERE tenant=? ORDER BY due').all(actor.tenant)
        .map(j => ({...j,dueAt:new Date(j.due).toISOString(),result:j.result?JSON.parse(j.result):null})) : [],
      conversions: this.list(actor, 'conversions').filter(c => allocationIds.has(c.allocationId)), audit: actor.role === 'admin' ? this.store.events(actor.tenant) : [], report: this.report(actor)};
  }
}
