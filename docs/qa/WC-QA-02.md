# WC-QA-02 independent audit and final verification

Audit date: 2026-10-16. Repository: **vikashrec/webcandy only**.

**Full Marketing Workforce V1: NOT READY.** The corrected synthetic development
foundation is ready for owner review. The proposed product is not complete, and
passing simulated workflows does not establish live integration or production readiness.

## Source and method

The latest remote WC-E2E-01 branch was independently resolved with Git:

- Branch: `mission/wc-e2e-01`.
- Implementation: `3285df47f2242b798b030aad190ff6851dbd67e6`.
- Delivery tip audited: `30afb486e84d9bae6ddc782b7b9c761fc440deea`.
- QA fixes and tests: `b327ecac6b554aded8e1670d9abfccde8b1538e5`.
- QA branch: `mission/wc-qa-02`, based on the delivered implementation without merging main or PR #1.

I inspected source, database schema and queries, API authorization and body handling,
portal rendering and forms, seed/bootstrap, AI and connector boundaries, backups,
legacy scripts, tests, workflows, Docker/Compose, Caddy example, Vercel configuration,
README and the proposed architecture. An initially clean checkout and existing
private runtime files were preserved. No other project was modified.

The old PASS statements were treated as claims. A frozen install and fresh runs
independently reproduced the original **63 backend + 8 browser** passes. Nine new
regressions then failed against the delivered source. Further isolated probes
reproduced process termination on denial-audit failure, stale browser content after
401, missing geographic controls, invalid type coercion and schema stamping.
Fixes were applied and the complete suites rerun; missing major modules were not
relabelled as credential blockers or covered with trivial passing substitutes.

## Verified results

| Fresh final command | Executed | Passed | Failed | Skipped / cancelled |
| --- | ---: | ---: | ---: | ---: |
| `npm test` | 82 | 82 | 0 | 0 |
| `npm run test:browser` | 10 | 10 | 0 | 0 |
| `npm run test:containers` | 1 | 1 | 0 | 0 |
| **Total** | **93** | **93** | **0** | **0** |

Backend breakdown: 17 legacy, 12 existing HTTP integration, 8 existing database,
6 geographic/domain, 20 existing service workflow, and 19 new QA regressions.
Browser breakdown: 8 existing workflows and 2 new QA regressions. The single
container test is a multi-step integration scenario, not one test per assertion.
No live-provider test is included in these totals.

Environment: Node 24.19.0, npm 11.9.0, SQLite 3.53.3, Chromium 154.0.8037.57,
Docker client/server 28.4.0. `npm ci --ignore-scripts` passed. `npm audit` reported
zero known dependency vulnerabilities at the time checked. `git diff --check`
passed. These results do not constitute a general security certification.

Sanitized command logs, reproduction summaries, container details and hashes are
committed in [evidence](evidence/). Full development screenshots remain in ignored
`test-results/admin-campaign.png` and `test-results/buyer-conversion.png`.

## Defects and incomplete controls corrected

| Finding | Actual pre-fix behavior / scope | Correction and verification |
| --- | --- | --- |
| Consent revocation blocked | A suppressed lead or expired permission prevented recording withdrawal, despite an existing grant | Withdraw/deny can be appended for retained leads; grants still require eligibility. QA-01 |
| Suppression identity lost after purge | Same source/external ID could return under a changed URL after the original lead was purged | Tombstones now include source-identity hash; retained legacy records are backfilled before purge. QA-02/15 |
| Cached response bypassed current role | An operator-downgraded principal replayed an old admin success without the admin guard; this did not create a fresh record but returned privileged cached data | Role checked before cache; cache bound to current role/buyer assignment. QA-03/16 |
| Suppressed buyer data replayed | Reusing a match POST key returned the old eligible inventory after suppression | Match queries recompute instead of replaying snapshots. QA-04 |
| Inactive buyer ignored | Inactive profile retained access/matches and could satisfy campaign allocation checks | Principal resolution and service checks enforce active buyer state. QA-05 |
| AI exceptions / malformed results | Provider exceptions caused failure with no fallback; scores/review flags were unchecked; output spreads could overwrite offer identity and catalog terms | Validated synchronous development adapter, cloned inputs, whitelisted output, explicit deterministic fallback and audit marker. QA-06/07/11/12/13 |
| Duplicate campaign recipients | Two offer IDs for one lead counted and simulated that recipient twice | Recipient identity deduplication enforced before draft/approval/execution. QA-08 |
| Readiness false positive | An intact but unseeded DB returned healthy while no admin could sign in | Health requires an active admin and reports initialized=false/503 otherwise. QA-09 |
| Audit failure crashed server | Throwing while writing a denial audit escaped the request catch; an isolated base-server child exited 1 | Returns generic 503 without process termination; following requests still work. QA-10 |
| Stale browser data after expiry | A rejected request displayed 401 but left the previous tenant inventory and identity in the DOM | Clears cached state/content and returns to sign-in upon 401. New browser regression |
| Geographic UI incomplete | Buyer form required a country and exposed no state/city criteria, so global and city targeting could not be configured there | Optional global scope, subdivision/city include/exclude and lead/service selection. New browser regression; QA-17 checks persisted matching |
| Invalid scalar coercion | Arrays could pass currency regexes; false remote/ownership silently became defaults | Explicit location/currency types and nullish defaults reject invalid structured input. QA-18 |
| Unsupported schema overwritten | Opening a version-2 fixture inserted version 1 and initialized application tables instead of refusing the file | Schema inspected before DDL; backup validation shares strict version check. QA-19 verifies original file remains unchanged |
| Container boundary maintenance | Docker used Node 22 despite the package's Node 24 requirement; no .dockerignore excluded private runtime files from build context | Node 24 image, explicit exclusions, Compose validation and actual non-root ingest/dedupe/read smoke. Build-context exclusions inspected; final image exclusion tested |

The authorization/cache and privacy findings affect changes to a principal/profile
or previously eligible data. No cross-tenant object access, SQL injection or stored
XSS was reproduced in the exercised HTTP/browser cases. This is bounded evidence,
not proof that every possible attack is excluded.

One intermediate full regression failed because the consent change validated status
before looking up a foreign lead. The ordering was corrected to preserve the existing
tenant-scoped Not found behavior; the assertion was not weakened. The first manual
container smoke also raced a published Docker port before its Node listener was
ready. The committed harness now waits for both service responses, and cleanup
removes only its uniquely named containers, volume, image tag and environment file.

## Workflow-by-workflow verdict

PASS below applies to the stated development scope. PARTIAL/MISSING is not counted
as a completed feature because another test happens to pass.

| Requested workflow | Verdict | Direct verification and remaining limitation |
| --- | --- | --- |
| 1. Admin authentication/dashboard | PASS — local | Fresh password login, HttpOnly/SameSite session, logout, wrong password, expiry, revocation, CSRF and dashboard; production identity/MFA/TLS absent |
| 2. Buyer accounts/roles/tenants | PASS — seeded scope; PARTIAL lifecycle | HTTP/body/header foreign IDs, buyer-owned projections, role downgrade, assignment change, inactive buyer and company/browser separation; invitations, provisioning UI, platform admin and team scopes absent |
| 3. Authorized discovery/ingestion | PARTIAL — mocks/manual only | Source evidence/expiry, synthetic manual intake, atomic mock collection, HMAC webhook signature/time/replay; live collection adapters, OAuth and scheduled discovery absent |
| 4. Normalization/provenance/dedupe | PASS — source identity | Canonical URL, timestamp, per-source external ID, tenant uniqueness, concurrent intake and persistence; no cross-source identity verification |
| 5. Global/country/state/city targeting | PASS — normalized IDs | Positive/negative persisted matching, multiple include/exclude regions, service vs lead location, remote/on-site and deny rules; no authoritative global gazetteer or legal rules dataset |
| 6. AI qualification/scoring | MOCK ONLY | Deterministic rule score/reasons persisted and validated; no semantic model, evaluated model quality or real Mr. India integration |
| 7. Buyer matching/allocation | PASS — internal development | Qualified tag/location matching, own inventory, exclusive conflicts, shared rights evidence and client-owned/resale restrictions; legal rights authenticity is not verified |
| 8. Verified catalog/offers | PARTIAL — synthetic reviews | Stored evidence/expiry and matching, authoritative synthetic prices, immutable draft; no real catalog/service/price verification |
| 9. AI adapter/fallback/failures | PASS — synchronous development | Exceptions, malformed output, reserved-field/input mutation and unsupported rejected Promise handled with labelled fallback; real asynchronous provider timeout/circuit breaker/queue absent |
| 10. Campaign/human approval | PASS — simulator | Immutable drafts, creator cannot approve, distinct admin, explicit mock acknowledgement, future schedule, cancellation, due execution, eligibility rechecks and duplicate-recipient block; no autonomous worker or real-send approval |
| 11. WhatsApp/email mock integrations | PARTIAL — generic simulator | Both channel/purpose consent scopes and channel-labelled mock receipts tested; no mocked provider HTTP contract, sender identity, WhatsApp template or SMTP/delivery callback integration |
| 12. Follow-ups/conversions | MISSING follow-ups; PASS synthetic events | No follow-up task, inbox, conversation or reminder module. Owned allocation events, dedupe, campaign attribution and currency-separated synthetic reporting work; lead lifecycle is not a full CRM |
| 13. Billing records | MISSING | No ledger, invoices, orders, payment integration, disputes or refunds. Conversion value is self-reported synthetic data, not verified revenue |
| 14. Consent/suppression/privacy | PARTIAL — corrected development controls | Grant/revoke/expiry, suppression, source-key persistence, tenant purge and cache deletion tested; no real evidence authenticity, legal policy, contact DLP or backup erasure process |
| 15. Audit/backup/restore/health | PASS — local; PARTIAL operations | Append-only trigger, rollback, two-connection writer lock, online backup/checksum/integrity, restore and access invalidation, unknown schema rejection, initialized health and restart persistence; no independent encrypted off-site recovery or tamper-resistant log sink |

## Architecture, deployment and integrations

The proposed Laravel/MySQL/Redis and Next.js/TypeScript stack has not been
implemented. Actual runtime is Node 24, synchronous SQLite and native JavaScript
DOM pages. Domain entities are JSON records with tenant keys and service-level
relationships, not the proposed normalized migrations. There is no MySQL test,
Redis worker, tenant-specific sender account integration, Mr. India service-to-service
authentication, cross-service catalog sync, marketplace/order lifecycle or billing
ledger. These are implementation gaps; supplying credentials alone cannot fix them.

The existing Dockerfile and Compose package only the legacy single-tenant reader
and ingest APIs. They were built and exercised locally with synthetic tokens,
random loopback ports and an isolated shared volume. The image runs as UID 1000,
contains no private runtime files and supports authenticated dedupe/read. There is
still no workforce container/Compose deployment. Caddy is an example write-only
gateway with a placeholder hostname; no certificate, public route or TLS deployment
was tested. Vercel builds only index.html, not the tenant backend.

The legacy Facebook workflow still contains a scheduled live collection path if
its separate GitHub configuration permits it. QA did not trigger that path or call
Facebook. Secret/variable metadata reads returned Resource not accessible by
integration (403), so the current bindings and live schedule readiness are unknown.
No claim is made that those pre-existing live paths are disabled. The new workforce
runtime makes no external marketing/provider requests and its real dispatch is blocked.

GitHub PR/Actions reads now work through existing authentication. The historical
WC-E2E-01 API connectivity blocker is no longer general. PR #1 remains open at
`1bbdff7baa62c18ce78120b5d3de8f575601d1f1`, with no human review and one existing
Vercel bot preview comment; the preview was not opened or treated as workforce
deployment evidence. The prior branch's Actions run
[38941060173](https://github.com/vikashrec/webcandy/actions/runs/38941060173)
was independently confirmed successful for exact head 30afb486. Current QA CI and
draft review details are recorded in the delivery note after the QA branch is pushed.

## Remaining blockers and owner decisions

1. Implement follow-ups/inbox, buyer/team provisioning, orders and billing if those
   are V1 acceptance requirements. They are absent, not passing or merely unconfigured.
2. Resolve the documented development stack deviation before a production migration:
   normalized tenant FKs, MySQL, Redis scheduling, typed portal and workload/queue tests.
3. Implement and separately authorize real provider adapters, tenant-bound identities,
   sender accounts and catalog/source/consent verification. No credentials were requested.
4. Complete identity recovery/rotation/MFA, TLS, operational monitoring, load testing,
   legal privacy policies, scheduled purges and independent encrypted backup/restore drills.
5. Legacy tombstones already purged before this QA cannot recover their lost external
   identity. Existing URL suppression still applies; broader identity suppression
   needs trustworthy retained source identity or a reviewed migration/data policy.

No scraping, real contact collection, message sending, ad spend, paid AI call,
purchase, resale, merge or production deployment was performed. Docker pulls and
local test containers are development validation only. No test defect remains
unexplained in the exercised synthetic scope. Full V1 remains **NOT READY** because
the missing product modules and production integrations above have not been built.
