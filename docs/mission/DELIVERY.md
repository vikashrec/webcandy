# WC-E2E-01 owner delivery

Status: **READY FOR OWNER AUDIT — synthetic local development scope.**
Draft PR creation is **BLOCKED**, and production/live integration readiness is
**BLOCKED**. The complete matrix and exact test counts are in TEST_EVIDENCE.md.

## Git delivery

- Repository: `vikashrec/webcandy` only.
- Dedicated branch: `mission/wc-e2e-01`, pushed to origin.
- Implementation commit: `3285df4` (the final branch tip also includes this delivery note).
- Base audited: main `cafcab69ca9e1e0b4af617b7776add769150c2e9`.
- PR #1 source audited: `1bbdff7baa62c18ce78120b5d3de8f575601d1f1`.
- Neither main nor PR #1 was merged or modified.
- No draft PR number exists from this mission: creation failed before success.
  `gh pr create --draft` returned `Post "https://api.github.com/graphql": Forbidden`.
  Earlier REST connectivity failed with proxy CONNECT 403 too.

Git read/push authentication works through the supplied platform configuration.
GH_TOKEN is already present; no duplicate token or secret is requested. Git access
does not establish API permission. The environment draft now adds only
`api.github.com`, preserving the package-manager presets. The draft is saved but
not applied or published. Review/save the network change in environment settings;
after a confirmed runtime update, retry the API read and PR creation using existing
authentication. An additional GitHub authorization issue may still need diagnosis
after connectivity works; no live API permission is assumed.

Prepared draft title: `WC-E2E-01: tenant-isolated synthetic marketing workforce`.
Prepared complete body: `docs/mission/PR_DESCRIPTION.md`.

```sh
gh pr create --repo vikashrec/webcandy --base main --head mission/wc-e2e-01 --draft \
  --title 'WC-E2E-01: tenant-isolated synthetic marketing workforce' \
  --body-file docs/mission/PR_DESCRIPTION.md
```

The pushed branch can also be reviewed through GitHub's new-PR page:
https://github.com/vikashrec/webcandy/pull/new/mission/wc-e2e-01
This is a creation page, not a created pull request. Keep the PR a draft and do
not merge without the owner's separate instruction. Remote CI results have not
been read or verified while GitHub API access is blocked.

## Local owner workflow

The mission server is running in the current machine on loopback with an allowlist
of static assets. Use DEVELOPMENT.md for setup/start commands and the Admin/Buyer
walkthrough. An owner-audit synthetic opportunity is persisted in alpha's database.
The generated accounts are in ignored `private-data/development-credentials.json`;
open that file locally and keep values out of chat or commits. Actual Chromium
screenshots and test logs are in ignored `test-results/`.

Environment `install_script` and `start_skill` were updated with tested dependency,
validation, safe server startup and readiness instructions. These are saved draft
configuration fields, not applied runtime changes. Review/save and publish the
development environment to activate reusable setup when desired; that is separate
from a production deployment. A new task restoration has not been independently
verified. Live processes must restart after restoration.

## Outstanding approvals and integration blockers

1. GitHub API connectivity/authorization for the draft PR and remote CI review.
2. Review the Node/SQLite/native-portal development deviation and the documented
   Laravel/MySQL/Redis/Next.js migration path before expanding infrastructure.
3. Real service catalog verification and pricing, source permissions, opt-in
   evidence, geographic/jurisdiction datasets and data processing policy.
4. Separately approved tenant-scoped AI/official provider credentials and connector
   contracts. No live or paid calls were made and no credentials were requested.
5. Explicit owner approval before sending, ads/spending, resale, purchases or
   production deployment, plus the identity/TLS/queue/monitoring/off-site backup
   requirements documented in SECURITY_AUDIT.md.

No code-test blocker remains within the synthetic local scope: **71 automated tests
passed, zero failed or skipped**. Cloud production scale, real integrations and
real conversion/revenue claims have not been verified.
