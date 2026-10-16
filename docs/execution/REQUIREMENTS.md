# WEBCANDY-E2E-001 requirement verification matrix

Baseline: `42dd1503d9a4659842ff07a62833efe7a322d1b5` (WC-QA-02).
Branch: `mission/webcandy-e2e-001`. Only vikashrec/webcandy is in scope.

The supplied mission text ends at Buyer Portal / tenant-scoped lead access.
Remaining sections were requested asynchronously; the requirements received are
being implemented without waiting for optional clarification. External marketing
services remain synthetic/mocked under the existing authorization boundary.

| Requirement received | Baseline | Implementation / verification evidence |
| --- | --- | --- |
| Organizations and users | Seed-only tenants/users | Organization settings and scoped account provisioning; tenant/role HTTP tests |
| Admin, buyer-company, buyer-team | Admin and flat buyer only | Explicit access roles, normalized company/team memberships; cross-tenant and cross-team negative tests |
| Authentication / authorization | Local passwords, sessions, hashed keys | Preserve guards; account revocation and role-context cache tests |
| Source / connector registry | Registry and programmatic mocks | Portal configuration, permission renewal and synthetic connector runs |
| Opportunities / leads / provenance / dedupe | Implemented synthetic scope | Preserve canonical/source keys and run all regressions |
| Consent / suppression / retention | Implemented with documented limits | Preserve withdrawal/tombstones; include new dependent records in purge |
| Global geography | API + single-region portal controls | Preserve matching and test team-visible results |
| Qualification / scoring / matching | Deterministic isolated mock + fallback | Preserve mock labels and approval boundaries; no live AI credentials |
| Allocation / delivery | Allocation only | Team assignment, audited portal delivery/acknowledgement, scoped projections |
| Campaign / offer / approvals | Manual mock scheduling | Preserve independent approval; durable mock job execution and failure records |
| Conversion / analytics | Synthetic allocation-scoped events | Extend projections and analytics to company/team scopes |
| Audit / health / backup / restore | Local SQLite foundation | Extend relational constraints and backup tests; add service/worker health |
| Responsive Admin portal | Existing core forms | Organization/users/teams, deliveries, connector jobs, audit and reporting |
| Buyer tenant-scoped access | Company-only allocation projection | Company manager and team views, delivered offers and acknowledgement |
| Cloud-ready development build | Legacy containers only | Separate non-root workforce image, persistent volume and isolated runtime smoke |
| Preferred Laravel/MySQL/Redis | Not implemented | Preserve Node; document SQLite single-replica boundary and migration requirements |

All received development rows are verified by the 92 backend, 11 browser and two container tests in [DELIVERY.md](DELIVERY.md). The preferred-stack row remains BLOCKED/deferred, as do live providers and production operation. New cross-team, provisioning, delivery, job rollback and backup cases are in `tests/workforce/execution.test.mjs`; the final browser case in `e2e/browser.mjs` verifies company provisioning through team acknowledgement and follow-up completion. `e2e/workforce-containers.mjs` verifies the new cloud development artifact. A passing mock is not evidence of real provider integration, verified consent or production readiness.
