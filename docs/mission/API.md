# Workforce v1 API and connector contract

All examples are synthetic. The service binds to loopback. JSON request bodies are
limited to 64 KiB. No CORS permission is granted. All business routes require an
authenticated principal. Tenant identity is derived from that principal: callers
cannot select a tenant in JSON, and a conflicting X-Tenant-Id is rejected.

## Authentication and errors

Browser: POST `/auth/login` with `{ "email": "...", "password": "..." }` and
the local portal's Origin. It sets an 8-hour HttpOnly, SameSite=Strict session.
Every cookie-authenticated mutation requires a matching local Origin. Logout is
POST `/auth/logout`. A local API client can use its generated `Authorization:
Bearer <apiToken>` without cookies. Disabling a principal invalidates its sessions
and keys immediately. Session/API key values are never returned by state endpoints.
No account or tenant provisioning endpoint is exposed.

This development service uses HTTP on loopback and therefore does not set a Secure
cookie. TLS, Secure cookies, trusted proxy configuration, MFA, password recovery,
session management, shared rate-limit storage and an identity review are prerequisites
for any Internet deployment.

Business mutations require an `Idempotency-Key` of 8–100 alphanumeric, underscore
or hyphen characters. Keys are scoped to tenant and actor and bind the exact route
and JSON bytes. Identical retry returns the prior response; different input with
the same key is 409. Purge deliberately does not cache its response. Cached data
is cleared by tenant retention purge. Other business mutations run within an
immediate SQLite transaction, including the audit entry and cached response.

Responses are JSON; 200 is a completed business request (intake includes
`created: true|false`), 400 validation, 401 authentication/signature, 403 role,
origin or approval restriction, 404 unknown or foreign object, 409 state/eligibility
conflict, 413 size, 415 media type, 429 rate limit, 500 generic internal failure.
Signed synthetic webhook intake returns 201. Error responses do not include SQL,
secrets or input payloads. The local rate limiter permits 150 requests per minute
per IP (10 login attempts in an independent bucket); it is not a distributed control.

## Routes

| Method and route | Role | Purpose |
| --- | --- | --- |
| GET /health | anonymous | DB quick check, schema and mock-mode indicator |
| GET /api/v1/state | admin/buyer | Role-filtered dashboard state |
| GET /api/v1/opportunities | admin/buyer | Tenant inventory / buyer's own eligible allocations |
| POST /api/v1/sources | admin | Record synthetic source type, permission evidence and expiry |
| POST /api/v1/opportunities/intake | admin | Permitted synthetic requirement intake |
| POST /api/v1/connectors/collect-mock | admin | Atomic batch through mock official/feed adapter |
| POST /api/v1/connectors/:id/webhook | signed runtime connector | HMAC-authenticated synthetic webhook |
| POST /api/v1/leads/qualify | admin | Persist mock score and reasons |
| POST /api/v1/consents | admin | Append evidenced grant, denial or withdrawal |
| POST /api/v1/suppressions | admin | Suppress lead and prevent URL re-intake |
| POST /api/v1/buyers | admin | Buyer profile, tags and geographic target |
| POST /api/v1/buyers/match | admin/buyer | Tenant matches / own allocated matches |
| GET /api/v1/catalog/services | admin/buyer | Tenant's locally reviewed synthetic catalog |
| POST /api/v1/catalog/services | admin | Record synthetic service review |
| POST /api/v1/offers/draft | admin | Offer referencing stored matching catalog entry |
| POST /api/v1/allocations | admin | Audited exclusive/shared internal allocation |
| POST /api/v1/campaigns | admin | Immutable mock campaign draft |
| POST /api/v1/campaigns/approve | different admin | Explicit mock-only approval |
| POST /api/v1/campaigns/schedule | admin | Record approved campaign's future run time |
| POST /api/v1/campaigns/cancel | admin | Cancel draft, approved or scheduled campaign |
| POST /api/v1/outreach/dispatch | admin | Simulate due campaign only; live mode always 403 |
| POST /api/v1/conversions/events | admin/own buyer | Deduplicated synthetic outcome and optional attribution |
| GET /api/v1/reports | admin/buyer | Scoped conversion counts and values by currency |
| GET /api/v1/audit | admin | Tenant's append-only audit IDs and actions |
| POST /api/v1/retention/purge | admin | Purge expired tenant data and dependent records |

## Payloads

Source registration requires name, type (`manual`, `official_api`, `webhook`,
`permitted_feed`, `mock`), HTTPS `evidence` without credentials, and future
`permissionExpiresAt`. All source scopes are forced to `synthetic-development`
and `externalEnabled: false`; supplying a live flag cannot enable anything.

Intake:

```json
{
  "sourceId": "stored-source-id",
  "externalId": "synthetic-001",
  "sourceUrl": "https://example.test/opportunities/001",
  "title": "Need a company website",
  "tags": ["website"],
  "budget": 1000,
  "location": {"country":"IN","state":"IN-BR","city":"patna","language":"en-IN","currency":"INR","timezone":"Asia/Kolkata"},
  "serviceLocation": {"country":"US","state":"US-CA","city":"oakland"},
  "remote": true,
  "onsite": false,
  "synthetic": true,
  "ownership": "tenant-owned",
  "retentionDays": 30
}
```

`occurredAt` is an optional valid past ISO source timestamp; capturedAt is server
controlled. Service location defaults to lead location. `email`, `phone` and
`contacts` intake fields are rejected. Only synthetic data is allowed. Dedupe uses
canonical HTTPS source URL or (sourceId, externalId), separately in each tenant.
Fragments and known tracking parameters are removed and query keys are sorted.
It does not resolve redirects, fetch URLs or claim cross-platform identity resolution.
After purge a URL suppression fingerprint still prevents re-intake.

Buyer: `{ "name": "Synthetic agency", "tags": ["website"], "target": ... }`.
Target example:

```json
{
  "include": [{"country":"IN"},{"country":"US","state":"US-CA"}],
  "exclude": [{"country":"IN","state":"IN-MH","city":"mumbai"}],
  "denyCountries": ["ZZ"],
  "remote": "remote",
  "locationKind": "service"
}
```

Empty include means global. Exclusions win. `remote` is `any|remote|onsite`;
`locationKind` is `lead|service`. Jurisdiction denials check both locations.
These are supplied policy IDs, not a determination of applicable law. Buyer
matching additionally requires qualification and overlapping tags. Buyers cannot
use matching to discover unallocated leads or another buyer's inventory.

Qualification uses `{ "leadId": "..." }`. Consent requires leadId, channel
(`email|whatsapp`), purpose (`requested_offer|marketing`), status
(`granted|withdrawn|denied`), HTTPS evidence, and expiresAt for grants. The
server records the verifying admin and time. The latest decision in that scope
wins. It is a synthetic review ledger, not proof of a real person's opt-in.
Suppression uses leadId and reason; a URL fingerprint remains after retention.

Catalog requires name, tags, numeric nonnegative price, uppercase currency,
HTTPS evidence, future validUntil and optional target. Caller-supplied `verified`
does not substitute for a stored catalog entry. Offer uses `{leadId, serviceId}`.
Offer versions are immutable version 1 in this build; editing/redrafting creates
a new offer ID and a new campaign approval. No provider credentials are accepted.

Allocation requires leadId, buyerId, mode (`exclusive|shared`), HTTPS evidence,
and sharedRightsEvidence for shared mode. All allocations are internal-only and
resale=false. A client-owned lead cannot be distributed. A buyer role cannot
allocate. There is no resale, billing, marketplace purchase or delivery endpoint.

Campaign creation requires name, offerIds (1–100), channel and purpose. It checks
current consent and an allocation for every lead. Approval requires campaignId
and acknowledgeMock=true, by a different admin. Scheduling requires campaignId
and future scheduledAt. Dispatch requires campaignId and mode=`mock`; it checks
due time, consent, suppression, retention, source permission and catalog expiry
again. Completion is `simulated_complete`, with a simulated receipt. There is no
worker that automatically runs scheduled records and no external send adapter.

Conversion requires allocationId, unique tenant eventId, type
(`consultation|won|lost`), value and currency. Optional campaignId must reference
a simulated-complete campaign containing that allocation's lead. Buyers can
record events only for their own allocation. Values are synthetic self-reported
events, not verified revenue or payment transactions.

## Connector and AI integration boundaries

`MockOfficialConnector.collect({source, syntheticRecords})` accepts at most 25
synthetic records and normalizes them through the same transactional intake.
POST collect-mock uses `{sourceId, records:[...intakePayloads]}`. No SDK, network
fetch or credential handling is implemented. Manual intake uses the normal route.

`makeServer({store, webhookKeys})` allows explicit test/runtime injection of
`{connectorId: {sourceId, principalId, secret}}`. No webhook keys are configured by
the normal CLI. The connector is bound to an active admin and that admin's source
and tenant. Header X-Wc-Timestamp is epoch milliseconds within five minutes.
X-Wc-Signature is the hex HMAC-SHA256 over `timestamp + "." + rawJsonBody`.
Changed source or tenant is rejected; duplicate signed payloads are rejected as
replays. The ledger stores a digest, not the raw payload/signing secret. The source
must be webhook or mock and permit synthetic intake. This is a local contract,
not provider-specific signature verification or a deployed callback URL.

`MockAI.qualify(lead)` and `.draft(lead, catalogService)` are isolated pure functions
with explicit mock provenance. They make no paid or free API requests and cannot
dispatch a campaign. Real Mr. India/AI adapters require owner approval, documented
tenant-bound service authentication, minimized prompts, output validation,
timeouts, rate/cost limits and mocked contract tests before adding credentials.

Legacy `/api/leads` and `/api/ingest` are separate single-tenant scripts and are
not exposed by this workforce server. Do not route their shared-token endpoints
into the tenant API. The original browser organizer is a localStorage tool, not
part of the tenant database.
