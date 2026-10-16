# Codex Testing Handoff — Marketing Workforce Foundation
Branch: feature/marketing-workforce-foundation

## Run after desktop access
1. Inspect existing repo and the new source/test files.
2. Use Node.js >=20 and run `npm test`.
3. Report all failing tests and inspect legacy scripts for compatibility.
4. Review input validation, consent checks, tenant boundaries, deduplication and privacy assumptions.
5. Do not run untrusted downloaded source code or contact real leads.
6. Do not send WhatsApp/email, spend on ads, deploy, or merge without separate approval.

## Scope
This is a small pure-logic prototype, not a Laravel backend, real connector, AI API, CRM, or deployed marketplace. A permission flag supplied by an untrusted caller is NOT proof of consent: production must verify a trusted, auditable consent record. Offer drafts must be human-approved before delivery.
