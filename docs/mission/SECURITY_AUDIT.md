# WC-E2E-01 security and tenant review

Scope: local synthetic development build, not a production security certification.
No other project was accessed or modified. No real leads or external credentials
were used. All live connectors and campaign sends are absent or explicitly blocked.

| Boundary | Implemented and exercised | Remaining production requirement |
| --- | --- | --- |
| Tenant identity | Principals carry tenant; hashed key/session lookup; tenant body/header spoofing rejected | Reviewed identity provider, tenant lifecycle, invitations, MFA |
| Authorization | Tenant-admin vs buyer; all object lookups use tenant + kind + ID; buyer matching and conversion ownership checks | Platform admin and delegated team scopes intentionally absent |
| Database | Composite tenant keys, FK to tenant, JSON validity, URL/source unique indexes, immediate transactions, WAL and busy timeout | MySQL domain schema, composite FKs between entities, migration and load tests |
| Buyer projections | Only allocated eligible leads; no source URLs, source permissions, consent evidence, audit or other buyer inventory | Field-level policy review for real data |
| Authentication | Scrypt passwords with random salt; random keys stored as hashes; expiring sessions; principal revocation | Secure TLS cookies, session/key rotation and recovery, distributed throttling |
| CSRF / browser | Strict same-site HttpOnly cookie, local Origin on login and mutations, no CORS, strict CSP, textContent rendering | Trusted host/proxy model, hardened TLS deployment, independent penetration test |
| Intake | Synthetic-only flag, permitted source with evidence and expiry, contact fields rejected, canonical URL dedupe | Source-specific proof validation, real consent and personal-data processing review |
| Consent | Append-only decisions bound to lead, channel, purpose, evidence, admin and expiry; invalid expiry fails closed | Evidence authenticity and real opt-in verification, jurisdiction-specific rules |
| Suppression | Stops visibility, qualification/matches and execution; URL fingerprint blocks re-intake after purge | Cross-identity suppression with reviewed data-minimization and retention policy |
| Catalog / AI | Stored synthetic catalog review with expiry; deterministic isolated mock; no paid/network call | Verify real services, pricing, provider authentication and cost controls |
| Allocations | Matching required, exclusive conflicts, explicit shared rights, client-owned distribution denied, resale blocked | Legal rights verification and independently approved marketplace design |
| Campaigns | Immutable offer/campaign content, separate approver, explicit mock approval, due schedule, eligibility recheck, cancellation | Sender identities, channel templates, actual delivery approval and provider contracts |
| Replay / consistency | Actor/tenant idempotency keys, exact request binding; webhook HMAC/time/replay ledger; transaction rollback | Distributed nonce expiry, provider-specific signatures, queue semantics |
| Audit | IDs/actions/actor/time only; SQL triggers reject audit update/delete; denied authenticated 403/409 recorded | External tamper-resistant log sink; local DB operator can bypass SQL controls |
| Retention | Expiry hides buyer data; explicit tenant purge removes dependent data and caches; tombstones retained | Scheduled purge jobs, backup expiry, audit/tombstone policy, real erasure workflow |
| Backup / recovery | Online snapshot, integrity/FK/schema validation, checksum, no overwrite, restored sessions/keys invalidated | Encrypted off-site versioning, trusted manifests, recovery drills on approved infrastructure |
| HTTP / secrets | Size/content-type limits; generic 500; fixed asset allowlist; private files mode 0600; no secret values in docs | TLS, centralized secret manager, monitoring, resource limits and incident controls |

## Audited regressions and limitations

- PR #1 was inspected through Git at `1bbdff7baa62c18ce78120b5d3de8f575601d1f1`.
  Its shared token plus X-Tenant-Id can select arbitrary tenant data, and its JSON
  queue protects only one store object. This branch does not merge PR #1 and does
  not expose that prototype. New auth derives tenant from a principal; all writes
  use database transactions. GitHub API access to PR conversation was denied,
  so conversation/review metadata was not audited.
- Existing legacy JSON storage lost 19 out of 20 simultaneous in-process writes
  in a controlled reproduction against the base source. Serialization and unique
  temporary files fix the in-process case; separate legacy server processes still
  must not share a JSON store. Workforce persistence does not use this adapter.
- Legacy localStorage parsing could crash page startup on malformed JSON or
  invalid rows. The organizer now filters malformed rows and preserves an unreadable
  stored value on load. Its CSV export neutralizes formula-leading cells. Browser
  regressions verify malformed storage, formula output and normal save/export/delete.
- Browser testing found and fixed approval-checkbox serialization and ambiguous
  select labels. Both approval rejection and successful independent approval are
  covered by the full browser flow.
- Geographic IDs are validated structurally, not against a complete official
  gazetteer. Deny-country lists are explicit development policy, not legal advice
  or automated compliance decisions. Unknown location data cannot satisfy a specific
  inclusion; global criteria intentionally match unspecified locations.
- No contacts are stored by the workforce intake. Legacy extraction scripts retain
  their original behavior and are not invoked by the new service or tests against
  real data. Do not run legacy collection with real credentials under this mission.
- SQLite JSON entity relations are enforced at the service boundary; database
  tenant and unique constraints do not replace a normalized production model.
  Local operator access to the DB is trusted. Audit triggers are not protection
  against that operator changing schema or replacing files.
- Data, passwords, API tokens, screenshots and temporary databases from development
  belong in ignored private-data/test-results paths. Publishing a development
  snapshot is not approval for public exposure or real-person data processing.

## Approval-restricted work not performed

Real source collection, contact harvesting, outbound email/WhatsApp, paid APIs,
ad campaigns/spend, purchases, resale, production deployment and merges remain
unperformed. Introducing any of these requires the owner's explicit authorization
and the concrete provider, legal, identity and infrastructure prerequisites.
