This adds a synthetic multi-tenant development workflow for WC-E2E-01. Admins can
intake permitted opportunities, qualify and allocate them, record consent, draft
catalog-backed offers and obtain independent approval for simulated campaigns.
Buyers see only their own eligible allocations and can record synthetic outcomes.

Tenant identity comes from hashed credentials and sessions rather than a caller
header. SQLite transactions replace JSON for the new backend, with tenant-scoped
deduplication, immutable audit records, suppression, retention and tested recovery.
Live collection, sends, paid APIs, resale and deployment remain disabled.

The existing Node stack is extended with SQLite and a native browser portal;
Laravel/MySQL/Redis and Next.js migration requirements are documented. PR #1 and
main are not merged. Legacy fixes cover concurrent imports, malformed localStorage
and formula-leading CSV exports.

Validation: 63 backend/database/domain/legacy tests and 8 Chromium tests pass,
with zero failed or skipped. Full counts, security findings and production blockers
are in docs/mission/TEST_EVIDENCE.md and docs/mission/SECURITY_AUDIT.md. Setup,
Admin/Buyer walkthrough and API/connector contracts are in docs/mission/.
