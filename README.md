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
