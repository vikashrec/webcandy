# WebCandy Marketing Workforce — Implementation Status
Date: 2026-10-16
Branch: feature/marketing-workforce-foundation

## Implemented for review (not executed/verified)
- Node.js lead normalization, geographic matching, draft offers, permission helper.
- Local JSON-backed API prototype: token authentication, tenant-scoped opportunity intake/list, buyer registration/matching, offer draft.
- Duplicate source URL detection per tenant; basic audit entry for intake.
- Node built-in unit tests.

## Important limitations
- JSON storage is **development-only**, single-process; no transactions across processes, backups or production durability.
- Tenant ID is supplied in a request header, not cryptographically bound to a tenant-specific principal. Do not expose this API to real users or internet; production must derive tenant from verified authentication claims.
- Contact permissions are placeholder data only, not audited consent verification.
- No actual social network search, ads integrations, Mr. India AI API, WhatsApp/email sending, marketplace billing, UI or Laravel implementation.
- Existing legacy Node scripts remain unchanged. Production target architecture may migrate to Laravel/MySQL.
- No tests have been run by ChatGPT/Codex in the connected Codespace yet.

## Local smoke test (isolated development only)
```bash
npm test
MARKETING_API_TOKEN="$(openssl rand -hex 32)" node src/marketing/api.mjs
```
For requests use Authorization: Bearer <same token> and X-Tenant-Id: demo. Server binds to 127.0.0.1:8790.

## Codex checklist
1. Run npm test; repair failures and report exact results.
2. Review existing repository and resolve conflicts with legacy scripts.
3. Add real Laravel/MySQL architecture through a separate reviewed PR.
4. Implement trustworthy tenant auth and consent ledger before external exposure.
5. Implement official provider adapters using test credentials and mocks.
6. Verify no real outreach, ad spend or deployment occurs without approval.
