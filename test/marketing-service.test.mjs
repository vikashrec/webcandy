import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/marketing/store.mjs";
import { MarketingService } from "../src/marketing/service.mjs";
test("tenant-scoped intake, deduplication, matching and offer drafts",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"webcandy-"));
 try {
 const service=new MarketingService(new JsonStore(join(dir,"leads.json")));
 const data={title:"CRM requirement",sourceUrl:"https://example.org/opportunity/1",location:{country:"India",state:"Bihar",city:"Patna"}};
 const a=await service.intake("company-a",data);
 assert.equal(a.created,true);
 assert.equal((await service.intake("company-a",data)).created,false);
 assert.equal((await service.list("company-b")).length,0);
 await service.intake("company-b",data);
 const buyer=await service.createBuyer("company-a",{name:"Agency",criteria:{city:"Patna"}});
 assert.equal((await service.match("company-a",buyer.id)).length,1);
 await assert.rejects(()=>service.match("company-b",buyer.id));
 assert.equal((await service.offer("company-a",a.opportunity.id,{name:"CRM",verified:true})).status,"draft_pending_approval");
 await assert.rejects(()=>service.offer("company-b",a.opportunity.id,{name:"CRM",verified:true}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
