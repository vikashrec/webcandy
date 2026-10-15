import {fileURLToPath} from 'node:url';
export function checkIntegration(env=process.env) {
 const missing=[];
 for(const key of ['FB_PAGE_ID','FB_PAGE_ACCESS_TOKEN','PRIVATE_LEADS_ENDPOINT','PRIVATE_LEADS_TOKEN']) if(!env[key]?.trim())missing.push(key);
 const errors=[];
 if(env.FB_PAGE_ID && !/^[0-9]{1,30}$/.test(env.FB_PAGE_ID))errors.push('FB_PAGE_ID must be numeric');
 if(env.PRIVATE_LEADS_ENDPOINT){
   try{const url=new URL(env.PRIVATE_LEADS_ENDPOINT);if(url.protocol!=='https:'||url.username||url.password)errors.push('PRIVATE_LEADS_ENDPOINT must be HTTPS without embedded credentials')}
   catch{errors.push('PRIVATE_LEADS_ENDPOINT must be a valid URL')}
 }
 if(env.FB_API_VERSION && !/^v\d+\.\d+$/.test(env.FB_API_VERSION))errors.push('FB_API_VERSION is invalid');
 return {ready:missing.length===0&&errors.length===0,missing,errors};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1]))){
 const result=checkIntegration();
 console.log(result.ready?'AUTHORIZED CONFIG READY (permissions still require real validation)':'AUTHORIZED CONFIG PENDING');
 if(result.missing.length)console.log('Missing configuration keys: '+result.missing.join(', '));
 if(result.errors.length)console.log('Configuration errors: '+result.errors.join('; '));
 if(process.env.GITHUB_OUTPUT){
   const {appendFileSync}=await import('node:fs');
   appendFileSync(process.env.GITHUB_OUTPUT,'ready='+result.ready+'\n');
 }
 if(result.errors.length)process.exitCode=1;
}
