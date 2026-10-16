import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { JsonStore } from "./store.mjs";
import { MarketingService } from "./service.mjs";
const json=(res,status,value)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(value));};
const eq=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
async function body(req) {
 let chunks=[],size=0;
 for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error("Request too large");chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
}
export function makeServer({token,store}) {
 if(!token||token.length<24)throw new Error("Strong MARKETING_API_TOKEN required");
 const service=new MarketingService(store);
 return createServer(async(req,res)=>{
   if(!eq((req.headers.authorization??"").replace(/^Bearer /,""),token))return json(res,401,{error:"Unauthorized"});
   const tenantId=req.headers["x-tenant-id"];
   if(typeof tenantId!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId))return json(res,400,{error:"Valid X-Tenant-Id required"});
   const url=new URL(req.url,"http://localhost");
   try {
     if(req.method==="GET"&&url.pathname==="/health")return json(res,200,{ok:true});
     if(req.method==="POST"&&url.pathname==="/api/v1/opportunities")return json(res,201,await service.intake(tenantId,await body(req)));
     if(req.method==="GET"&&url.pathname==="/api/v1/opportunities")return json(res,200,await service.list(tenantId,Object.fromEntries(url.searchParams)));
     if(req.method==="POST"&&url.pathname==="/api/v1/buyers")return json(res,201,await service.createBuyer(tenantId,await body(req)));
     const m=url.pathname.match(/^\/api\/v1\/buyers\/([0-9a-f-]+)\/matches$/);
     if(req.method==="GET"&&m)return json(res,200,await service.match(tenantId,m[1]));
     if(req.method==="POST"&&url.pathname==="/api/v1/offers/draft"){const x=await body(req);return json(res,200,await service.offer(tenantId,x.leadId,x.service));}
     return json(res,404,{error:"Not found"});
   }catch(e){return json(res,/not found/i.test(e.message)?404:400,{error:e.message});}
 });
}
export function start() {
 const token=process.env.MARKETING_API_TOKEN;
 const store=new JsonStore(process.env.MARKETING_DATA_FILE??"./.local/marketing.json");
 const server=makeServer({token,store});
 server.listen(Number(process.env.MARKETING_PORT??8790),"127.0.0.1");
 return server;
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href)start();
