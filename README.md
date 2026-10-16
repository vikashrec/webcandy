# Facebook Job Search

## Marketing Workforce development mission (WC-E2E-01)

A separate synthetic multi-tenant development application is now available on the
mission branch. Start with [development setup and Admin/Buyer walkthrough](docs/mission/DEVELOPMENT.md),
[API and connector contracts](docs/mission/API.md), and the
[security and tenant audit](docs/mission/SECURITY_AUDIT.md).
Use Node 24, `npm ci`, `npm run workforce:seed`, then `npm run workforce:start`.
Run `npm test` and `npm run test:browser` for the backend and Chromium regressions.
The workforce uses transactional SQLite and isolated mocks; external collection,
real sending, resale, spending and production deployment are not enabled.
The original organizer and legacy services described below remain separate.

Standalone experiment in `vikashrec/webcandy`, separate from Definition India and Mr. India.

## Current functionality
- Static mobile-friendly `index.html`; no account login or dashboard.
- Opens Facebook post search for a chosen keyword in a new tab.
- Manually save job requirement, post URL, profile URL and contact details explicitly published for business contact.
- Browser-local lead storage, duplicate post URL check, deletion and CSV export.

## Run
Open `index.html` in a browser, or serve it with `python3 -m http.server 8000` and visit `http://localhost:8000`.

## Not yet implemented
The page does **not** scrape Facebook or automatically search every two hours. An unattended scheduler and an authorized data source are required for that. Facebook group/private content and profile contact information must not be harvested without authorization. Any future scheduled importer should deduplicate by post URL, keep source timestamps, respect access permissions and retain only voluntarily published business contact details.

## Privacy
Saved leads stay in the browser's localStorage until cleared. Exported CSV files are stored wherever the user saves them. Do not put personal information in a public repository.


## Stage 3.1 — Private ingest server (foundation, not deployed)
- `scripts/ingest-api.mjs` accepts authenticated `POST /api/ingest` using `PRIVATE_LEADS_TOKEN`.
- Set `PRIVATE_LEADS_FILE` to a private data path outside public version control. The service binds to `127.0.0.1:8788` by default.
- Send JSON `{"source":"facebook-page","pageId":"1234","leads":[{"id":"101","job":"Hiring developer","post":"https://www.facebook.com/example/posts/101"}]}`.
- `scripts/search.mjs` can send results to `PRIVATE_LEADS_ENDPOINT` with `PRIVATE_LEADS_TOKEN` over HTTPS. For deployed GitHub Actions, use a separately operated HTTPS reverse proxy with authentication and an attached durable volume/database; do **not** expose loopback directly.
- Local JSON persistence does not by itself guarantee durable storage across server replacement, concurrent writes, backups, or restarts on ephemeral hosts. Deployment and end-to-end remote tests are pending.
- Do not add real contacts, bearer tokens, or credentials to this public repository. No general Facebook group search is provided.


## Stage 3.3 — Container deployment foundation (not deployed)
- `Dockerfile` runs the Node services as a non-root user; `compose.yaml` shares a named `webcandy-leads` volume.
- Both container services bind internally to 0.0.0.0 but publish **only** on host 127.0.0.1 (ports 8787 read, 8788 write). Do not publish either port to the internet directly.
- On a dedicated server, set strong different `PRIVATE_LEADS_READ_TOKEN` and `PRIVATE_LEADS_TOKEN` in a private server-side environment (never commit values), then run `docker compose config` and `docker compose up -d --build` after approval.
- `PRIVATE_LEADS_ENDPOINT` for scheduled GitHub Actions must eventually be a verified HTTPS endpoint with reverse proxy, scoped authentication, and network controls. A loopback-only Docker service is **not** reachable from GitHub Actions.
- The JSON store and shared volume are a development foundation, **not** a multi-writer cloud database. Backups, locking/transactions, TLS reverse proxy, operations monitoring, secure deployment and disaster recovery are still pending.

## Stage 3.5 — HTTPS and backups (foundation only)
- `deploy/Caddyfile.example` shows an HTTPS gateway for **write-only** `/api/ingest`; replace the sample hostname and validate firewall/TLS and server-side bearer-token controls. It is not deployed.
- `scripts/backup.mjs` copies valid JSON lead data to `PRIVATE_BACKUP_DIR`; `scripts/verify-backup.mjs <file>` checks file structure. Do not store backups in Git or on publicly served paths.
- Backups on the same disk/server do **not** protect against disk loss or server deletion. Configure encrypted off-server versioned backups, retention, integrity checks, and a tested restore procedure before production.
- The current JSON read-modify-write store is not concurrency-safe. Do not run multiple ingestion writers or claim database-level durability; migration to a transactional database remains required.
- The API endpoint must be reachable over trusted HTTPS from GitHub Actions, and the token must be stored in GitHub Actions secrets. None of that connectivity is active yet.
