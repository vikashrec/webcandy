'use strict';
const $ = id => document.getElementById(id);
let state, tab = 'Overview';
const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
const future = () => new Date(Date.now() + 86400000).toISOString();
async function api(path, input) {
  const response = await fetch(path, {method: input ? 'POST' : 'GET', headers: input ? {'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID()} : {}, body: input ? JSON.stringify(input) : undefined});
  const data = await response.json();
  if (response.status === 401) {
    state = undefined;
    $('workspace').hidden = true; $('logout').hidden = true; $('signin').hidden = false;
    $('content').replaceChildren(); $('tabs').replaceChildren(); $('identity').textContent = '';
  }
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
async function refresh() {
  state = await api('/api/v1/state');
  $('signin').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
  $('identity').textContent = `${state.actor.email} · ${state.actor.role} · ${state.actor.tenant}`;
  render();
}
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('/auth/login', Object.fromEntries(new FormData(event.target))); event.target.reset(); await refresh(); status('Signed in.'); } catch (error) { status(error.message, true); }
});
$('logout').onclick = async () => { try { await api('/auth/logout', {}); location.reload(); } catch (error) { status(error.message, true); } };
const options = (kind, label = 'name') => (state[kind] || []).map(x => [x.id, x[label] || x.id]);
const field = (name, label, value = '', type = 'text', choices) => ({name, label, value, type, choices});
const optional = (name, label, value = '') => ({...field(name, label, value), required: false});
const select = (name, label, choices) => field(name, label, '', 'select', choices);
const leadField = () => select('leadId', 'Opportunity', options('leads', 'title'));
const serviceField = () => select('serviceId', 'Service', options('catalog'));
const buyerField = () => select('buyerId', 'Buyer', options('buyers'));
const campaignField = () => select('campaignId', 'Campaign', options('campaigns'));
const channelField = () => select('channel', 'Channel', [['email', 'Email'], ['whatsapp', 'WhatsApp']]);
const purposeField = () => select('purpose', 'Purpose', [['requested_offer', 'Requested offer'], ['marketing', 'Marketing']]);
function section(title) { const root = el('section'); root.append(el('h2', title)); $('content').append(root); return root; }
function form(title, action, fields, transform = x => x, description) {
  const root = section(title);
  if (description) root.append(el('p', description, 'hint'));
  const node = el('form'); node.setAttribute('aria-label', title);
  for (const f of fields) {
    const wrapper = el('div', undefined, 'field');
    const label = el('label', f.label); let input;
    if (f.type === 'select') {
      input = el('select');
      for (const [value, name] of f.choices) { const option = el('option', name); option.value = value; input.append(option); }
    } else { input = el('input'); input.type = f.type; input.value = f.type === 'checkbox' ? 'on' : f.value; }
    input.name = f.name; input.required = f.required ?? f.type !== 'checkbox'; input.id = 'field-' + crypto.randomUUID();
    label.htmlFor = input.id; wrapper.append(label, input); node.append(wrapper);
  }
  const button = el('button', title); node.append(button);
  node.onsubmit = async event => {
    event.preventDefault(); button.disabled = true;
    try {
      const input = transform(Object.fromEntries(new FormData(node)));
      const result = await api('/api/v1/' + action, input);
      await refresh();
      status(title + ' succeeded.' + (result.purged !== undefined ? ` Purged ${result.purged} expired records.` : ''));
      if (action === 'buyers/match') table('Matching opportunities', result, ['title', 'location', 'qualification']);
    } catch (error) { status(error.message, true); } finally { button.disabled = false; }
  };
  root.append(node);
}
function table(title, rows, columns) {
  const root = section(title);
  if (!rows.length) { root.append(el('p', 'No records yet.', 'empty')); return; }
  const wrap = el('div', undefined, 'table-wrap'); const table = el('table');
  const header = el('tr'); for (const key of columns) header.append(el('th', key));
  const head = el('thead'); head.append(header); table.append(head);
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const key of columns) { const value = row[key]; tr.append(el('td', value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—'))); }
    body.append(tr);
  }
  table.append(body); wrap.append(table); root.append(wrap);
}
function render() {
  $('tabs').replaceChildren(); $('content').replaceChildren();
  const admin = state.actor.role === 'admin';
  const tabs = admin ? ['Overview', 'Opportunities', 'Buyers', 'Catalog & offers', 'Campaigns', 'Governance', 'Reports'] : ['Overview', 'My opportunities', 'Conversions'];
  if (!tabs.includes(tab)) tab = 'Overview';
  for (const name of tabs) {
    const button = el('button', name); if (name === tab) button.setAttribute('aria-current', 'page');
    button.onclick = () => { tab = name; render(); }; $('tabs').append(button);
  }
  if (tab === 'Overview') {
    const root = section(admin ? 'Admin workspace' : 'Buyer portal');
    root.append(el('p', admin ? 'Review permitted intake, qualify opportunities, match buyers and approve simulated campaigns. A different admin must approve a campaign.' : 'Your company’s allocated opportunities and synthetic conversion results. Other buyers’ inventories are not visible.'));
    const metrics = el('div', undefined, 'metrics');
    for (const [label, count] of [['Visible opportunities', state.report.leads], ['Conversion events', state.report.conversions], ['Won opportunities', state.report.wins]]) {
      const tile = el('div', undefined, 'metric'); tile.append(el('strong', count), el('span', label)); metrics.append(tile);
    } root.append(metrics);
  }
  if (tab === 'Opportunities') {
    form('Intake synthetic opportunity', 'opportunities/intake', [select('sourceId', 'Permitted source', options('sources')), field('externalId', 'Source record ID', 'demo-' + Date.now()), field('sourceUrl', 'Source URL', 'https://example.test/opportunities/' + Date.now(), 'url'), field('title', 'Requirement', 'Need a company website'), field('tags', 'Service tags (comma separated)', 'website'), field('country', 'Country code', 'IN'), field('state', 'Subdivision ID', 'IN-BR'), field('city', 'City ID', 'patna'), field('budget', 'Declared budget', '1000', 'number'), select('eligibility', 'Delivery eligibility', [['remote', 'Remote'], ['onsite', 'On-site'], ['both', 'Both']])], x => ({...x, synthetic: true, tags: x.tags.split(',').map(s => s.trim()), budget: Number(x.budget), location: {country: x.country, state: x.state, city: x.city}, remote: x.eligibility !== 'onsite', onsite: x.eligibility !== 'remote'}));
    form('Qualify opportunity', 'leads/qualify', [leadField()], x => x, 'Deterministic mock score with reasons; human review remains required.');
    table('Opportunities', state.leads, ['id', 'title', 'location', 'stage', 'qualification', 'suppressed', 'expiresAt']);
  }
  if (tab === 'My opportunities') {
    form('Find my matches', 'buyers/match', [], () => ({}));
    table('Allocated opportunities', state.leads, ['id', 'title', 'location', 'stage', 'qualification']);
    table('My allocations', state.allocations, ['id', 'leadId', 'mode']);
  }
  if (tab === 'Buyers') {
    form('Create buyer', 'buyers', [field('name', 'Company name'), field('tags', 'Service tags', 'website'),
      optional('country', 'Include country code', 'IN'), optional('state', 'Include subdivision ID'), optional('city', 'Include city ID'),
      optional('exclude', 'Exclude country code (use NONE)', 'NONE'), optional('excludeState', 'Exclude subdivision ID'), optional('excludeCity', 'Exclude city ID'),
      select('locationKind', 'Match location', [['lead', 'Opportunity location'], ['service', 'Service delivery location']]),
      select('remote', 'Eligibility', [['any', 'Any'], ['remote', 'Remote'], ['onsite', 'On-site']])], x => {
        const region = {country: x.country, state: x.state, city: x.city};
        const excluded = {country: x.exclude === 'NONE' ? '' : x.exclude, state: x.excludeState, city: x.excludeCity};
        return {name: x.name, tags: x.tags.split(','), target: {
          include: Object.values(region).some(Boolean) ? [region] : [],
          exclude: Object.values(excluded).some(Boolean) ? [excluded] : [], remote: x.remote, locationKind: x.locationKind}};
      }, 'Leave all inclusion fields blank for global targeting. Subdivision and city IDs require their parent country and subdivision.');
    form('Find buyer matches', 'buyers/match', [buyerField()]);
    form('Allocate opportunity', 'allocations', [leadField(), buyerField(), select('mode', 'Ownership mode', [['exclusive', 'Exclusive'], ['shared', 'Shared']]), field('evidence', 'Allocation rights evidence', 'https://example.test/allocation-review', 'url'), field('sharedRightsEvidence', 'Shared rights evidence (only used for shared)', 'https://example.test/shared-rights-review', 'url')]);
    table('Buyer profiles', state.buyers, ['id', 'name', 'tags', 'target']);
    table('Allocations', state.allocations, ['id', 'leadId', 'buyerId', 'mode']);
  }
  if (tab === 'Catalog & offers') {
    form('Verify synthetic service', 'catalog/services', [field('name', 'Service name'), field('tags', 'Service tags', 'website'), field('price', 'Illustrative price', '500', 'number'), field('currency', 'Currency', 'USD'), field('evidence', 'Local review evidence', 'https://example.test/catalog-review', 'url'), field('validUntil', 'Verification expires (ISO timestamp)', future())], x => ({...x, price: Number(x.price), tags: x.tags.split(','), target: {}}));
    form('Draft offer', 'offers/draft', [leadField(), serviceField()]);
    table('Locally verified catalog', state.catalog, ['id', 'name', 'price', 'currency', 'validUntil']);
    table('Offer drafts', state.offers, ['id', 'leadId', 'subject', 'body', 'status']);
  }
  if (tab === 'Campaigns') {
    form('Create campaign draft', 'campaigns', [field('name', 'Campaign name'), select('offerId', 'Offer', options('offers', 'subject')), channelField(), purposeField()], x => ({...x, offerIds: [x.offerId]}));
    form('Approve mock campaign', 'campaigns/approve', [campaignField(), field('acknowledgeMock', 'I approve mock simulation only', '', 'checkbox')], x => ({campaignId: x.campaignId, acknowledgeMock: x.acknowledgeMock === 'on'}), 'Sign in as a different admin to approve. No approval permits real sending.');
    form('Schedule mock campaign', 'campaigns/schedule', [campaignField(), field('scheduledAt', 'Run after (ISO timestamp)', new Date(Date.now() + 60000).toISOString())]);
    form('Simulate due campaign', 'outreach/dispatch', [campaignField()], x => ({...x, mode: 'mock'}));
    form('Cancel campaign', 'campaigns/cancel', [campaignField()]);
    table('Campaign records', state.campaigns, ['id', 'name', 'status', 'approvedBy', 'scheduledAt', 'mode']);
  }
  if (tab === 'Governance') {
    form('Verify permitted source', 'sources', [field('name', 'Source name'), select('type', 'Connector interface', [['manual', 'Manual intake'], ['official_api', 'Official API stub'], ['webhook', 'Signed webhook stub'], ['permitted_feed', 'Permitted feed stub'], ['mock', 'Mock connector']]), field('evidence', 'Permission evidence', 'https://example.test/source-permission', 'url'), field('permissionExpiresAt', 'Permission expires (ISO timestamp)', future())]);
    form('Record consent decision', 'consents', [leadField(), channelField(), purposeField(), select('status', 'Decision', [['granted', 'Granted'], ['withdrawn', 'Withdrawn'], ['denied', 'Denied']]), field('evidence', 'Consent evidence', 'https://example.test/consent-review', 'url'), field('expiresAt', 'Grant expires (ISO timestamp)', future())]);
    form('Suppress opportunity', 'suppressions', [leadField(), field('reason', 'Reason', 'Synthetic opt-out request')]);
    form('Purge expired data', 'retention/purge', [], () => ({}), 'Deletes expired opportunities and their dependent drafts and records. Keeps audit IDs and suppression fingerprints.');
    table('Permitted sources', state.sources, ['id', 'name', 'type', 'permissionExpiresAt', 'externalEnabled']);
    table('Audit trail', state.audit, ['seq', 'action', 'objectId', 'actor', 'at']);
  }
  if (tab === 'Conversions' || tab === 'Reports') {
    form('Record synthetic conversion', 'conversions/events', [select('allocationId', 'Allocation', options('allocations', 'leadId')), field('eventId', 'Unique event ID', 'event-' + Date.now()), select('type', 'Outcome', [['consultation', 'Consultation'], ['won', 'Won'], ['lost', 'Lost']]), field('value', 'Synthetic value', '1000', 'number'), field('currency', 'Currency', 'USD')], x => ({...x, value: Number(x.value)}));
    table('Conversion events', state.conversions, ['eventId', 'type', 'leadId', 'value', 'currency', 'at']);
    table('Conversion report', [state.report], ['leads', 'conversions', 'wins', 'valuesByCurrency', 'synthetic']);
  }
}
refresh().catch(() => {});
