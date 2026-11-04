'use strict';
const H=require('./_lib/http');
const db=require('./_lib/supabase');
const auth=require('./_lib/auth');
const C=require('./_lib/crypto');
const BufferAPI=require('./_lib/buffer');
const BufferOAuth=require('./_lib/buffer-oauth');
const ReviewNotes=require('./_lib/review-notes');
const Mail=require('./_lib/email');

function q(v){return encodeURIComponent(v);}
function titleFromCaption(value){const clean=String(value||'').replace(/\s+/g,' ').trim();return clean?(clean.length>46?clean.slice(0,46).trim()+'…':clean):'Untitled Buffer post';}
function publicBase(event){return (process.env.APP_BASE_URL||((event.headers['x-forwarded-proto']||'https')+'://'+event.headers.host)).replace(/\/$/,'');}
function mapClient(row){let roomToken='',approvalCode='';try{roomToken=C.decrypt(row.room_token_ciphertext);}catch(e){}try{approvalCode=C.decrypt(row.approval_code_ciphertext);}catch(e){}return {id:row.id,name:row.contact_name,company:row.company,email:row.email,approvalOwner:row.approval_owner,approvalNote:row.approval_note||'',roomToken,approvalCode,color:row.color||'#cafd00',colorText:row.color_text||'#0d0f0c',initials:row.initials||'',active:row.active!==false,approvalLockedUntil:row.approval_locked_until||null,roomTokenExpiresAt:row.room_token_expires_at||null};}
function mapItem(row){return {id:row.id,bufferId:row.buffer_post_id,clientId:row.client_id,title:row.title,caption:row.caption||'',image:row.image_url||'',platform:row.platform||'Buffer',service:row.service||'',channelId:row.channel_id||'',status:row.status||'draft',bufferStatus:row.buffer_status||'draft',dueAt:row.due_at,version:row.version||1,changedSinceReview:Boolean(row.changed_since_review),approvedBy:row.approved_by,approvedAt:row.approved_at,receiptCode:row.receipt_code,archived:Boolean(row.archived),currentFingerprint:row.current_fingerprint,createdAt:row.source_created_at||row.created_at,updatedAt:row.updated_at};}
function mapComment(row){return {id:row.id,authorType:row.author_type,authorName:row.author_name,body:row.body,kind:row.kind,source:row.source||'receipts',clientVisible:row.client_visible!==false,inBuffer:ReviewNotes.isLive(row.buffer_note_id)&&row.source!=='buffer',createdAt:row.created_at};}
function mapReceipt(row){return {id:row.id,receiptCode:row.receipt_code,postId:row.content_item_id,clientId:row.client_id,clientCompany:row.client_company,title:row.title,platform:row.platform,approverName:row.approver_name,approvedAt:row.approved_at,version:row.version,fingerprint:row.fingerprint,snapshot:row.snapshot_json||{}};}
async function ownItem(userId,id){return db.one('content_items','select=*&id=eq.'+q(id)+'&user_id=eq.'+q(userId));}
async function ownClient(userId,id){return db.one('clients','select=*&id=eq.'+q(id)+'&user_id=eq.'+q(userId));}
async function bootstrap(user){
  const [profiles,clients,items,receipts]=await Promise.all([
    db.select('profiles','select=*&id=eq.'+q(user.id)+'&limit=1'),
    db.select('clients','select=*&user_id=eq.'+q(user.id)+'&active=eq.true&order=created_at.asc'),
    db.select('content_items','select=*&user_id=eq.'+q(user.id)+'&archived=eq.false&order=updated_at.desc'),
    db.select('receipts','select=*&user_id=eq.'+q(user.id)+'&order=approved_at.desc')
  ]);
  const allActive=await db.select('content_items','select=id,client_id&user_id=eq.'+q(user.id)+'&archived=eq.false');
  const rooms=(clients||[]).map(c=>({id:c.id,activePosts:allActive.filter(x=>x.client_id===c.id).length}));
  const overLimit={rooms:(clients||[]).length>3,postRooms:rooms.filter(x=>x.activePosts>1).map(x=>x.id),unassignedPosts:allActive.filter(x=>!x.client_id).length};
  const lastSync=(items||[]).map(x=>x.last_synced_at).filter(Boolean).sort().reverse()[0]||null;
  const buffer=await BufferOAuth.connectionStatus(user.id);
  return {profile:{id:user.id,email:user.email||'',name:(profiles[0]&&profiles[0].display_name)||'',bufferOrganizationId:(profiles[0]&&profiles[0].buffer_organization_id)||''},buffer,clients:(clients||[]).map(mapClient),posts:(items||[]).map(mapItem),receipts:(receipts||[]).map(mapReceipt),capacity:{activeRooms:(clients||[]).length,maxRooms:3,rooms,overLimit},lastSync};
}
async function createClient(user,p){
  if(!p.company||!p.email||!(p.approvalOwner||p.name))throw Object.assign(new Error('Company, owner, and email are required.'),{statusCode:400});
  const token=C.randomToken(),code=C.ownerCode();
  const rows=await db.insert('clients',{user_id:user.id,company:String(p.company).trim(),contact_name:String(p.name||p.approvalOwner).trim(),email:String(p.email).trim(),approval_owner:String(p.approvalOwner||p.name).trim(),approval_note:String(p.approvalNote||'').trim(),room_token_hash:C.sha256(token),room_token_ciphertext:C.encrypt(token),approval_code_hash:C.sha256(code),approval_code_ciphertext:C.encrypt(code),color:p.color||'#cafd00',color_text:'#0d0f0c',room_token_expires_at:new Date(Date.now()+30*24*60*60*1000).toISOString(),initials:String(p.company).split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()});
  return {client:mapClient(rows[0])};
}
async function rotateClientSecret(user,p){const client=await ownClient(user.id,p.clientId);if(!client||!client.active)throw Object.assign(new Error('Active client room not found.'),{statusCode:404});if(p.kind==='room'){const token=C.randomToken();const rows=await db.update('clients','id=eq.'+q(client.id)+'&user_id=eq.'+q(user.id),{room_token_hash:C.sha256(token),room_token_ciphertext:C.encrypt(token),room_token_expires_at:new Date(Date.now()+30*24*60*60*1000).toISOString(),updated_at:new Date().toISOString()});return {client:mapClient(rows[0])};}const code=C.ownerCode();const rows=await db.update('clients','id=eq.'+q(client.id)+'&user_id=eq.'+q(user.id),{approval_code_hash:C.sha256(code),approval_code_ciphertext:C.encrypt(code),updated_at:new Date().toISOString()});return {client:mapClient(rows[0])};}
async function updateRoomControls(user,p){const client=await ownClient(user.id,p.clientId);if(!client||!client.active)throw Object.assign(new Error('Active client room not found.'),{statusCode:404});const patch={updated_at:new Date().toISOString()};if(p.clearLock)patch.approval_locked_until=null;if(Object.prototype.hasOwnProperty.call(p,'expiresAt')){if(p.expiresAt===null)patch.room_token_expires_at=null;else{const expires=new Date(p.expiresAt);if(Number.isNaN(expires.getTime())||expires<=new Date())throw Object.assign(new Error('Choose a future room expiry.'),{statusCode:400});patch.room_token_expires_at=expires.toISOString();}}const rows=await db.update('clients','id=eq.'+q(client.id)+'&user_id=eq.'+q(user.id),patch);return {client:mapClient(rows[0])};}
async function assignPost(user,p){const item=await ownItem(user.id,p.postId);if(!item||item.archived)throw Object.assign(new Error('Active post not found.'),{statusCode:404});const nextClient=p.clientId||null;if(item.status!=='draft'&&nextClient!==item.client_id)throw Object.assign(new Error('A post already in review cannot be moved to another client room.'),{statusCode:409});if(nextClient){const client=await ownClient(user.id,nextClient);if(!client||!client.active)throw Object.assign(new Error('Active client room not found.'),{statusCode:404});}const rows=await db.update('content_items','id=eq.'+q(item.id)+'&user_id=eq.'+q(user.id),{client_id:nextClient,updated_at:new Date().toISOString()});return {post:mapItem(rows[0])};}
async function sendForReview(user,p){const item=await ownItem(user.id,p.postId);if(!item||item.archived)throw Object.assign(new Error('Active post not found.'),{statusCode:404});if(!item.client_id)throw Object.assign(new Error('Assign a client first.'),{statusCode:400});if(!item.latest_snapshot_id)throw Object.assign(new Error('This Buffer post has no snapshot yet. Sync again.'),{statusCode:400});if(item.status==='changes'&&item.latest_snapshot_id===item.review_snapshot_id)throw Object.assign(new Error('Update this post in Buffer and sync it before resending.'),{statusCode:409});const rows=await db.update('content_items','id=eq.'+q(item.id)+'&user_id=eq.'+q(user.id),{review_snapshot_id:item.latest_snapshot_id,status:'review',changed_since_review:false,feedback:null,approved_by:null,approved_at:null,receipt_code:null,updated_at:new Date().toISOString()});await db.insert('comments',{content_item_id:item.id,user_id:user.id,snapshot_id:item.latest_snapshot_id,author_type:'creator',author_name:user.email||'Creator',body:'Sent the latest Buffer snapshot for approval.',kind:'system'});return {post:mapItem(rows[0])};}
async function assignAndSendForReview(user,p){
  const item=await ownItem(user.id,p.postId);
  if(!item||item.archived)throw Object.assign(new Error('Active post not found.'),{statusCode:404});
  if(!p.clientId)throw Object.assign(new Error('Choose a client first.'),{statusCode:400});
  const client=await ownClient(user.id,p.clientId);
  if(!client||!client.active)throw Object.assign(new Error('Active client room not found.'),{statusCode:404});
  if(!item.latest_snapshot_id)throw Object.assign(new Error('This Buffer post has no snapshot yet. Sync again.'),{statusCode:400});
  if(item.status!=='draft'&&item.client_id&&item.client_id!==client.id)throw Object.assign(new Error('This post is already in another client room. Return it to draft before reassigning it.'),{statusCode:409});
  if(item.status==='changes'&&item.latest_snapshot_id===item.review_snapshot_id)throw Object.assign(new Error('Update this post in Buffer and sync it before resending.'),{statusCode:409});
  const rows=await db.update('content_items','id=eq.'+q(item.id)+'&user_id=eq.'+q(user.id),{
    client_id:client.id,
    review_snapshot_id:item.latest_snapshot_id,
    status:'review',
    changed_since_review:false,
    feedback:null,
    approved_by:null,
    approved_at:null,
    receipt_code:null,
    updated_at:new Date().toISOString()
  });
  await db.insert('comments',{content_item_id:item.id,user_id:user.id,snapshot_id:item.latest_snapshot_id,author_type:'creator',author_name:user.email||'Creator',body:'Assigned to '+client.company+' and sent the latest Buffer snapshot for approval.',kind:'system'});
  return {post:mapItem(rows[0]),client:mapClient(client)};
}
async function addCreatorComment(user,p){const item=await ownItem(user.id,p.postId);if(!item)throw Object.assign(new Error('Post not found.'),{statusCode:404});if(!String(p.body||'').trim())throw Object.assign(new Error('Comment cannot be empty.'),{statusCode:400});await db.insert('comments',{content_item_id:item.id,user_id:user.id,snapshot_id:item.review_snapshot_id||item.latest_snapshot_id,author_type:'creator',author_name:user.email||'Creator',body:String(p.body).trim(),kind:'comment'});return {ok:true};}
async function refreshItemNotes(user,item,event){
  if(item.archived||!item.client_id||!item.buffer_post_id)return {};
  try{
    const {token}=await resolveBufferToken(user,event);
    if(!token)return {notesNoToken:true};
    return await syncNotes(user,token,[{itemId:item.id,postId:item.buffer_post_id,clientId:item.client_id,status:item.status,receiptCode:item.receipt_code,version:item.version,snapshotId:item.review_snapshot_id||item.latest_snapshot_id}],ReviewNotes.appBase(event));
  }catch(e){return {notesError:e.message};}
}
async function postDetail(user,p,event){const item=await ownItem(user.id,p.postId);if(!item||item.archived)throw Object.assign(new Error('Active post not found.'),{statusCode:404});const notes=await refreshItemNotes(user,item,event);const [client,comments]=await Promise.all([item.client_id?ownClient(user.id,item.client_id):Promise.resolve(null),db.select('comments','select=*&content_item_id=eq.'+q(item.id)+'&order=created_at.asc')]);return {notes:{added:notes.notesAdded||0,pushed:notes.notesPushed||0,error:notes.notesError||null,pushError:notes.notesPushError||null,needScope:Boolean(notes.notesNeedScope),noToken:Boolean(notes.notesNoToken)},post:mapItem(item),client:client?mapClient(client):null,comments:(comments||[]).map(mapComment)};}
function snapshotFromBuffer(post){return {bufferPostId:post.bufferId,caption:post.caption||'',imageUrl:post.image||'',assets:Array.isArray(post.assets)?post.assets:[],platform:post.platform||'Buffer',service:post.service||'',channelId:post.channelId||'',bufferStatus:post.bufferStatus||'draft',dueAt:post.dueAt||null};}
async function selectBufferOrganization(user,p){if(!String(p.organizationId||'').trim())throw Object.assign(new Error('Choose a Buffer organization.'),{statusCode:400});await db.update('profiles','id=eq.'+q(user.id),{buffer_organization_id:String(p.organizationId).trim()});return {ok:true};}
// Which Buffer token to use, in priority order:
// 1. a key pasted in this browser session (x-buffer-token), 2. the creator's saved
// Buffer OAuth connection, 3. a server-wide BUFFER_API_KEY fallback.
async function resolveBufferToken(user,event){
  const pasted=(event.headers['x-buffer-token']||event.headers['X-Buffer-Token']||'').trim();
  if(pasted)return {token:pasted,source:'session_key'};
  const oauthToken=await BufferOAuth.accessToken(user.id).catch(e=>{if(e.reconnect)throw e;console.warn('[Receipts] Buffer connection lookup failed:',e.message);return '';});
  if(oauthToken)return {token:oauthToken,source:'oauth'};
  return {token:(process.env.BUFFER_API_KEY||process.env.BUFFER_TOKEN||'').trim(),source:'server_key'};
}
async function pullBufferPosts(user,event,orgId,after){
  const resolved=await resolveBufferToken(user,event);
  try{return {pulled:await BufferAPI.getPosts(resolved.token,orgId,after),token:resolved.token,source:resolved.source};}
  catch(e){
    // An OAuth access token can be revoked or expire early: refresh once and retry.
    if(resolved.source!=='oauth'||e.bufferStatus!==401)throw e;
    const token=await BufferOAuth.accessToken(user.id,true);
    return {pulled:await BufferAPI.getPosts(token,orgId),token,source:'oauth'};
  }
}
function noteRow(user,target,note){
  return {content_item_id:target.itemId,user_id:user.id,snapshot_id:target.snapshotId||null,author_type:'buffer',author_name:String(note.authorName||'Buffer teammate').slice(0,80),body:String(note.text).slice(0,4000),kind:'note',source:'buffer',buffer_note_id:note.id,client_visible:false,external_updated_at:note.updatedAt||null,created_at:note.createdAt||new Date().toISOString()};
}
// Runs fn over items with at most `limit` in flight, so a sync stays inside the
// function time limit without bursting Buffer's rate limit.
async function eachLimited(items,limit,fn){
  let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;await fn(items[i],i);}});
  await Promise.all(workers);
}
// Sends change requests and approvals the client room couldn't deliver to Buffer,
// using the creator's own Buffer access (rules in _lib/review-notes.js).
async function pushPendingToBuffer(user,token,targets,base){
  const out={notesPushed:0};
  let pending;
  try{pending=await db.select('comments','select=id,content_item_id,author_name,body,kind&user_id=eq.'+q(user.id)+'&author_type=eq.client&kind=in.(change,approval)&buffer_note_id=is.null&content_item_id=in.('+targets.map(t=>t.itemId).join(',')+')&order=created_at.asc');}
  catch(e){return out;}
  if(!pending||!pending.length)return out;
  const companies={};
  const clientIds=[...new Set(targets.map(t=>t.clientId).filter(Boolean))];
  if(clientIds.length){try{(await db.select('clients','select=id,company&user_id=eq.'+q(user.id)+'&id=in.('+clientIds.join(',')+')')||[]).forEach(c=>{companies[c.id]=c.company;});}catch(e){}}
  for(const target of targets){
    const rows=pending.filter(r=>r.content_item_id===target.itemId);
    if(!rows.length)continue;
    const item={id:target.itemId,user_id:user.id,buffer_post_id:target.postId,receipt_code:target.receiptCode||null};
    const company=companies[target.clientId];
    try{
      const approval=rows.filter(r=>r.kind==='approval').pop();
      if(approval||target.status==='approved'){
        if(approval){await ReviewNotes.sendApproval(token,item,approval,company,base,{receiptCode:target.receiptCode,version:target.version});out.notesPushed++;}
        continue; // approved: open change requests are no longer needed in Buffer
      }
      for(const row of rows.filter(r=>r.kind==='change')){await ReviewNotes.sendChange(token,item,row,company,base);out.notesPushed++;}
    }catch(e){
      if(BufferAPI.isScopeError(e)){out.notesNeedScope=true;break;}
      out.notesPushFailed=(out.notesPushFailed||0)+1;
      if(!out.notesPushError)out.notesPushError=e.message||'Buffer did not save the note.';
      console.warn('[Receipts] Could not update Buffer notes:',e.message);
    }
  }
  return out;
}
// Mirrors each client-assigned post's Buffer Notes thread into Receipts: new notes
// are added (hidden from the client room), edited notes updated, deleted notes
// removed. Notes Receipts itself wrote to Buffer are recognised and skipped.
async function syncNotes(user,token,targets,base){
  const out={notesAdded:0,notesUpdated:0,notesRemoved:0,notesAvailable:true,notesChecked:targets.length};
  if(!token||!targets.length)return out;
  const pushed=await pushPendingToBuffer(user,token,targets,base);
  Object.assign(out,pushed);
  if(pushed.notesNeedScope){out.notesAvailable=false;return out;}
  let existing;
  try{existing=await db.select('comments','select=id,content_item_id,buffer_note_id,source,body,author_name&user_id=eq.'+q(user.id)+'&buffer_note_id=not.is.null&content_item_id=in.('+targets.map(t=>t.itemId).join(',')+')');}
  catch(e){console.warn('[Receipts] Skipping Buffer notes (run migration 003):',e.message);out.notesAvailable=false;out.notesNeedMigration=true;return out;}
  const fetched={};let scopeError=false;
  await eachLimited(targets,4,async target=>{
    if(scopeError)return;
    try{fetched[target.itemId]=await BufferAPI.listPostNotes(token,target.postId);}
    catch(e){
      if(BufferAPI.isScopeError(e)){scopeError=true;return;}
      console.warn('[Receipts] Could not read Buffer notes for post',target.postId,e.message);
      out.notesFailed=(out.notesFailed||0)+1;
      if(!out.notesError)out.notesError=e.message||'Buffer did not return the notes.';
    }
  });
  if(scopeError){out.notesAvailable=false;out.notesNeedScope=true;return out;}
  const byItem={},mirrored=new Set();
  (existing||[]).forEach(row=>{
    if(row.source!=='buffer'){mirrored.add(row.buffer_note_id);return;}
    (byItem[row.content_item_id]||(byItem[row.content_item_id]={}))[row.buffer_note_id]=row;
  });
  const inserts=[],removals=[];
  for(const target of targets){
    const notes=fetched[target.itemId];
    if(!notes)continue; // read failed: leave this post's saved notes untouched
    const saved=byItem[target.itemId]||{},current=new Set();
    for(const note of notes){
      if(mirrored.has(note.id))continue;
      current.add(note.id);
      const row=saved[note.id];
      if(!row){inserts.push(noteRow(user,target,note));continue;}
      const body=String(note.text).slice(0,4000),author=String(note.authorName||'Buffer teammate').slice(0,80);
      if(row.body!==body||row.author_name!==author){
        await db.update('comments','id=eq.'+q(row.id)+'&user_id=eq.'+q(user.id),{body,author_name:author,external_updated_at:note.updatedAt||null});
        out.notesUpdated++;
      }
    }
    Object.keys(saved).forEach(noteId=>{if(!current.has(noteId))removals.push(saved[noteId].id);});
  }
  if(inserts.length){await db.insert('comments',inserts);out.notesAdded=inserts.length;}
  if(removals.length){await db.remove('comments','user_id=eq.'+q(user.id)+'&source=eq.buffer&id=in.('+removals.join(',')+')');out.notesRemoved=removals.length;}
  return out;
}
async function syncBuffer(user,event){
  const profile=await db.one('profiles','select=buffer_organization_id&id=eq.'+q(user.id));
  const pulledPages=[];let cursor=null,token='',firstPage=null;
  // Paginate existing tracked posts too, without ever importing candidates.
  for(let page=0;page<20;page++){
    const result=await pullBufferPosts(user,event,profile&&profile.buffer_organization_id,cursor);
    token=result.token;if(!firstPage)firstPage=result.pulled;
    pulledPages.push(...result.pulled.posts);
    if(!result.pulled.hasNextPage||!result.pulled.nextCursor)break;
    cursor=result.pulled.nextCursor;
  }
  const pulled=Object.assign({},firstPage,{posts:pulledPages,truncated:Boolean(cursor&&firstPage)});
  let added=0,updated=0,changed=0;const noteTargets=[];
  for(const post of pulled.posts){
    const snap=snapshotFromBuffer(post),fp=C.fingerprint(snap);
    const existing=await db.one('content_items','select=*&user_id=eq.'+q(user.id)+'&buffer_post_id=eq.'+q(post.bufferId));
    if(!existing||existing.archived)continue; // Browsing never inserts. Archived posts remain immutable.
    if(existing.current_fingerprint!==fp){
      const version=(existing.version||1)+1;
      const snapshots=await db.insert('content_snapshots',{content_item_id:existing.id,user_id:user.id,version,caption:snap.caption,image_url:snap.imageUrl,platform:snap.platform,service:snap.service,channel_id:snap.channelId,buffer_status:snap.bufferStatus,due_at:snap.dueAt,fingerprint:fp,snapshot_json:snap});
      const hadReview=Boolean(existing.review_snapshot_id);
      await db.update('content_items','id=eq.'+q(existing.id)+'&user_id=eq.'+q(user.id),{title:titleFromCaption(post.caption),caption:post.caption||'',image_url:post.image||'',platform:post.platform||'Buffer',service:post.service||'',channel_id:post.channelId||'',buffer_status:post.bufferStatus||'draft',due_at:post.dueAt||null,version,current_fingerprint:fp,latest_snapshot_id:snapshots[0].id,status:hadReview?'draft':existing.status,changed_since_review:hadReview,approved_by:null,approved_at:null,receipt_code:null,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()});
      if(existing.client_id)noteTargets.push({itemId:existing.id,postId:post.bufferId,clientId:existing.client_id,status:hadReview?'draft':existing.status,receiptCode:null,version,snapshotId:snapshots[0].id});
      changed++;updated++;
    }else{
      await db.update('content_items','id=eq.'+q(existing.id)+'&user_id=eq.'+q(user.id),{buffer_status:post.bufferStatus||'draft',due_at:post.dueAt||null,last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()});
      if(existing.client_id)noteTargets.push({itemId:existing.id,postId:post.bufferId,clientId:existing.client_id,status:existing.status,receiptCode:existing.receipt_code,version:existing.version,snapshotId:existing.review_snapshot_id||existing.latest_snapshot_id});
      updated++;
    }
  }
  // Notes are read only for posts already in a client room, to keep sync fast and within rate limits.
  const notes=await syncNotes(user,token,noteTargets,ReviewNotes.appBase(event));
  return Object.assign({added,updated,changed,organization:pulled.organization,organizationCount:pulled.organizationCount||0,organizations:pulled.organizations||[],truncated:Boolean(pulled.truncated)},notes);
}

async function bufferCandidates(user,event,p){
  const profile=await db.one('profiles','select=buffer_organization_id&id=eq.'+q(user.id));
  const {pulled}=await pullBufferPosts(user,event,profile&&profile.buffer_organization_id,p.after);
  // Entire response is transient; no content_items or snapshots writes.
  const drafts=pulled.posts.filter(x=>x.bufferStatus==='draft'&&!x.dueAt);
  return {posts:drafts,after:pulled.nextCursor||null,hasNextPage:Boolean(pulled.hasNextPage),organization:pulled.organization};
}
async function importSelected(user,event,p){
  const client=await ownClient(user.id,p.clientId);
  if(!client||!client.active)throw Object.assign(new Error('Choose an active client room.'),{statusCode:404});
  if(!p.bufferId)throw Object.assign(new Error('Choose a Buffer draft.'),{statusCode:400});
  const profile=await db.one('profiles','select=buffer_organization_id&id=eq.'+q(user.id));
  // Re-read the selected candidate from Buffer rather than trusting browser-supplied post data.
  const {pulled}=await pullBufferPosts(user,event,profile&&profile.buffer_organization_id,p.after);
  const post=pulled.posts.find(x=>x.bufferId===p.bufferId);
  if(!post||post.bufferStatus!=='draft'||post.dueAt)throw Object.assign(new Error('This unscheduled Buffer draft is no longer available. Refresh the picker.'),{statusCode:409});
  const snap=snapshotFromBuffer(post),fp=C.fingerprint(snap);
  const row=await db.rest('rpc/receipts_import_selected','POST','',{
    p_user_id:user.id,p_client_id:client.id,p_buffer_id:post.bufferId,
    p_title:titleFromCaption(post.caption),p_caption:post.caption||'',p_image:post.image||'',
    p_platform:post.platform||'Buffer',p_service:post.service||'',p_channel:post.channelId||'',
    p_status:post.bufferStatus||'draft',p_due_at:post.dueAt||null,
    p_source_at:post.createdAt||new Date().toISOString(),p_fingerprint:fp,p_snapshot:snap
  });
  return {post:mapItem(Array.isArray(row)?row[0]:row)};
}
async function archivePost(user,p){
  const item=await ownItem(user.id,p.postId);
  if(!item)throw Object.assign(new Error('Post not found.'),{statusCode:404});
  if(item.archived)return {post:mapItem(item)};
  const rows=await db.update('content_items','id=eq.'+q(item.id)+'&user_id=eq.'+q(user.id)+'&archived=eq.false',{archived:true,updated_at:new Date().toISOString()});
  return {post:mapItem(rows[0]||item)};
}
async function archiveClient(user,p){
  const client=await ownClient(user.id,p.clientId);
  if(!client)throw Object.assign(new Error('Client room not found.'),{statusCode:404});
  const rows=await db.update('clients','id=eq.'+q(client.id)+'&user_id=eq.'+q(user.id)+'&active=eq.true',{active:false,room_token_expires_at:new Date().toISOString(),updated_at:new Date().toISOString()});
  // Migration trigger archives its posts atomically, preserving snapshots/comments/receipts.
  return {client:mapClient(rows[0]||Object.assign({},client,{active:false}))};
}
async function setNoteVisibility(user,p){
  const row=await db.one('comments','select=*&id=eq.'+q(p.commentId)+'&user_id=eq.'+q(user.id)+'&source=eq.buffer');
  if(!row)throw Object.assign(new Error('Buffer note not found.'),{statusCode:404});
  const rows=await db.update('comments','id=eq.'+q(row.id)+'&user_id=eq.'+q(user.id),{client_visible:Boolean(p.visible)});
  return {comment:mapComment(rows[0])};
}
async function connectBuffer(user,p,event){return {buffer:await BufferOAuth.connect(user,p,event)};}
async function disconnectBuffer(user){return {buffer:await BufferOAuth.disconnect(user)};}
async function resendApprovalEmail(user,p){const receipt=await db.one('receipts','select=*&id=eq.'+q(p.receiptId)+'&user_id=eq.'+q(user.id));if(!receipt)throw Object.assign(new Error('Receipt not found.'),{statusCode:404});const client=await ownClient(user.id,receipt.client_id);if(!client)throw Object.assign(new Error('Client not found.'),{statusCode:404});return Mail.sendEmail({to:Mail.uniqueRecipients([client.email,user.email]),subject:receipt.receipt_code+' — '+receipt.title+' approved',html:'<p>'+receipt.approver_name+' approved '+receipt.title+' for '+client.company+'. Receipt: '+receipt.receipt_code+'.</p>'});}
async function inviteClient(user,p,event){const client=await ownClient(user.id,p.clientId);if(!client||!client.active)throw Object.assign(new Error('Active client room not found.'),{statusCode:404});const room=C.decrypt(client.room_token_ciphertext),code=C.decrypt(client.approval_code_ciphertext),url=publicBase(event)+'/review/'+encodeURIComponent(room);const result=await Mail.sendEmail({to:client.email,subject:'Your '+client.company+' approval room',html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Content is ready for review</h1><p>Open the approval room to comment, request changes, or stamp final approval.</p><p><a href="'+url+'" style="display:inline-block;background:#cafd00;color:#354600;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Open approval room</a></p><p><strong>Owner code:</strong> '+code+'</p><p style="color:#777;font-size:12px">The team can comment. The code holder can grant final approval.</p></div>'});return Object.assign(result,{preview:'Approval room: '+url+'\nOwner code: '+code});}

exports.handler=async function(event){const opt=H.options(event);if(opt)return opt;if(!H.originAllowed(event))return H.json(403,{error:'Origin is not allowed.'});if(event.httpMethod!=='POST')return H.json(405,{error:'POST required.'});try{const user=await auth.userFromEvent(event);const body=H.parse(event),action=body.action,p=body.payload||{};let out;if(action==='bootstrap')out=await bootstrap(user);else if(action==='createClient')out=await createClient(user,p);else if(action==='rotateClientSecret')out=await rotateClientSecret(user,p);else if(action==='updateRoomControls')out=await updateRoomControls(user,p);else if(action==='assignPost')out=await assignPost(user,p);else if(action==='sendForReview')out=await sendForReview(user,p);else if(action==='assignAndSendForReview')out=await assignAndSendForReview(user,p);else if(action==='addCreatorComment')out=await addCreatorComment(user,p);else if(action==='postDetail')out=await postDetail(user,p,event);else if(action==='syncBuffer')out=await syncBuffer(user,event);else if(action==='bufferCandidates')out=await bufferCandidates(user,event,p);else if(action==='importSelected')out=await importSelected(user,event,p);else if(action==='archivePost')out=await archivePost(user,p);else if(action==='archiveClient')out=await archiveClient(user,p);else if(action==='connectBuffer')out=await connectBuffer(user,p,event);else if(action==='disconnectBuffer')out=await disconnectBuffer(user);else if(action==='setNoteVisibility')out=await setNoteVisibility(user,p);else if(action==='selectBufferOrganization')out=await selectBufferOrganization(user,p);else if(action==='inviteClient')out=await inviteClient(user,p,event);else if(action==='resendApprovalEmail')out=await resendApprovalEmail(user,p);else throw Object.assign(new Error('Unknown creator action.'),{statusCode:400});return H.json(200,out);}catch(e){return H.fail(e);}};
