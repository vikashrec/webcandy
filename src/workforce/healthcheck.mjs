import {DatabaseSync} from 'node:sqlite';

try {
  if (process.argv[2] === 'worker') {
    const db = new DatabaseSync(process.env.WORKFORCE_DB, {readOnly:true});
    try {
      const recent = (db.prepare("SELECT last_seen FROM worker_state WHERE id='mock-worker'").get()?.last_seen || 0) > Date.now()-30000;
      const initialized = db.prepare("SELECT count(*) n FROM principals WHERE role='admin' AND active=1").get().n > 0;
      if (!recent || !initialized) process.exitCode=1;
    } finally {db.close();}
  } else {
    const response=await fetch('http://127.0.0.1:'+(process.env.WORKFORCE_PORT||8790)+'/health',{signal:AbortSignal.timeout(3000)});
    if (!response.ok || !(await response.json()).ok) process.exitCode=1;
  }
} catch { process.exitCode=1; }
