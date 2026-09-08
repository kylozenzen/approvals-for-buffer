'use strict';
function uniqueRecipients(to){
  const seen=new Set();
  return (Array.isArray(to)?to:[to]).map(value=>String(value||'').trim()).filter(value=>{
    const key=value.toLowerCase();
    if(!key||seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
async function sendEmail({to,subject,html}){const key=process.env.RESEND_API_KEY,from=process.env.RESEND_FROM,recipients=uniqueRecipients(to);if(!key||!from||!recipients.length)return {sent:false};const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({from,to:recipients,subject,html})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||'Email could not be sent.');return {sent:true,id:data.id};}
module.exports={sendEmail,uniqueRecipients};
