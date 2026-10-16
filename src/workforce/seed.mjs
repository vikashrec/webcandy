import {randomBytes} from 'node:crypto';
import {existsSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {Store} from './database.mjs';
import {Workforce} from './service.mjs';
import {check} from './domain.mjs';

export function seed(store) {
  check(store.db.prepare('SELECT count(*) AS n FROM tenants').get().n === 0, 'Database already initialized', 409);
  const service = new Workforce(store);
  const credentials = [];
  const fixtures = {};
  store.transaction(() => {
    for (const tenant of ['alpha', 'bravo']) {
      store.db.prepare('INSERT INTO tenants VALUES(?,?)').run(tenant, `Synthetic ${tenant} company`);
      const create = (name, role, buyer) => {
        const password = randomBytes(24).toString('base64url');
        const apiToken = randomBytes(32).toString('hex');
        const email = `${name}@${tenant}.example.test`;
        const actor = store.addPrincipal({tenant, email, role, buyer, password, apiToken});
        credentials.push({email, password, apiToken, role, tenant});
        return actor;
      };
      const admin = create('admin', 'admin');
      const reviewer = create('reviewer', 'admin');
      const buyer = service.createBuyer(admin, {name: 'Synthetic Web Studio', tags: ['website', 'crm'], target: {remote: 'remote'}});
      const buyer2 = service.createBuyer(admin, {name: 'Synthetic City Studio', tags: ['website'], target: {include: [{country: 'IN', state: 'IN-BR', city: 'patna'}]}});
      const buyerActor = create('buyer', 'buyer', buyer.id);
      const otherBuyer = create('other-buyer', 'buyer', buyer2.id);
      const source = service.createSource(admin, {name: 'Synthetic authorized manual intake', type: 'manual', evidence: 'https://example.test/permission', permissionExpiresAt: new Date(Date.now() + 365 * 86400_000).toISOString()});
      const catalog = service.createService(admin, {name: 'Synthetic Website Discovery', tags: ['website'], price: 500, currency: 'USD',
        evidence: 'https://example.test/catalog-review', validUntil: new Date(Date.now() + 365 * 86400_000).toISOString(), target: {}});
      fixtures[tenant] = {admin, reviewer, buyerActor, otherBuyer, buyer, buyer2, source, catalog};
    }
  });
  return {credentials, fixtures};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.env.WORKFORCE_DB || new URL('../../private-data/workforce.sqlite', import.meta.url).pathname;
  const credentialFile = process.env.WORKFORCE_CREDENTIAL_FILE || fileURLToPath(new URL('../../private-data/development-credentials.json', import.meta.url));
  check(!existsSync(credentialFile), 'Existing development credentials preserved; use existing database or explicitly choose a new isolated checkout');
  const store = new Store(file);
  try {
    const result = seed(store);
    mkdirSync(dirname(credentialFile), {recursive:true,mode:0o700});
    writeFileSync(credentialFile, JSON.stringify(result.credentials, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    console.log('Created two synthetic tenants. Development login credentials were saved to the configured private credential file (mode 0600). Do not commit, publish or share this file.');
  } finally { store.close(); }
}
