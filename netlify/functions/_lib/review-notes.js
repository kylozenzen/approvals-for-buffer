'use strict';
// What Receipts writes onto a Buffer post as Notes, and when.
//
// Buffer Notes are a to-do list for whoever edits the post, not a copy of the
// client conversation:
//   - a change request  -> one Note, with a link back to the full thread in Receipts
//   - an approval       -> the post's change-request Notes are deleted, then one
//                          approval Note is added
//   - plain comments    -> stay in Receipts only
//
// comments.buffer_note_id records what happened to each client row:
//   null            not sent yet
//   '<note id>'     sent and still in Buffer
//   'deleted:<id>'  sent, then removed from Buffer when the post was approved
const db=require('./supabase');
const BufferAPI=require('./buffer');

const DELETED='deleted:';
function q(v){return encodeURIComponent(v);}
function isLive(noteId){return Boolean(noteId)&&!String(noteId).startsWith(DELETED);}

function appBase(event){
  const configured=String(process.env.APP_BASE_URL||'').replace(/\/$/,'');
  if(configured)return configured;
  const h=(event&&event.headers)||{};
  const host=String(h['x-forwarded-host']||h.host||'').split(',')[0].trim();
  return host?String(h['x-forwarded-proto']||'https').split(',')[0].trim()+'://'+host:'';
}
// The creator's own view of the post (needs a Receipts sign-in), never the client room link.
function threadLink(base,itemId){return base?base+'/app?post='+encodeURIComponent(itemId):'';}
function who(name,company){return String(name||'Client')+(company?' ('+company+')':'');}

function changeText(row,company,link){
  return 'Changes requested by '+who(row.author_name,company)+': "'+String(row.body||'').trim()+'"'+(link?'\nFull review thread: '+link:'');
}
function approvalText(name,company,receiptCode,version,link){
  return 'Approved by '+who(name,company)+(receiptCode?' · Receipt '+receiptCode:'')+(version?' · Snapshot v'+version:'')+(link?'\nReview thread: '+link:'');
}

// Creator's Buffer token for server-side use (client rooms, background work).
async function serverToken(BufferOAuth,userId){
  let token='';
  try{token=await BufferOAuth.accessToken(userId);}catch(e){token='';}
  return token||String(process.env.BUFFER_API_KEY||process.env.BUFFER_TOKEN||'').trim();
}

async function sendChange(token,item,row,company,base){
  const note=await BufferAPI.createPostNote(token,item.buffer_post_id,changeText(row,company,threadLink(base,item.id)));
  if(note.id)await db.update('comments','id=eq.'+q(row.id)+'&user_id=eq.'+q(item.user_id),{buffer_note_id:note.id});
  return note.id;
}

// Removes this post's change-request Notes from Buffer, then adds the approval Note.
async function sendApproval(token,item,row,company,base,receipt){
  const changes=await db.select('comments','select=id,buffer_note_id&content_item_id=eq.'+q(item.id)+'&user_id=eq.'+q(item.user_id)+'&kind=eq.change&buffer_note_id=not.is.null');
  let removed=0;
  for(const change of (changes||[]).filter(c=>isLive(c.buffer_note_id))){
    try{await BufferAPI.deletePostNote(token,change.buffer_note_id);}
    catch(e){
      // Already deleted by hand in Buffer counts as done; anything else is reported.
      if(!/not found|does not exist|no longer/i.test(e.message||''))throw e;
    }
    await db.update('comments','id=eq.'+q(change.id)+'&user_id=eq.'+q(item.user_id),{buffer_note_id:DELETED+change.buffer_note_id});
    removed++;
  }
  // Change requests that never reached Buffer don't need sending any more.
  // (One update per row: buffer_note_id is unique per post.)
  const unsent=await db.select('comments','select=id&content_item_id=eq.'+q(item.id)+'&user_id=eq.'+q(item.user_id)+'&kind=eq.change&buffer_note_id=is.null');
  for(const u of (unsent||[]))await db.update('comments','id=eq.'+q(u.id)+'&user_id=eq.'+q(item.user_id),{buffer_note_id:DELETED+'unsent-'+u.id});
  const r=receipt||{};
  const note=await BufferAPI.createPostNote(token,item.buffer_post_id,approvalText(row.author_name,company,r.receiptCode||item.receipt_code,r.version,threadLink(base,item.id)));
  if(note.id)await db.update('comments','id=eq.'+q(row.id)+'&user_id=eq.'+q(item.user_id),{buffer_note_id:note.id});
  return {removed};
}

module.exports={DELETED,isLive,appBase,threadLink,changeText,approvalText,serverToken,sendChange,sendApproval};
