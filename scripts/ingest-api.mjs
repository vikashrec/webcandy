import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {saveLocalLeads} from './storage.mjs';

function bearerMatches(header, expected) {
 if(!expected || !header?.startsWith('Bearer ')) return false;
 const a=Buffer.from(header.slice(7)),b=Buffer.from(expected);
 return a.length===b.length && timingSafeEqual(a,b);
}
export function createIngestServer({token=process.env.PRIVATE_LEADS_TOKEN,file=process.env.PRIVATE_LEADS_FILE}={}) {
 if(!token || !file)throw Error('PRIVATE_LEADS_TOKEN and PRIVATE_LEADS_FILE required');
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url!=='/api/ingest' || req.method!=='POST'){res.writeHead(404);res.end('{"error":"Not found"}');return}
  if(!bearerMatches(req.headers.authorization,token)){res.writeHead(401);res.end('{"error":"Unauthorized"}');return}
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'){res.writeHead(415);res.end('{"error":"JSON required"}');return}
  const chunks=[];let size=0;
  try{
   for await(const chunk of req){size+=chunk.length;if(size>256*1024){res.writeHead(413);res.end('{"error":"Too large"}');return}chunks.push(chunk)}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(body.source!=='facebook-page' || !Array.isArray(body.leads) || body.leads.length>1000 || !/^\d{1,30}$/.test(String(body.pageId||'')))throw Error('Invalid payload');
   const clean=body.leads.map(l=>{
    if(!l || typeof l!=='object' || typeof l.id!=='string' || !l.id.trim() || typeof l.job!=='string' || l.job.length>1200 || typeof l.post!=='string' || !/^https:\/\/www\.facebook\.com\//.test(l.post))throw Error('Invalid lead');
    return {id:l.id.slice(0,120),job:l.job,post:l.post,profile:String(l.profile||'').slice(0,1000),email:String(l.email||'').slice(0,254),phone:String(l.phone||'').slice(0,50),savedAt:String(l.savedAt||'').slice(0,80)};
   });
   const count=await saveLocalLeads(clean,file);
   res.writeHead(200);res.end(JSON.stringify({ok:true,received:clean.length,total:count}));
  }catch(e){const invalid=e instanceof SyntaxError || /Invalid (payload|lead)/.test(e.message);res.writeHead(invalid?400:500);res.end(JSON.stringify({error:invalid?'Invalid payload':'Storage failed'}))}
 });
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
 const server=createIngestServer();
 const port=Number(process.env.INGEST_PORT||8788);
 server.listen(port,'127.0.0.1',()=>console.log('Private ingest listening on 127.0.0.1:'+port));
}
