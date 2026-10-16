import { randomUUID } from "node:crypto";
import { normalizeOpportunity, matchGeography, draftOffer } from "./lead-pipeline.mjs";
const required = (value,name) => { if (!String(value??"").trim()) throw new Error(name+" is required"); return String(value).trim(); };
export class MarketingService {
  constructor(store) { this.store=store; }
  async intake(tenantId,input) {
    required(tenantId,"tenantId");
    const item=normalizeOpportunity(input);
    return this.store.transact(s=>{
      const old=s.opportunities.find(x=>x.tenantId===tenantId&&x.sourceUrl===item.sourceUrl);
      if(old)return {created:false,opportunity:old};
      const opportunity={...item,id:randomUUID(),tenantId,contact:null,permissions:{},suppressed:false};
      s.opportunities.push(opportunity);
      s.audit.push({action:"intake",tenantId,objectId:opportunity.id,at:new Date().toISOString()});
      return {created:true,opportunity};
    });
  }
  async list(tenantId,criteria={}) {
    const s=await this.store.read();
    return s.opportunities.filter(x=>x.tenantId===tenantId&&matchGeography(x,criteria));
  }
  async createBuyer(tenantId,input) {
    return this.store.transact(s=>{
      const buyer={id:randomUUID(),tenantId,name:required(input.name,"name"),criteria:input.criteria??{},active:true};
      s.buyers.push(buyer);return buyer;
    });
  }
  async match(tenantId,buyerId) {
    const s=await this.store.read();
    const buyer=s.buyers.find(b=>b.id===buyerId&&b.tenantId===tenantId&&b.active);
    if(!buyer)throw new Error("Buyer not found");
    return s.opportunities.filter(x=>x.tenantId===tenantId&&matchGeography(x,buyer.criteria)).map(x=>({opportunityId:x.id,title:x.title,location:x.location,sourceUrl:x.sourceUrl}));
  }
  async offer(tenantId,leadId,service) {
    const s=await this.store.read();
    const lead=s.opportunities.find(x=>x.id===leadId&&x.tenantId===tenantId);
    if(!lead)throw new Error("Lead not found");
    return draftOffer(lead,service);
  }
}
