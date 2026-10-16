import {randomUUID,randomBytes} from 'node:crypto';
import {openSync,writeFileSync,closeSync,mkdirSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from './database.mjs';
import {check,text} from './domain.mjs';

// Local operator bootstrap only. No public cross-tenant creation endpoint.
export function initializeOrganization(store,{name,adminEmail,reviewerEmail}) {
  name=text(name,'organization name');
  const emails=[adminEmail,reviewerEmail].map(email=>{
    check(typeof email==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Valid admin emails required');return email.toLowerCase();
  });
  check(emails[0]!==emails[1],'Distinct admin and reviewer required');
  const id=randomUUID();
  return store.transaction(()=>{
    store.db.prepare('INSERT INTO tenants VALUES(?,?)').run(id,name);
    const credentials=emails.map(email=>{
      const password=randomBytes(24).toString('base64url');
      const actor=store.addPrincipal({tenant:id,email,role:'admin',password});
      store.db.prepare('INSERT INTO memberships VALUES(?,?,?,?,?)').run(id,actor.id,'admin',null,null);
      store.audit(actor,'organization.initialized',id);
      return {tenant:id,email,password,accessRole:'admin'};
    });
    return {id,name,credentials};
  });
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  const [database,credentialFile,name,adminEmail,reviewerEmail]=process.argv.slice(2);
  check(database && credentialFile && name && adminEmail && reviewerEmail,'Usage: node src/workforce/initialize.mjs <db> <new-private-credentials.json> <organization> <admin-email> <reviewer-email>');
  check(![database,database+'-wal',database+'-shm'].some(path=>resolve(path)===resolve(credentialFile)),'Credential file must differ from database files');
  mkdirSync(dirname(credentialFile),{recursive:true,mode:0o700});
  const fd=openSync(credentialFile,'wx',0o600);let store;
  try{
    store=new Store(database);
    // Writing the reserved credential file happens before the database commits.
    store.transaction(()=>{const result=initializeOrganization(store,{name,adminEmail,reviewerEmail});writeFileSync(fd,JSON.stringify(result.credentials,null,2)+'\n');});
    console.log('Organization initialized. Generated credentials saved privately; no email sent.');
  }catch(error){unlinkSync(credentialFile);throw error;}finally{closeSync(fd);store?.close();}
}
