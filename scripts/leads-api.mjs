import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {timingSafeEqual} from 'node:crypto';

function authorized(given, expected) {
  if (!expected || !given?.startsWith('Bearer ')) return false;
  const a=Buffer.from(given.slice(7)); const b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function createLeadServer({token=process.env.PRIVATE_LEADS_READ_TOKEN,file=process.env.PRIVATE_LEADS_FILE}={}) {
  if (!token || !file) throw new Error('PRIVATE_LEADS_READ_TOKEN and PRIVATE_LEADS_FILE required');
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.url!=='/api/leads' || req.method!=='GET') {
      res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"Not found"}');return;
    }
    if(!authorized(req.headers.authorization,token)){
      res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"Unauthorized"}');return;
    }
    try {
      const rows=JSON.parse(await readFile(resolve(file),'utf8'));
      if(!Array.isArray(rows)) throw Error('Invalid lead database');
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({leads:rows}));
    }catch(err){
      const status=err.code==='ENOENT'?200:500;
      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(status===200?'{"leads":[]}':'{"error":"Storage unavailable"}');
    }
  });
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  const server=createLeadServer();
  const port=Number(process.env.LEADS_API_PORT||8787);
  server.listen(port,'127.0.0.1',()=>console.log('Private leads API listening on 127.0.0.1:'+port));
}
