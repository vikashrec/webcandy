# WebCandy — Marketing Workforce Architecture
Status: PROPOSED / NOT DEPLOYED
Date: 2026-10-16
Owner: WebCandy; independent from Definition India.

## Vision
A global, multi-tenant B2B lead intelligence, marketing, outreach and distribution network. Serve Definition India first, then external companies through qualified lead delivery and managed marketing services.

## Core workflow
Permitted source discovery (organic, jobs, public business opportunities, inbound forms, paid ads) -> source provenance -> normalization -> deduplication -> permission and consent assessment -> AI qualification -> buyer matching -> allocation -> authorized WhatsApp/email outreach -> offer -> consultation -> conversion reporting.

## Geographic targeting
Global / country / state-province / city; multiple inclusions and exclusions. Store normalized location IDs, language, currency, timezone, service location versus lead location, remote/on-site eligibility, and jurisdictional rules.

## Channels
Facebook, Instagram, LinkedIn, Google Search/Ads, YouTube, X, Reddit, Telegram, WhatsApp, job platforms, websites and email. Connector capabilities vary. Use official APIs, permitted webhooks, approved public feeds and manual intake. Facebook Groups API is not available for general automated group-post collection. No unauthorized scraping or contact harvesting.

## Services
1. Source registry, connectors and scheduled discovery
2. Organic content and paid campaign attribution
3. Opportunity/lead intake and provenance
4. Identity validation and deduplication
5. Contact permissions, consent, suppression and retention
6. Mr. India AI qualification, scoring and offer drafting
7. Buyer profiles, targeting, matching and allocation
8. Lead marketplace: discovery signals, verified, exclusive/shared leads and qualified appointments
9. WhatsApp Business API and email delivery via tenant-specific sender identities
10. Unified inbox, follow-up scheduling, offer approvals
11. Billing ledger, disputes, conversion analytics and audit

## System boundaries
WebCandy owns marketing connectors, lead inventory, campaigns, communications, marketplace, billing records and buyer portal. Mr. India is an API-accessed intelligence and approval-routing service; Definition India supplies verified service catalog, pricing, onboarding and project status. No direct database sharing. Definition India tenant memory is never reused for unrelated buyer tenants. Use tenant-scoped authorization, signed service-to-service authentication, idempotency keys, rate limits and audited events.

## API contract (draft)
POST /api/v1/opportunities/intake
POST /api/v1/leads/qualify
POST /api/v1/buyers/match
POST /api/v1/offers/draft
POST /api/v1/outreach/dispatch
POST /api/v1/conversions/events
GET /api/v1/catalog/services
All endpoints require scoped authentication, tenant context, consent eligibility where relevant, and versioned payloads. AI drafts do not bypass sending approval or channel rules.

## Multi-tenancy
Platform admin, buyer company, buyer team. Isolate tenant records and connected ad/WhatsApp/email accounts. Client-owned campaign leads must not become resellable marketplace inventory without suitable rights and permissions. Sharing a lead with multiple buyers requires explicit eligibility.

## Data model (proposed)
tenants, tenant_users, source_connectors, source_permissions, discovery_jobs, opportunities, leads, lead_contacts, lead_consents, lead_consent_events, lead_qualifications, lead_scores, buyer_profiles, buyer_requirements, buyer_matches, lead_allocations, lead_deliveries, lead_feedback, campaigns, ad_accounts, campaign_costs, lead_orders, billing_ledger, communication_channels, message_templates, outreach_campaigns, outreach_messages, conversation_threads, offer_versions, contact_suppressions, audit_logs.

## Outreach safeguards
Do not treat a public phone/email as permission to market or resell. WhatsApp business-initiated messaging requires applicable opt-in and approved templates. Respect email anti-spam rules, unsubscribe, sender authentication, platform terms, withdrawal and retention policies. Keep public opportunity intelligence distinct from personal contact records.

## Technology proposal
Laravel API + MySQL + Redis queues/scheduler; Next.js + TypeScript buyer/admin portal; Mr. India isolated AI API; OAuth/webhooks; AWS primary, Vultr standby, independent backup after infrastructure verification.

## Delivery sequence
Phase 1: internal organic discovery, lead intake, source provenance, dashboard.
Phase 2: AI qualification, scoring, dedupe, buyer criteria.
Phase 3: buyer portal, allocations, orders and commercial records.
Phase 4: approved paid-ad integrations, consent-aware WhatsApp/email, attribution, end-to-end tests.
Prior planning estimate: 36–55 working days total, not a commitment; subject to connector approvals, code quality and verification.

## Governance and acceptance
Develop first in isolated environment; preserve tenant isolation and essential permissions throughout. Before any public deployment, verify secrets, auth, consent, data ownership, legal/platform constraints, audit trails, backup/recovery, and full browser/API tests. No autonomous spend, production changes, lead resale or outbound campaigns without defined approvals.
