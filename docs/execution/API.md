# API additions: organizations, company/team workflows and mock jobs

The [existing API/connector contract](../mission/API.md) remains applicable.
All paths below start `/api/v1`. Mutations require JSON and an Idempotency-Key
(8–200 characters under existing validation). Authentication determines the tenant;
caller-supplied tenant selectors are rejected. Session mutations require the exact
same Origin; development bearer credentials are separate from browser cookies.
All records/IDs are synthetic development data. No route activates an external API.

| Method/path | Scope | Input / behavior |
| --- | --- | --- |
| GET `/organization` | Signed-in user | Current organization id/name |
| POST `/organization` | Admin | `{name}`; rename own organization |
| GET `/users`, `/teams` | Scoped | Tenant admin, own company manager, or team/self projection |
| POST `/teams` | Admin/company | `{buyerId?,name}`; company defaults to self |
| POST `/teams/update` | Admin/company | `{teamId,active:boolean}`; revokes team credentials/caches |
| POST `/users` | Admin/company | `{email,password,accessRole,buyerId?,teamId?}`; roles `admin`, `buyer_company`, `buyer_team`; company grants team only |
| POST `/users/update` | Admin/company | `{userId,active?,password?,accessRole?,buyerId?,teamId?}`; company manages team users only; no self-revocation or last-admin removal |
| POST `/allocations/assign-team` | Admin/company | `{allocationId,teamId}`; same buyer, active team, unaccepted delivery |
| POST `/offers/approve` | Different admin | `{offerId}`; eligible lead and current catalog; draft → approved |
| GET/POST `/deliveries` | Scoped read/admin write | `{allocationId,offerIds?:[]}`; one portal delivery, independently approved matching offers only |
| POST `/deliveries/accept` | Allocated buyer/team | `{deliveryId}`; available → accepted |
| GET/POST `/followups` | Scoped | `{allocationId,title,dueAt,assigneeId?}`; future ISO date, eligible scoped assignee; team assigns self only |
| POST `/followups/close` | Scoped | `{followupId,status:completed\|cancelled}`; terminal transition |
| POST `/sources/renew` | Admin | `{sourceId,evidence,permissionExpiresAt}`; HTTPS evidence, future expiry |
| POST `/connectors/configure` | Admin | `{sourceId,enabled:boolean,records:[]}`; ≤25 synthetic non-contact fixtures; mock/official_api/permitted_feed source |
| POST `/connectors/run` | Admin | `{connectorId}`; synchronous mock collection, transactional via HTTP |
| POST `/connectors/queue` | Admin | `{connectorId,dueAt}`; durable one-shot mock collection |
| POST `/retention/schedule` | Admin | `{dueAt}`; durable one-shot tenant retention job |
| GET `/jobs` | Admin (buyer gets empty projection) | Sanitized status, attempt count, due time, result summary |
| POST `/jobs/run` | Admin | Process due jobs for this tenant now |
| POST `/jobs/retry` | Admin | `{jobId,dueAt}`; failed jobs only, maximum three attempts |

Passwords require 14–200 characters and are hashed, never returned/audited.
Provisioning does not issue API tokens or send invitations; password login is used.
Legacy principal `role=buyer` remains wire-compatible; `accessRole` and `teamId`
provide explicit company/team authorization. Existing seeded buyers default to
company managers. New memberships use composite foreign keys for tenant/company/
team consistency. Changing privileges invalidates role-bound idempotency responses.

A connector fixture uses the existing intake fields `externalId`, `sourceUrl`,
`title`, `tags`, `budget`, `location`, `serviceLocation`, `remote`, `onsite`,
`retentionDays`, `ownership`, `occurredAt` and `synthetic:true`. No secrets or endpoint
credentials are accepted. The registry labels permitted API/feed interfaces, but
configured adapters always run locally with `externalEnabled:false`. Full intake
validation occurs in the transaction when executed; a malformed batch produces a
sanitized failed job and no partial leads. Provider enablement and actual permission
verification remain owner-reviewed integration work.

Campaign schedule now also queues a job. Worker/manual execution races serialize
under IMMEDIATE transactions; a completed receipt is not generated twice. Failures
roll back domain writes and record only generic status codes. No background live
sending, paid AI or resale is possible through this worker. AI remains isolated
mock/fallback, with regression coverage for rejection/mutation/invalid outputs.

`GET /health` is unauthenticated database/initialization health and reports
`workerActive`; `GET /health/worker` is 503 for a stale/missing heartbeat. This is
process liveness for a local development worker, not per-tenant service monitoring.
