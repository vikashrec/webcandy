import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixture, prepared, intake} from '../tests/workforce/helpers.mjs';
import {makeServer} from '../src/workforce/server.mjs';

async function browserFixture(t) {
  const f = fixture(t);
  const server = makeServer({store: f.store, clock: f.clock, rateLimit: 1000});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({headless: true, executablePath, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1365, height: 1000}});
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    if (!route.request().url().startsWith(origin + '/')) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, [], 'no uncaught browser errors'); assert.deepEqual(external, [], 'no external requests'); });
  const login = async (email = 'admin@alpha.example.test') => {
    await page.goto(origin + '/workforce');
    const account = f.credentials.find(c => c.email === email);
    await page.getByLabel('Email', {exact: true}).fill(account.email);
    await page.getByLabel('Password', {exact: true}).fill(account.password);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.getByRole('button', {name: 'Overview', exact: true}).waitFor();
  };
  const signout = async () => { await page.getByRole('button', {name: 'Sign out'}).click(); await page.getByRole('button', {name: 'Sign in', exact: true}).waitFor(); };
  const tab = name => page.getByRole('button', {name, exact: true}).click();
  const form = name => page.getByRole('form', {name, exact: true});
  const submit = async name => {
    const response = page.waitForResponse(r => r.url().includes('/api/v1/') && r.request().method() === 'POST');
    await form(name).getByRole('button', {name, exact: true}).click();
    const received = await response;
    assert.equal(received.status(), 200, `${name}: ${JSON.stringify(await received.json())}`);
    await page.getByRole('status').filter({hasText: name + ' succeeded.'}).waitFor();
  };
  return {...f, page, context, origin, login, signout, tab, form, submit};
}
test('browser E2E: admin intake → qualification → allocation → consent → offer → independent approval → simulation → buyer conversion', async t => {
  const f = await browserFixture(t); await f.login();
  await f.tab('Opportunities');
  await f.form('Intake synthetic opportunity').getByLabel('Requirement', {exact: true}).fill('Synthetic browser website requirement');
  await f.submit('Intake synthetic opportunity'); await f.submit('Qualify opportunity');
  await f.tab('Buyers'); await f.submit('Find buyer matches');
  assert.match(await f.page.locator('#content').innerText(), /Synthetic browser website requirement/);
  await f.submit('Allocate opportunity');
  await f.tab('Governance'); await f.submit('Record consent decision');
  await f.tab('Catalog & offers'); await f.submit('Draft offer');
  await f.tab('Campaigns');
  await f.form('Create campaign draft').getByLabel('Campaign name', {exact: true}).fill('Synthetic browser campaign');
  await f.submit('Create campaign draft');
  await f.form('Approve mock campaign').getByLabel('I approve mock simulation only').check();
  await f.form('Approve mock campaign').getByRole('button', {name: 'Approve mock campaign'}).click();
  await f.page.getByRole('status').filter({hasText: 'A different admin must approve'}).waitFor();
  await f.signout(); await f.login('reviewer@alpha.example.test'); await f.tab('Campaigns');
  await f.form('Approve mock campaign').getByLabel('I approve mock simulation only').check(); await f.submit('Approve mock campaign');
  await f.form('Schedule mock campaign').getByLabel('Run after (ISO timestamp)').fill(new Date(f.clock() + 1000).toISOString());
  await f.submit('Schedule mock campaign'); f.now.value += 2000; await f.submit('Simulate due campaign');
  assert.equal(f.store.list('alpha', 'receipts').length, 1);
  assert.equal(f.store.list('alpha', 'receipts')[0].simulated, true);
  await mkdir('test-results', {recursive: true}); await f.page.screenshot({path: 'test-results/admin-campaign.png', fullPage: true});
  await f.signout(); await f.login('buyer@alpha.example.test'); await f.tab('My opportunities');
  assert.match(await f.page.locator('#content').innerText(), /Synthetic browser website requirement/);
  assert.equal(await f.page.getByRole('button', {name: 'Governance', exact: true}).count(), 0);
  await f.tab('Conversions'); await f.form('Record synthetic conversion').getByLabel('Outcome', {exact: true}).selectOption('won');
  await f.submit('Record synthetic conversion');
  assert.equal(f.service.report(f.a.buyerActor).wins, 1);
  await f.page.screenshot({path: 'test-results/buyer-conversion.png', fullPage: true});
  await f.signout(); await f.login('admin@bravo.example.test'); await f.tab('Opportunities');
  assert.doesNotMatch(await f.page.locator('#content').innerText(), /Synthetic browser website requirement/);
});
test('browser: suppression removes buyer visibility', async t => {
  const f = await browserFixture(t); prepared(f);
  await f.login(); await f.tab('Governance'); await f.submit('Suppress opportunity');
  await f.signout(); await f.login('buyer@alpha.example.test'); await f.tab('My opportunities');
  assert.doesNotMatch(await f.page.locator('#content').innerText(), /Need a company website/);
  assert.equal(f.service.leads(f.a.buyerActor).length, 0);
});
test('browser: buyer sessions are isolated across companies and allocations within a tenant', async t => {
  const f = await browserFixture(t); prepared(f); intake(f, f.b.admin, {title: 'Bravo private requirement'});
  await f.login('other-buyer@alpha.example.test'); await f.tab('My opportunities');
  assert.doesNotMatch(await f.page.locator('#content').innerText(), /Need a company website|Bravo private requirement/);
  await f.signout(); await f.login('admin@bravo.example.test'); await f.tab('Opportunities');
  assert.match(await f.page.locator('#content').innerText(), /Bravo private requirement/);
  assert.doesNotMatch(await f.page.locator('#content').innerText(), /Need a company website/);
});
test('browser: malicious lead titles render as text with no executable DOM', async t => {
  const f = await browserFixture(t);
  const payload = '<img src=x onerror="window.compromised=true">';
  intake(f, f.a.admin, {title: payload});
  await f.login(); await f.tab('Opportunities');
  assert.match(await f.page.locator('#content').innerText(), /<img src=x/);
  assert.equal(await f.page.locator('#content img').count(), 0);
  assert.equal(await f.page.evaluate(() => window.compromised), undefined);
});
test('browser: source registration, service verification and global buyer targeting forms persist', async t => {
  const f = await browserFixture(t); await f.login();
  await f.tab('Governance'); await f.form('Verify permitted source').getByLabel('Source name', {exact: true}).fill('Synthetic official API stub');
  await f.form('Verify permitted source').getByLabel('Connector interface').selectOption('official_api'); await f.submit('Verify permitted source');
  assert.equal(f.store.list('alpha', 'sources').at(-1).externalEnabled, false);
  await f.tab('Catalog & offers'); await f.form('Verify synthetic service').getByLabel('Service name', {exact: true}).fill('Synthetic CRM discovery');
  await f.submit('Verify synthetic service'); assert.equal(f.store.list('alpha', 'catalog').length, 2);
  await f.tab('Buyers'); await f.form('Create buyer').getByLabel('Company name').fill('Synthetic US buyer');
  await f.form('Create buyer').getByLabel('Include country code').fill('US'); await f.submit('Create buyer');
  assert.equal(f.store.list('alpha', 'buyers').at(-1).target.include[0].country, 'US');
});
test('browser: failed login and signed-out API access do not expose tenant state', async t => {
  const f = await browserFixture(t); await f.page.goto(f.origin + '/workforce');
  await f.page.getByLabel('Email', {exact: true}).fill('admin@alpha.example.test'); await f.page.getByLabel('Password', {exact: true}).fill('wrong-password');
  await f.page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await f.page.getByRole('status').filter({hasText: 'Invalid credentials'}).waitFor();
  assert.equal(await f.page.locator('#workspace').isVisible(), false);
  assert.equal((await f.context.request.get(f.origin + '/api/v1/state')).status(), 401);
});
test('browser: original organizer still saves, deduplicates, exports and deletes synthetic leads', async t => {
  const f = await browserFixture(t); await f.page.goto(f.origin + '/legacy');
  await f.page.getByLabel('Requirement', {exact: true}).fill('Legacy synthetic website job');
  await f.page.getByLabel('Post URL', {exact: true}).fill('https://example.test/legacy-1');
  await f.page.getByRole('button', {name: 'Save lead', exact: true}).click();
  assert.equal(await f.page.locator('#results article').count(), 1);
  await f.page.reload(); assert.equal(await f.page.locator('#results article').count(), 1);
  await f.page.getByLabel('Requirement', {exact: true}).fill('Duplicate synthetic lead');
  await f.page.getByLabel('Post URL', {exact: true}).fill('https://example.test/legacy-1');
  const dialog = f.page.waitForEvent('dialog');
  const click = f.page.getByRole('button', {name: 'Save lead', exact: true}).click();
  const alert = await dialog; assert.equal(alert.message(), 'Post already saved'); await alert.accept(); await click;
  assert.equal(await f.page.locator('#results article').count(), 1);
  const download = f.page.waitForEvent('download'); await f.page.getByRole('button', {name: 'Export JSON'}).click();
  assert.equal((await download).suggestedFilename(), 'webcandy-leads.json');
  await f.page.getByRole('button', {name: 'Delete', exact: true}).click(); assert.equal(await f.page.locator('#results article').count(), 0);
});

test('browser: original organizer handles corrupt storage and neutralizes CSV formulas', async t => {
  const f = await browserFixture(t); await f.page.goto(f.origin + '/legacy');
  await f.page.evaluate(() => localStorage.setItem('fb-job-search-leads-v1', '{broken'));
  await f.page.reload();
  assert.equal(await f.page.locator('#results').innerText(), 'No leads saved yet.');
  // The corrupt value is not silently replaced on initial load.
  assert.equal(await f.page.evaluate(() => localStorage.getItem('fb-job-search-leads-v1')), '{broken');
  await f.page.getByLabel('Requirement', {exact: true}).fill('=1+1');
  await f.page.getByLabel('Post URL', {exact: true}).fill('https://example.test/formula');
  await f.page.getByRole('button', {name: 'Save lead', exact: true}).click();
  const downloaded = f.page.waitForEvent('download'); await f.page.getByRole('button', {name: 'Export CSV', exact: true}).click();
  const csv = await readFile(await (await downloaded).path(), 'utf8');
  assert.match(csv, /"'=1\+1"/);
  assert.doesNotMatch(csv, /\r\n"=1\+1"/);
});
