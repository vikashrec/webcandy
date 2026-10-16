# WEBCANDY-E2E-001 development setup

Use only this repository, Node 24 and Chromium. Start from the preserved QA baseline
and the dedicated `mission/webcandy-e2e-001` branch. Existing mission and QA reports
are historical evidence; this directory describes the current additions.

```sh
cd /workspace/webcandy
npm ci --ignore-scripts --cache ./private-data/npm-cache
npm test
npm run test:browser
```

If the development database does not exist, run `npm run workforce:seed` once.
Never reset an existing database or overwrite its private credential file. The seed
creates two synthetic organizations, each with two admins and two company buyers.
Generated passwords/API tokens live in ignored, mode-0600
`private-data/development-credentials.json`; do not print, publish or commit them.
Run `npm run workforce:start` and `npm run workforce:worker` in separate managed
terminals. Both use `WORKFORCE_DB` (default `private-data/workforce.sqlite`).
The web server defaults to loopback port 8790. `/health` verifies the database and
active initialization; `/health/worker` requires a heartbeat within 30 seconds.
Validate authenticated `/api/v1/state` without logging credentials. No application
compilation step is required: server and browser use native JavaScript modules.

An operator can add an empty organization to a local development database:

```sh
node src/workforce/initialize.mjs private-data/workforce.sqlite private-data/new-org-credentials.json 'Synthetic organization' admin@new.example.test reviewer@new.example.test
```

The credential target must not exist. Two distinct admins receive generated
passwords saved privately; no mail is sent. An organization has no buyers, leads,
sources or catalog until its admin creates them. No public tenant creation API is
exposed. Organization settings rename only the authenticated tenant.

## Admin, company and team walkthrough

1. Sign in at `/workforce` with a development admin. Organization lets you update
   its name, create teams under a buyer company, provision company managers or
   team members, and disable accounts/teams. Team membership must belong to the
   same tenant and buyer company. Password changes and disable/reassignment revoke
   sessions, API keys and cached mutation responses.
2. Use Opportunities for permitted **synthetic** intake/qualification. Buyers
   matches services and geographic eligibility and allocates a lead. Organization
   assigns an allocation to a team. A company manager sees its company's
   allocations; a team member sees only allocations assigned to its team.
3. Catalog & offers drafts an offer from a currently verified service. A different
   tenant admin approves it for portal delivery. Deliveries publishes the lead and
   optionally approved offers to the allocated buyer portal. A buyer accepts it;
   an accepted delivery cannot be reassigned. This is an internal portal record,
   not an email or WhatsApp message.
4. Company managers use Company & team to create/disable their own teams and
   provision team members. They cannot grant admin/company-manager roles or
   manage another buyer company. Team members have no account-management tab.
5. Follow-ups creates an allocation-scoped task, computes overdue state and closes
   it as completed/cancelled. Team members assign only themselves. No automated
   follow-up message is sent. Conversions records synthetic events and reporting
   follows tenant/company/team allocation visibility.
6. Governance renews source permission evidence and configures **mock** connector
   fixtures. Queue a connector/retention job or process due jobs now. Failed jobs
   expose sanitized error status and permit up to three attempts via explicit retry.
   Connector collections roll back fully if any record fails validation.
7. Campaigns preserves the independent human approval gate. Scheduling now writes
   a durable job; the mock worker automatically runs it when due. Consent, source
   permission, buyer/team eligibility, catalog verification and current admin access
   are rechecked at execution. Manual simulation remains available. Only mock
   receipts are produced. Workers serialize SQLite writes and commit receipt/status
   atomically; this is not a live provider retry design.

## Isolated development containers

Docker is required only for container verification. These commands are local
build/run instructions, not production deployment authorization:

```sh
docker compose -f compose.workforce.yaml build
docker compose -f compose.workforce.yaml run --rm --no-deps web node src/workforce/seed.mjs
docker compose -f compose.workforce.yaml up -d
docker compose -f compose.workforce.yaml ps
npm run test:workforce-containers
npm run test:containers
```

Seed once into the named volume before startup. Existing volumes/credentials are
preserved. Both services run as UID 1000 with read-only roots, dropped capabilities
and a shared private state volume. Only web's port is published, on loopback.
Set `WORKFORCE_HOST_PORT` and the matching exact `WORKFORCE_ORIGIN` together when
changing ports. For a separately approved HTTPS ingress, use its exact public
origin to enable Secure cookies; ingress/TLS itself is not supplied or verified.
Do not expose this development application publicly. `docker compose ... down`
stops services without deleting state; never use `down -v` on owner data.

## Backup and restore

The existing operator backup/restore contract remains in
[the original development guide](../mission/DEVELOPMENT.md). SQLite snapshots now
also preserve team memberships, delivery records, follow-ups and queued jobs.
Restore into an absent destination with **both web and worker stopped**. Restore
invalidates sessions/API keys/idempotency caches but retains password accounts.
Queued jobs remain queued and will execute as mocks when the restored worker starts;
review them before enabling that worker. Integrity/checksum verification and
foreign-key checks run before restore. Backups contain sensitive private data;
mode-0600 files are not an encrypted backup/retention policy.

The image is a single-host development unit. SQLite volume sharing is supported
between these web/worker processes on the same local filesystem, not replicas on
network storage. Laravel/MySQL/Redis, Next.js/TypeScript, managed migrations,
distributed scheduling, SSO/MFA, cloud infrastructure, TLS, monitoring, encryption
and disaster recovery remain separate architectural work. See DELIVERY.md.
