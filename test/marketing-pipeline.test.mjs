import test from "node:test";
import assert from "node:assert/strict";
import {normalizeOpportunity,canContact,matchGeography,draftOffer} from "../src/marketing/lead-pipeline.mjs";
test("normalizes a source opportunity",()=>{
 const lead=normalizeOpportunity({sourceUrl:"https://example.com/post/1",title:"Website development",location:{country:"India",state:"Bihar",city:"Patna"}});
 assert.equal(lead.stage,"discovered");
 assert.equal(matchGeography(lead,{country:"india",city:"patna"}),true);
 assert.equal(matchGeography(lead,{city:"Mumbai"}),false);
});
test("requires explicit channel permission and blocks suppression",()=>{
 const lead={permissions:{email:{granted:true,source:"inbound-form",purpose:"requested_offer"}}};
 assert.equal(canContact(lead,"email"),true);
 assert.equal(canContact(lead,"whatsapp"),false);
 assert.equal(canContact({...lead,suppressed:true},"email"),false);
});
test("drafts offers only for verified services without sending",()=>{
 assert.throws(()=>draftOffer({id:"1",title:"CRM"}, {name:"CRM"}));
 assert.equal(draftOffer({id:"1",title:"CRM"}, {name:"CRM",verified:true}).status,"draft_pending_approval");
});
