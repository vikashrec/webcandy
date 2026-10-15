import {saveLocalLeads} from './storage.mjs';
const token=process.env.FB_PAGE_ACCESS_TOKEN;
const pageId=process.env.FB_PAGE_ID;
const version=process.env.FB_API_VERSION||'v26.0';
const keywords=(process.env.JOB_KEYWORDS||'website,developer,software,app,crm,hiring,freelance,project').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export function isRequest(message){
 const s=String(message||'').toLowerCase();
 const intent=/(?:\b(?:looking for|need|needed|require|requirement|wanted|hiring|seeking|job opening|vacancy|request for proposal|rfp)\b|चाहिए|आवश्यकता|जरूरत|भर्ती|बनवाना|ढूंढ रहे|खोज रहे)/i;
 const promotional=/(?:\b(?:we offer|our services|contact us|enquiries open|get in touch|we develop|we provide)\b|संपर्क करे|संपर्क करें|हमारी सेवाएं|हमारे साथ|हम बनाते हैं)/i;
 return intent.test(s)&&!promotional.test(s);
}
export function extractLead(post){
 const message=String(post.message||'');
 if(!keywords.some(k=>message.toLowerCase().includes(k)) || !isRequest(message))return null;
 const email=message.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]||'';
 const phone=message.match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0]?.trim()||'';
 return {id:String(post.id),job:message.slice(0,1200),post:post.permalink_url||'',profile:'',email,phone,savedAt:post.created_time||new Date().toISOString()};
}
export async function collect(fetcher=fetch){
 if(!token||!pageId)throw Error('FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID are required');
 if(!/^v\d+\.\d+$/.test(version))throw Error('Invalid API version');
 const url=new URL('https://graph.facebook.com/'+version+'/'+encodeURIComponent(pageId)+'/posts');
 url.searchParams.set('fields','id,message,permalink_url,created_time');
 url.searchParams.set('limit','50');
 const res=await fetcher(url,{headers:{Authorization:'Bearer '+token}});
 if(!res.ok)throw Error('Facebook API failed: HTTP '+res.status);
 const json=await res.json();
 if(!Array.isArray(json.data))throw Error('Unexpected API response');
 const byId=new Map();
 for(const p of json.data){const lead=extractLead(p);if(lead)byId.set(lead.id,lead)}
 const result=[...byId.values()].sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).slice(0,1000);
 const privateFile=process.env.PRIVATE_LEADS_FILE;
 if(privateFile){const count=await saveLocalLeads(result,privateFile);console.log('Saved '+result.length+' matching leads; '+count+' unique leads in private local storage');return;}
 const storeUrl=process.env.PRIVATE_LEADS_ENDPOINT;
 const storeToken=process.env.PRIVATE_LEADS_TOKEN;
 if(storeUrl){
   if(!storeToken)throw Error('PRIVATE_LEADS_TOKEN is required when PRIVATE_LEADS_ENDPOINT is set');
   const endpoint=new URL(storeUrl);
   if(endpoint.protocol!=='https:')throw Error('Private storage endpoint must use HTTPS');
   const stored=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+storeToken,'Content-Type':'application/json'},body:JSON.stringify({source:'facebook-page',pageId,leads:result})});
   if(!stored.ok)throw Error('Private lead storage failed: HTTP '+stored.status);
   console.log('Sent '+result.length+' leads to private storage');
 }else{
   console.log('Found '+result.length+' matching leads; no private storage configured, results are ephemeral');
 }

}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)collect().catch(e=>{console.error(e.message);process.exitCode=1});
