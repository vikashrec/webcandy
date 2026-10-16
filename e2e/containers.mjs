import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync, writeFileSync, unlinkSync, openSync, closeSync} from 'node:fs';
import {resolve} from 'node:path';

test('container: legacy Node 24 image supports authenticated ingest/dedupe/read as non-root without private image files', {timeout: 120000}, async t => {
  const root = resolve(import.meta.dirname, '..');
  const results = resolve(root, 'test-results/wc-qa-02');
  const config = process.env.QA_DOCKER_CONFIG || resolve(root, 'private-data/docker');
  mkdirSync(results, {recursive: true}); mkdirSync(config, {recursive: true, mode: 0o700});
  const docker = (...args) => execFileSync('docker', ['--config', config, ...args], {cwd: root, encoding: 'utf8', timeout: 90000}).trim();
  docker('version', '--format', '{{.Server.Version}}');
  const suffix = randomBytes(5).toString('hex');
  const image = 'webcandy-wcqa02:' + suffix, volume = 'wcqa02-' + suffix;
  const reader = 'wcqa02-reader-' + suffix, writer = 'wcqa02-writer-' + suffix;
  const envFile = resolve(root, 'private-data/qa-docker-' + suffix + '.env');
  const readToken = randomBytes(32).toString('hex'), writeToken = randomBytes(32).toString('hex');
  writeFileSync(envFile, `PRIVATE_LEADS_READ_TOKEN=${readToken}\nPRIVATE_LEADS_TOKEN=${writeToken}\nSERVICE_BIND_HOST=0.0.0.0\n`, {flag: 'wx', mode: 0o600});
  const containers = []; let hasVolume = false, hasImage = false;
  const report = {scope: 'legacy services only', checks: []};
  t.after(() => {
    const errors = [];
    for (const name of containers) try { docker('rm', '-f', name); } catch { errors.push('container cleanup'); }
    if (hasVolume) try { docker('volume', 'rm', volume); } catch { errors.push('volume cleanup'); }
    if (hasImage) try { docker('image', 'rm', image); } catch { errors.push('image cleanup'); }
    unlinkSync(envFile);
    writeFileSync(resolve(results, 'docker-smoke.json'), JSON.stringify({...report, cleanup: errors.length ? errors : 'complete'}, null, 2) + '\n');
    assert.deepEqual(errors, []);
  });
  const log = openSync(resolve(results, 'docker-build.txt'), 'w');
  try { execFileSync('docker', ['--config', config, 'build', '--pull', '-t', image, '.'], {cwd: root, stdio: ['ignore', log, log], timeout: 90000}); hasImage = true; }
  finally { closeSync(log); }
  report.imageId = docker('image', 'inspect', image, '--format', '{{.Id}}');
  docker('compose', '--env-file', envFile, 'config', '--quiet'); report.checks.push('compose configuration');
  docker('volume', 'create', volume); hasVolume = true;
  for (const [name, port, script] of [[reader, 8787, 'leads-api.mjs'], [writer, 8788, 'ingest-api.mjs']]) {
    docker('run', '-d', '--name', name, '--env-file', envFile, '-v', volume + ':/var/lib/webcandy', '-p', `127.0.0.1::${port}`, image, 'node', 'scripts/' + script);
    containers.push(name);
  }
  const endpoint = name => 'http://127.0.0.1:' + docker('port', name).split(':').at(-1);
  const readUrl = endpoint(reader) + '/api/leads', writeUrl = endpoint(writer) + '/api/ingest';
  const wait = async (url, options, expected) => {
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(url, options); if (r.status === expected) return; } catch { /* Docker port publication precedes Node listen(). */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Container endpoint did not reach expected readiness');
  };
  await wait(readUrl, {}, 401);
  await wait(writeUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}, 401);
  report.checks.push('both services ready and deny anonymous requests');
  const payload = {source: 'facebook-page', pageId: '123', leads: [{id: 'container-synthetic', job: 'Synthetic website requirement', post: 'https://www.facebook.com/example/posts/101'}]};
  for (let i = 0; i < 2; i++) {
    const r = await fetch(writeUrl, {method: 'POST', headers: {Authorization: 'Bearer ' + writeToken, 'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    assert.equal(r.status, 200); assert.equal((await r.json()).total, 1);
  }
  const read = await fetch(readUrl, {headers: {Authorization: 'Bearer ' + readToken}});
  assert.equal(read.status, 200); assert.equal((await read.json()).leads.length, 1);
  report.checks.push('authenticated write, duplicate write and shared-volume read');
  assert.equal(docker('exec', reader, 'node', '-p', 'process.versions.node.split(".")[0]'), '24');
  assert.equal(docker('exec', reader, 'id', '-u'), '1000');
  docker('exec', reader, 'sh', '-c', 'test ! -e /app/private-data && test ! -e /app/.git && test ! -e /app/node_modules');
  report.checks.push('Node 24, non-root process and no private files in final image');
  report.status = 'PASS';
});
