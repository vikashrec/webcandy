# Facebook Job Search

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
