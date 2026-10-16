# WC-E2E-01 development build

This branch is a synthetic, local development foundation. It performs no external
collection, contact harvesting, sending, ad spending, resale, purchasing or deployment.
The original browser organizer and legacy Node services remain separate and usable.
Do not expose any of these development services to the Internet.

## Runtime and installation

Use Node 24 LTS (`.nvmrc`), npm and Chromium. Node 24.19.0, npm 11.9.0 and system
Chromium 154 were exercised in the mission environment. Node's SQLite API is
experimental; production adoption needs a separate decision.

```sh
cd /workspace/webcandy
npm ci --cache ./private-data/npm-cache
npm test
npm run test:browser
npm run workforce:seed
npm run workforce:start
```

The browser suite uses `/usr/bin/chromium` when present. Otherwise install the
Playwright browser with `npx playwright install chromium`, or set `CHROMIUM_PATH`
to your installed executable. CI installs browser OS dependencies too. The
browser tests in this cloud container launch Chromium without its process sandbox; this is a test-runner
constraint, not permission to render untrusted websites. Network routes in the
browser tests allow only the local test server.

There is no compilation step: the server and portal are native JavaScript modules.
`npm test` runs the legacy tests and new database, HTTP, domain and workflow tests.
`npm run test:browser` runs a separate real Chromium suite. Tests use isolated
temporary/in-memory databases and newly generated synthetic principals.

For the separately audited **legacy** Docker foundations, run
`npm run test:containers` with a working local Docker daemon and Compose plugin.
It builds the Node 24 image, validates Compose, starts two isolated containers on
random loopback ports, checks authenticated ingest/dedupe/read and removes its own
containers, volume, test image tag and temporary environment file. Registry pulls
are ordinary development image downloads. It does not deploy the workforce.
`.dockerignore` excludes private runtime data, credentials, Git metadata and caches.
Docker CLI state defaults to ignored `private-data/docker`; QA_DOCKER_CONFIG can
select another writable config directory. No home directory override is needed.

The buyer form now supports blank inclusions for global targeting, country,
subdivision and city inclusion/exclusion and lead versus service location. Multiple
regions and jurisdiction denials remain available through the API. After a 401,
the portal clears cached tenant content and returns to sign-in. A failing or
malformed AI adapter uses an explicitly marked development mock fallback; it does
not bypass consent, matching or campaign approval. Read the independent
WC-QA-02 audit in `docs/qa/WC-QA-02.md` for current evidence and remaining gaps.

Seed once for each new development database. It refuses to reset existing tenants
or overwrite credentials. The default database is `private-data/workforce.sqlite`.
`WORKFORCE_DB` overrides the database path; the seed CLI always writes its generated
credential file to this checkout's ignored `private-data` directory. Keep custom
database paths outside publicly served directories. `WORKFORCE_PORT` changes the
default port 8790. Server binding is always loopback.

Generated accounts and passwords are in
`private-data/development-credentials.json` (mode 0600). Open that file locally;
never commit it or paste its values into chat, logs or documentation. Each of the
`alpha` and `bravo` synthetic companies has admin, reviewer, buyer and other-buyer
accounts. Passwords and API tokens are randomly generated; the database stores
salted password hashes and token hashes. There is no shared default password.
The seed includes a permitted synthetic source, two buyers, and a locally reviewed
synthetic catalog service per tenant. No real WebCandy service or price is verified.

The portal is served at `/workforce`. `/legacy` serves the original localStorage
organizer. The new server only serves an explicit asset allowlist, never the
checkout or private-data directory. The older README's Python static server is
only suitable for the original organizer; never use it to serve private data.

## Readiness

GET `/health` must return HTTP 200, `database: "ok"`, schema 1 and
`externalDispatch: false`. It performs a SQLite quick check. Then sign in and
confirm that your account and tenant are displayed. A running PID alone is not
readiness. Stop/restart the service after a new task restores files; processes do
not survive snapshots. Use the existing checkout; each cloud task is isolated.
Do not create worktrees unless the owner explicitly requests one.

## Admin and Buyer walkthrough

1. Sign in as alpha admin. In Opportunities, intake a synthetic requirement with
   a unique example.test URL, a permitted source, service tags and delivery location.
   Qualify it to produce a deterministic mock score and reasons.
2. In Buyers, find matches and allocate it to Synthetic Web Studio. Exclusive
   allocations cannot coexist with another allocation. Shared allocations require
   separate sharing-rights evidence. Client-owned distribution and all resale are blocked.
3. In Governance, record a synthetic requested-offer consent decision for email
   with evidence and expiry. Public visibility is never treated as consent.
4. In Catalog & offers, select the reviewed matching service and draft an offer.
   Prices are illustrative. Drafting does not send anything.
5. In Campaigns, create a draft for the offer. Sign out and use the alpha reviewer
   account to approve mock simulation. The creator cannot approve their own draft.
   Schedule a future ISO timestamp. After it is due, simulate it. Eligibility,
   source permission, catalog validity, consent and suppression are checked again.
   The result is a simulated receipt; no email or WhatsApp request occurs.
6. Use the alpha buyer account to see only its allocations and record a synthetic
   consultation/won/lost event. Use other-buyer to verify it sees no exclusive
   allocation belonging to the first buyer. Use bravo to check company isolation.
7. Reports keep values separate by currency. Governance supports suppression and
   expired-data purge. Withdrawal or expiry after scheduling blocks execution.

New buyer profiles do not automatically create login accounts. Account provisioning
is an operator-only local seed function; production invitations and tenant lifecycle
are blocked pending a reviewed identity design. Admin here means tenant admin;
there is deliberately no cross-tenant platform superuser in this build.

## Geographic model

See the API document for include/exclude examples. Country uses uppercase ISO-style
two-letter IDs, subdivision uses a country-prefixed ID (e.g. IN-BR), and city uses
a stable caller-supplied slug under that subdivision (e.g. patna). Matching supports
multiple inclusions, exclusions with precedence, global defaults, lead versus
service location, remote/on-site eligibility and explicit denied countries.
Language tags and timezones are checked with Intl; currencies use three-letter
uppercase codes. This is a normalized contract, not a verified worldwide gazetteer
or legal jurisdiction engine. Canonical city resolution, aliases, real service
coverage verification and legal policy datasets remain outside the local build.

## Backup and restore

```sh
node src/workforce/backup.mjs backup private-data/workforce.sqlite private-data/backups/audit-01.sqlite
# Stop the destination service. Restore to an ABSENT path, never overwrite a live DB.
node src/workforce/backup.mjs restore private-data/backups/audit-01.sqlite private-data/restored.sqlite
WORKFORCE_DB="$PWD/private-data/restored.sqlite" npm run workforce:start
```

Backups use SQLite's online backup API, integrity/schema/FK checks and a SHA-256
sidecar. Restore verifies checksum and database structure, refuses to overwrite,
and invalidates sessions, API keys and cached responses. Local password accounts
remain usable for operator recovery. Test the recovered tenants and login before
using a restored instance. A checksum detects corruption, not a malicious operator
who can replace both files. Only restore trusted snapshots. These local snapshots
are neither encrypted nor off-site; production backup retention, encryption and
independent disaster recovery are blocked pending infrastructure approval.

Lead retention defaults to 30 days, accepts 1–90 days, and hides expired items from
buyers immediately. Run the tenant-scoped purge operation to physically remove
expired leads and dependent consents, allocations, offers, campaigns, receipts,
attributed conversions and cached responses. Purge has no automatic background
scheduler in this development build. Audit IDs and irreversible URL suppression
fingerprints remain; their production retention must be defined. Old backups can
contain data later purged from the live DB; backup expiry and restore/re-purge
procedures are required before real data can be introduced.

## Technology decision

The proposed Laravel/MySQL/Redis and Next.js/TypeScript architecture remains the
production target. This separate mission branch extends the existing Node system
with Node 24 SQLite transactions and a dependency-free browser portal. PHP,
Composer, MySQL and Redis are absent in the supplied environment; adding four
unverified services would not demonstrate their production readiness. SQLite
provides real local persistence, unique constraints, transactions, rollback, backup
and writer locking rather than inheriting PR #1's JSON store. The portal uses
explicit runtime validation and DOM text rendering, not a TypeScript build.

Before migration, preserve the v1 API contracts and tenant/authorization regression
tests. Replace the local auth service with a reviewed identity provider/Laravel
guards, generic JSON records with domain migrations and tenant-scoped foreign keys,
SQLite with MySQL integration tests, manual mock scheduling with Redis workers,
and the portal with typed Next.js pages. No production migration has been attempted.

Existing Docker/Compose/Vercel files deploy only legacy components; they do not
package the workforce. There is intentionally no production deployment in this mission.
