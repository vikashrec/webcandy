import {check} from './domain.mjs';

// All work is synchronous and mock-only under an IMMEDIATE transaction. A crash
// before COMMIT leaves the job queued and rolls back its domain writes. Another
// process cannot consume the same job concurrently. No live-send retry exists.
export function processDue(service, {tenant, limit = 10} = {}) {
  const store = service.store, now = service.clock();
  const candidates = tenant ? store.db.prepare("SELECT tenant,id FROM jobs WHERE tenant=? AND status='queued' AND due<=? ORDER BY due LIMIT ?").all(tenant, now, limit)
    : store.db.prepare("SELECT tenant,id FROM jobs WHERE status='queued' AND due<=? ORDER BY due LIMIT ?").all(now, limit);
  const outcomes = [];
  for (const candidate of candidates) {
    const outcome = store.transaction(() => {
      const job = store.db.prepare("SELECT * FROM jobs WHERE tenant=? AND id=? AND status='queued'").get(candidate.tenant, candidate.id);
      if (!job) return null;
      try {
        const result = store.transaction(() => {
          const actor = store.principal(job.actor_id);
          check(actor?.role === 'admin' && actor.tenant === job.tenant, 'Scheduled admin is unavailable', 403);
          let result;
          if (job.kind === 'campaign') {
            const receipt = service.dispatch(actor, {campaignId: job.object_id, mode: 'mock'});
            result = {provider: 'mock', receiptId: receipt.id, count: receipt.count};
          } else if (job.kind === 'connector') {
            const collection = service.runConnector(actor, {connectorId: job.object_id});
            result = {provider: 'mock', processed: collection.results.length, created: collection.results.filter(r => r.created).length, externalRequests: 0};
          } else result = service.purge(actor);
          store.audit(actor, 'job.succeeded', job.id, {kind: job.kind});
          return result;
        });
        store.db.prepare("UPDATE jobs SET status='succeeded',attempts=attempts+1,result=? WHERE tenant=? AND id=?").run(JSON.stringify(result), job.tenant, job.id);
        return {id: job.id, status: 'succeeded'};
      } catch (error) {
        store.db.prepare("UPDATE jobs SET status='failed',attempts=attempts+1,result=? WHERE tenant=? AND id=?").run(JSON.stringify({error: 'job_failed', status: error.status || 500}), job.tenant, job.id);
        store.audit({tenant: job.tenant, id: job.actor_id}, 'job.failed', job.id, {kind: job.kind});
        return {id: job.id, status: 'failed'};
      }
    });
    if (outcome) outcomes.push(outcome);
  }
  return {processed: outcomes.length, outcomes, mode: 'mock'};
}
