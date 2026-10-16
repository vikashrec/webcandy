import {Store} from './database.mjs';
import {Workforce} from './service.mjs';
import {processDue} from './jobs.mjs';
import {fileURLToPath} from 'node:url';

export function startWorker() {
  const file = process.env.WORKFORCE_DB || new URL('../../private-data/workforce.sqlite', import.meta.url).pathname;
  const store = new Store(file), service = new Workforce(store);
  const tick = () => {
    try {
      processDue(service);
      store.db.prepare("INSERT INTO worker_state VALUES('mock-worker',?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen").run(Date.now());
    } catch { console.error('Mock worker tick failed; no live action is enabled.'); }
  };
  tick(); const timer = setInterval(tick, 1000);
  const stop = () => { clearInterval(timer); store.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  console.log('Mock workforce worker started. External dispatch disabled.');
  return {store, timer};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startWorker();
