'use strict';
function env(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Object.assign(new Error('Supabase server environment variables are not configured.'),{statusCode:503});return {url:url.replace(/\/$/,''),key};}
async function rest(table,method,query,body,prefer){const e=env();const url=e.url+'/rest/v1/'+table+(query?'?'+query:'');const headers={apikey:e.key,authorization:'Bearer '+e.key,'content-type':'application/json'};if(prefer)headers.prefer=prefer;const res=await fetch(url,{method:method||'GET',headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let data=null;try{data=text?JSON.parse(text):null;}catch(err){data=text;}if(!res.ok){const msg=(data&&data.message)||String(data||'Supabase request failed');throw Object.assign(new Error(msg),{statusCode:res.status});}return data;}
function select(table,query){return rest(table,'GET',query);}
function insert(table,body){return rest(table,'POST','',body,'return=representation');}
function update(table,query,body){return rest(table,'PATCH',query,body,'return=representation');}
function remove(table,query){return rest(table,'DELETE',query,undefined,'return=minimal');}
async function one(table,query){const rows=await select(table,query+'&limit=1');return rows&&rows[0]?rows[0]:null;}
module.exports={rest,select,insert,update,remove,one};
