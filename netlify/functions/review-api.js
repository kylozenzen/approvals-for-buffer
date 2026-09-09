'use strict';
const H=require('./_lib/http');
const db=require('./_lib/supabase');
const C=require('./_lib/crypto');
const Mail=require('./_lib/email');
function q(v){return encodeURIComponent(v);}
function mapComment(row){return {id:row.id,authorType:row.author_type,authorName:row.author_name,body:row.body,kind:row.kind,createdAt:row.created_at};}
function mapPublicItem(row,snapshot,comments){
  const saved=snapshot||{};
  const payload=saved.snapshot_json||{};
  return {
    id:row.id,
    title:row.title,
    caption:saved.caption||payload.caption||'',
    image:saved.image_url||payload.imageUrl||'',
    platform:saved.platform||payload.platform||'Buffer',
    service:saved.service||payload.service||'',
    status:row.status,
    version:saved.version||row.version||1,
    changedSinceReview:Boolean(row.changed_since_review),
    feedback:row.feedback||'',
    approvedBy:row.approved_by,
    approvedAt:row.approved_at,
    receiptCode:row.receipt_code,
    comments:comments||[]
  };
}
async function clientByToken(token){if(!token)return null;const client=await db.one('clients','select=*&room_token_hash=eq.'+q(C.sha256(token))+'&active=eq.true');if(client&&client.room_token_expires_at&&new Date(client.room_token_expires_at)<=new Date())throw Object.assign(new Error('This approval room link has expired; ask the creator for a fresh link.'),{statusCode:410});return client;}
async function roomPayload(client){
  const rows=await db.select('content_items','select=*&client_id=eq.'+q(client.id)+'&archived=eq.false&status=neq.draft&order=updated_at.desc');
  const ids=rows.map(x=>x.id);
  const snapshotIds=rows.map(x=>x.review_snapshot_id).filter(Boolean);
  const [comments,snapshots]=await Promise.all([
    ids.length?db.select('comments','select=*&content_item_id=in.('+ids.join(',')+')&order=created_at.asc'):Promise.resolve([]),
    snapshotIds.length?db.select('content_snapshots','select=*&id=in.('+snapshotIds.join(',')+')'):Promise.resolve([])
  ]);
  const grouped={},bySnapshot={};
  comments.forEach(x=>{(grouped[x.content_item_id]||(grouped[x.content_item_id]=[])).push(mapComment(x));});
  snapshots.forEach(x=>{bySnapshot[x.id]=x;});
  return {
    client:{id:client.id,company:client.company,approvalOwner:client.approval_owner,approvalNote:client.approval_note||'',color:client.color||'#cafd00',initials:client.initials||''},
    posts:rows.map(x=>mapPublicItem(x,bySnapshot[x.review_snapshot_id],grouped[x.id]||[]))
  };
}
async function verifyRoomItem(client,postId){const item=await db.one('content_items','select=*&id=eq.'+q(postId)+'&client_id=eq.'+q(client.id)+'&archived=eq.false');if(!item)throw Object.assign(new Error('Post not found in this approval room.'),{statusCode:404});return item;}
function cleanName(value,fallback){return String(value||fallback||'Client').trim().slice(0,80);}
function cleanBody(value){return String(value||'').trim().slice(0,4000);}
async function messageThrottle(client){const since=new Date(Date.now()-60*1000).toISOString();const roomItems=await db.select('content_items','select=id&client_id=eq.'+q(client.id));const ids=roomItems.map(x=>x.id);if(!ids.length)return;const messages=await db.select('comments','select=id&author_type=eq.client&content_item_id=in.('+ids.join(',')+')&created_at=gte.'+q(since));if(messages.length>=12)throw Object.assign(new Error('Too many messages. Try again in a minute.'),{statusCode:429});}
async function addComment(client,p){await messageThrottle(client);const item=await verifyRoomItem(client,p.postId),body=cleanBody(p.body);if(!body)throw Object.assign(new Error('Write a comment first.'),{statusCode:400});await db.insert('comments',{content_item_id:item.id,user_id:item.user_id,snapshot_id:item.review_snapshot_id||item.latest_snapshot_id,author_type:'client',author_name:cleanName(p.name,client.approval_owner),body,kind:'comment'});return {ok:true};}
async function requestChanges(client,p){await messageThrottle(client);const item=await verifyRoomItem(client,p.postId),body=cleanBody(p.body);if(!body)throw Object.assign(new Error('Describe the requested change first.'),{statusCode:400});await db.insert('comments',{content_item_id:item.id,user_id:item.user_id,snapshot_id:item.review_snapshot_id||item.latest_snapshot_id,author_type:'client',author_name:cleanName(p.name,client.approval_owner),body,kind:'change'});await db.update('content_items','id=eq.'+q(item.id),{status:'changes',feedback:body,updated_at:new Date().toISOString()});return {ok:true};}
async function recentFailures(client,event){const ip=(event.headers['x-nf-client-connection-ip']||event.headers['x-forwarded-for']||'unknown').split(',')[0].trim(),since=new Date(Date.now()-15*60*1000).toISOString(),base='select=id&client_id=eq.'+q(client.id)+'&success=eq.false&created_at=gte.'+q(since);const [ipRows,globalRows]=await Promise.all([db.select('approval_attempts',base+'&ip_address=eq.'+q(ip)),db.select('approval_attempts',base)]);return {ip,count:ipRows.length,globalCount:globalRows.length};}
async function recordAttempt(client,item,ip,success){await db.insert('approval_attempts',{client_id:client.id,content_item_id:item?item.id:null,ip_address:ip,success:Boolean(success)});}
async function approve(client,p,event){if(client.approval_locked_until&&new Date(client.approval_locked_until)>new Date())throw Object.assign(new Error('Approval is temporarily locked. Ask the creator for help.'),{statusCode:429});const item=await verifyRoomItem(client,p.postId);const rate=await recentFailures(client,event);if(rate.count>=5)throw Object.assign(new Error('Too many incorrect attempts. Try again in 15 minutes.'),{statusCode:429});if(rate.globalCount>=10)throw Object.assign(new Error('Approval is temporarily locked. Ask the creator for help.'),{statusCode:429});const supplied=C.sha256(String(p.code||''));if(!/^\d{6}$/.test(String(p.code||''))||!C.safeHashEqual(supplied,client.approval_code_hash)){await recordAttempt(client,item,rate.ip,false);if(rate.globalCount+1>=10){const until=new Date(Date.now()+30*60*1000).toISOString();await db.update('clients','id=eq.'+q(client.id),{approval_locked_until:until});try{const profile=await db.one('profiles','select=email&id=eq.'+q(item.user_id));if(profile&&profile.email)await Mail.sendEmail({to:profile.email,subject:'Receipts approval room locked',html:'<p>'+client.company+' approval room was locked after repeated incorrect owner-code attempts. Lockout ends '+until+'.</p>'});}catch(e){console.error('[Receipts lockout email]',e.message);}throw Object.assign(new Error('Approval is temporarily locked. Ask the creator for help.'),{statusCode:429});}throw Object.assign(new Error('Owner code does not match.'),{statusCode:401});}if(item.status!=='review')throw Object.assign(new Error(item.status==='changes'?'Changes were requested. The creator must resend the latest snapshot before approval.':'This post is not currently waiting for approval.'),{statusCode:409});if(item.changed_since_review)throw Object.assign(new Error('This post changed in Buffer after review began. The creator must resend it.'),{statusCode:409});if(!item.review_snapshot_id)throw Object.assign(new Error('No review snapshot is attached to this post.'),{statusCode:409});const snapshot=await db.one('content_snapshots','select=*&id=eq.'+q(item.review_snapshot_id)+'&content_item_id=eq.'+q(item.id));if(!snapshot||snapshot.fingerprint!==item.current_fingerprint)throw Object.assign(new Error('The Buffer content no longer matches the reviewed snapshot.'),{statusCode:409});const approver=client.approval_owner,now=new Date().toISOString(),receiptCode=C.receiptCode();const receiptRows=await db.insert('receipts',{receipt_code:receiptCode,user_id:item.user_id,client_id:client.id,content_item_id:item.id,snapshot_id:snapshot.id,client_company:client.company,title:item.title,platform:item.platform,approver_name:approver,approved_at:now,version:snapshot.version,fingerprint:snapshot.fingerprint,snapshot_json:snapshot.snapshot_json||{caption:snapshot.caption,imageUrl:snapshot.image_url,platform:snapshot.platform}});await db.insert('approval_events',{user_id:item.user_id,client_id:client.id,content_item_id:item.id,snapshot_id:snapshot.id,action:'approved',approver_name:approver,receipt_id:receiptRows[0].id,metadata:{ip:rate.ip,attestation:'owner_code'}});await db.insert('comments',{content_item_id:item.id,user_id:item.user_id,snapshot_id:snapshot.id,author_type:'client',author_name:approver,body:'Final approval stamped with the owner code.',kind:'approval'});await db.update('content_items','id=eq.'+q(item.id),{status:'approved',approved_snapshot_id:snapshot.id,approved_by:approver,approved_at:now,receipt_code:receiptCode,feedback:null,updated_at:now});await recordAttempt(client,item,rate.ip,true);const profile=await db.one('profiles','select=*&id=eq.'+q(item.user_id));const recipients=Mail.uniqueRecipients([client.email,profile&&profile.email]);let emailSent=false;try{const emailResult=await Mail.sendEmail({to:recipients,subject:receiptCode+' — '+item.title+' approved',html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Approval stamped</h1><p><strong>'+approver+'</strong> approved <strong>'+item.title+'</strong> for '+client.company+'.</p><p>Receipt: <strong>'+receiptCode+'</strong><br>Snapshot: v'+snapshot.version+'<br>Approved: '+now+'</p><p style="font-size:12px;color:#777">This receipt is attached to the exact Buffer snapshot reviewed at approval time.</p></div>'});emailSent=Boolean(emailResult.sent);}catch(e){console.error('[Receipts email]',e.message);}return {ok:true,receiptCode,approvedAt:now,emailSent};}
exports.handler=async function(event){const opt=H.options(event);if(opt)return opt;if(!H.originAllowed(event))return H.json(403,{error:'Origin is not allowed.'});if(event.httpMethod!=='POST')return H.json(405,{error:'POST required.'});try{const body=H.parse(event),token=String(body.token||''),client=await clientByToken(token);if(!client)throw Object.assign(new Error('This approval room was not found or its link was rotated.'),{statusCode:404});const action=body.action,p=body.payload||{};let out;if(action==='getRoom')out=await roomPayload(client);else if(action==='addComment')out=await addComment(client,p);else if(action==='requestChanges')out=await requestChanges(client,p);else if(action==='approve')out=await approve(client,p,event);else throw Object.assign(new Error('Unknown review action.'),{statusCode:400});return H.json(200,out);}catch(e){return H.fail(e);}};
