'use strict';
async function sendEmail({to,subject,html}){const key=process.env.RESEND_API_KEY,from=process.env.RESEND_FROM;if(!key||!from||!to)return {sent:false};const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({from,to:Array.isArray(to)?to:[to],subject,html})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||'Email could not be sent.');return {sent:true,id:data.id};}
module.exports={sendEmail};
