'use strict';
// Buffer Notes (collaborationNotes API): adapter, sync diffing, write-back, room visibility.
const assert=require('node:assert/strict');
const path=require('node:path');

process.env.RECEIPTS_ENCRYPTION_SECRET='test-secret-test-secret-test-secret-123';
process.env.APP_BASE_URL='https://receipts.test';

const functionsRoot=path.resolve(__dirname,'../netlify/functions');
function stub(rel,exports){const file=require.resolve(path.join(functionsRoot,rel));require.cache[file]={id:file,filename:file,loaded:true,exports};}
function fresh(rel){
  // review-notes holds its own references to the db and Buffer modules, so reload it with each fresh API module.
  delete require.cache[require.resolve(path.join(functionsRoot,'_lib/review-notes.js'))];
  const file=require.resolve(path.join(functionsRoot,rel));delete require.cache[file];return require(file);
}
function reply(body){return {ok:true,status:200,text:async()=>JSON.stringify(body)};}

async function adapterTests(){
  // List: paginates, normalises, drops blank notes, tolerates a deleted author.
  const bodies=[];
  const pages=[
    {data:{collaborationNotes:{edges:[{node:{id:'n1',text:' Check the date ',author:{id:'a',name:'Jess'},createdAt:'2026-11-03T10:00:00Z',updatedAt:null}},{node:{id:'n2',text:'  ',author:{name:'x'}}}],pageInfo:{hasNextPage:true,endCursor:'c1'}}}},
    {data:{collaborationNotes:{edges:[{node:{id:'n3',text:'Old note',author:null,createdAt:'2026-11-01T10:00:00Z'}}],pageInfo:{hasNextPage:false,endCursor:null}}}}
  ];
  global.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return reply(pages.shift());};
  let BufferAPI=fresh('_lib/buffer.js');
  const notes=await BufferAPI.listPostNotes('tok','post_1');
  assert.match(bodies[0].query,/collaborationNotes\(input: \$input/);
  assert.deepEqual(bodies[0].variables.input,{subject:{postId:'post_1'}});
  assert.equal(bodies[1].variables.after,'c1','follows the next page cursor');
  assert.deepEqual(notes.map(n=>n.id),['n1','n3']);
  assert.equal(notes[0].text,'Check the date');
  assert.equal(notes[0].updatedAt,'2026-11-03T10:00:00Z');
  assert.equal(notes[1].authorName,'Buffer teammate');

  // Create: sends subject + text + annotations, returns the new id.
  let sent=null;
  global.fetch=async(url,options)=>{sent=JSON.parse(options.body);return reply({data:{createCollaborationNote:{__typename:'CreateCollaborationNoteSuccess',edge:{cursor:'x',node:{id:'note_9',text:'hi'}}}}});};
  BufferAPI=fresh('_lib/buffer.js');
  assert.deepEqual(await BufferAPI.createPostNote('tok','post_1','Looks great'),{id:'note_9'});
  assert.deepEqual(sent.variables.input,{subject:{postId:'post_1'},text:'Looks great',annotations:[]});

  // A typed mutation error is a failure even with HTTP 200.
  global.fetch=async()=>reply({data:{createCollaborationNote:{__typename:'CollaborationNoteThreadClosedError',message:'Thread is closed'}}});
  BufferAPI=fresh('_lib/buffer.js');
  await assert.rejects(()=>BufferAPI.createPostNote('tok','post_1','x'),/Thread is closed/);

  // Missing scopes are recognised.
  global.fetch=async()=>reply({errors:[{message:'Missing scope',extensions:{code:'INSUFFICIENT_SCOPE'}}]});
  BufferAPI=fresh('_lib/buffer.js');
  await assert.rejects(()=>BufferAPI.listPostNotes('tok','p'),err=>BufferAPI.isScopeError(err));
}

function syncHarness(listImpl,pendingRows,createImpl,itemOverrides){
  const calls={insert:[],update:[],remove:[],listed:[]};
  const items={
    buf_assigned:Object.assign({id:'item_1',user_id:'user_1',client_id:'client_1',version:1,latest_snapshot_id:'snap_1',review_snapshot_id:'snap_1',status:'review'},itemOverrides||{}),
    buf_unassigned:{id:'item_2',user_id:'user_1',client_id:null,version:1,latest_snapshot_id:'snap_2',review_snapshot_id:null,status:'draft'}
  };
  const saved=[
    {id:'c_keep',content_item_id:'item_1',buffer_note_id:'n_keep',source:'buffer',body:'Same text',author_name:'Jess'},
    {id:'c_edit',content_item_id:'item_1',buffer_note_id:'n_edit',source:'buffer',body:'Old text',author_name:'Jess'},
    {id:'c_gone',content_item_id:'item_1',buffer_note_id:'n_gone',source:'buffer',body:'Deleted in Buffer',author_name:'Jess'},
    {id:'c_client',content_item_id:'item_1',buffer_note_id:'n_mirror',source:'receipts',body:'From the client',author_name:'James'}
  ];
  stub('_lib/auth.js',{userFromEvent:async()=>({id:'user_1',email:'ben@example.com'})});
  stub('_lib/buffer-oauth.js',{accessToken:async()=>'',connectionStatus:async()=>({connected:false})});
  const C=fresh('_lib/crypto.js');
  const fp=id=>C.fingerprint({bufferPostId:id,caption:'Caption',imageUrl:'',assets:[],platform:'LinkedIn',service:'linkedin',channelId:'ch',bufferStatus:'draft',dueAt:null});
  const post=id=>({bufferId:id,caption:'Caption',image:'',assets:[],platform:'LinkedIn',service:'linkedin',channelId:'ch',bufferStatus:'draft',dueAt:null,createdAt:'2026-11-01T00:00:00.000Z'});
  stub('_lib/buffer.js',{
    getPosts:async()=>({organization:{id:'org'},organizations:[],posts:[post('buf_assigned'),post('buf_unassigned')]}),
    listPostNotes:async(token,postId)=>{calls.listed.push(postId);return listImpl(postId);},
    createPostNote:async(token,postId,text)=>{calls.created=(calls.created||[]).concat([{token,postId,text}]);return createImpl?createImpl(text):{id:'pushed_'+(calls.created.length)};},
    deletePostNote:async(token,noteId)=>{calls.deleted=(calls.deleted||[]).concat([noteId]);return true;},
    isScopeError:e=>e&&e.code==='INSUFFICIENT_SCOPE'
  });
  stub('_lib/supabase.js',{
    one:async(table,query)=>{if(table==='profiles')return {buffer_organization_id:''};if(table==='content_items'){const id=decodeURIComponent(query.match(/buffer_post_id=eq\.([^&]+)/)[1]);return Object.assign({current_fingerprint:fp(id)},items[id]);}return null;},
    select:async(table,query)=>{if(table==='comments'&&/kind=eq.change&buffer_note_id=not.is.null/.test(query))return [{id:'cm_old',buffer_note_id:'note_change_1'},{id:'cm_done',buffer_note_id:'deleted:note_x'}];if(table==='comments'&&/buffer_note_id=not.is.null/.test(query))return saved;if(table==='comments'&&/author_type=eq.client/.test(query))return pendingRows||[];if(table==='clients')return [{id:'client_1',company:'Coffee Chaz'}];return [];},
    insert:async(table,body)=>{calls.insert.push({table,body});return Array.isArray(body)?body:[Object.assign({id:'new_'+table},body)];},
    update:async(table,query,body)=>{calls.update.push({table,query,body});return [body];},
    remove:async(table,query)=>{calls.remove.push({table,query});},
    rest:async()=>null
  });
  stub('_lib/email.js',{sendEmail:async()=>({sent:false}),uniqueRecipients:x=>x});
  return calls;
}
async function runSync(){
  const api=fresh('creator-api.js');
  const res=await api.handler({httpMethod:'POST',headers:{authorization:'Bearer x','x-buffer-token':'key_with_notes'},body:JSON.stringify({action:'syncBuffer'})});
  assert.equal(res.statusCode,200,res.body);
  return JSON.parse(res.body);
}

async function syncTests(){
  let calls=syncHarness(()=>[
    {id:'n_keep',text:'Same text',authorName:'Jess'},
    {id:'n_edit',text:'New text',authorName:'Jess',updatedAt:'2026-11-02T00:00:00Z'},
    {id:'n_new',text:'Brand new note',authorName:'Sam',createdAt:'2026-11-03T00:00:00Z'},
    {id:'n_mirror',text:'James (Coffee Chaz) commented in Receipts: From the client',authorName:'Ben'}
  ]);
  let out=await runSync();
  assert.deepEqual(calls.listed,['buf_assigned'],'only posts in a client room are read');
  assert.equal(out.changed,0,'notes never create a new snapshot');
  assert.equal(out.notesAdded,1);
  assert.equal(out.notesUpdated,1);
  assert.equal(out.notesRemoved,1);
  const noteInsert=calls.insert.find(x=>x.table==='comments');
  assert.equal(noteInsert.body.length,1,'the note Receipts wrote itself is not pulled back in');
  assert.equal(noteInsert.body[0].buffer_note_id,'n_new');
  assert.equal(noteInsert.body[0].client_visible,false);
  assert.match(calls.update.find(x=>x.table==='comments').query,/id=eq.c_edit/);
  assert.match(calls.remove[0].query,/id=in.\(c_gone\)/);
  assert.doesNotMatch(calls.remove[0].query,/c_client/,'client comments are never deleted by sync');

  // Missing notes scope: posts still sync, nothing about notes is changed.
  calls=syncHarness(()=>{throw Object.assign(new Error('Missing scope'),{code:'INSUFFICIENT_SCOPE'});});
  out=await runSync();
  assert.equal(out.notesNeedScope,true);
  assert.equal(calls.insert.filter(x=>x.table==='comments').length,0);
  assert.equal(calls.remove.length,0);

  // A failed read for one post leaves that post's saved notes alone.
  calls=syncHarness(()=>{throw new Error('Buffer timeout');});
  out=await runSync();
  assert.equal(calls.remove.length,0);
  assert.equal(out.notesAdded,0);
  assert.equal(out.notesError,'Buffer timeout','read failures are reported to the app, not swallowed');
  assert.equal(out.notesFailed,1);

  // Opening a post refreshes that post's notes live and reports the result.
  calls=syncHarness(()=>[{id:'n_live',text:'Fresh from Buffer',authorName:'Sam'}]);
  const db=require(path.join(functionsRoot,'_lib/supabase.js'));
  db.one=(orig=>async(table,query)=>table==='content_items'&&/id=eq.item_1/.test(query)?{id:'item_1',user_id:'user_1',client_id:'client_1',buffer_post_id:'buf_assigned',review_snapshot_id:'snap_1'}:orig(table,query))(db.one);
  const api=fresh('creator-api.js');
  const res=await api.handler({httpMethod:'POST',headers:{authorization:'Bearer x','x-buffer-token':'key_with_notes'},body:JSON.stringify({action:'postDetail',payload:{postId:'item_1'}})});
  assert.equal(res.statusCode,200,res.body);
  assert.deepEqual(calls.listed,['buf_assigned']);
  assert.equal(JSON.parse(res.body).notes.added,1);
}

async function pushPendingTests(){
  // Change requests the room couldn't send go to Buffer from the creator side; plain comments never do.
  let calls=syncHarness(()=>[],[{id:'cm_2',content_item_id:'item_1',author_name:'coffee',body:'Hours are wrong',kind:'change'}]);
  let out=await runSync();
  assert.equal(out.notesPushed,1);
  assert.equal(calls.created.length,1);
  assert.match(calls.created[0].text,/^Changes requested by coffee \(Coffee Chaz\): "Hours are wrong"\nFull review thread: https:\/\/receipts\.test\/app\?post=item_1$/);
  assert.equal(calls.created[0].token,'key_with_notes','uses the creator\'s own Buffer access');
  assert.equal(calls.created[0].postId,'buf_assigned');

  // Approved post: change-request notes are deleted from Buffer, then one approval note is added.
  calls=syncHarness(()=>[],[{id:'cm_2',content_item_id:'item_1',author_name:'coffee',body:'Hours are wrong',kind:'change'},{id:'cm_3',content_item_id:'item_1',author_name:'coffee',body:'Final approval stamped with the owner code.',kind:'approval'}],null,{status:'approved',receipt_code:'RCP-ABC1234'});
  out=await runSync();
  assert.deepEqual(calls.deleted,['note_change_1'],'only live change notes are deleted');
  assert.equal(calls.created.length,1,'no change note is sent for an approved post');
  assert.match(calls.created[0].text,/^Approved by coffee \(Coffee Chaz\) · Receipt RCP-ABC1234 · Snapshot v1\nReview thread: /);
  const marks=calls.update.filter(u=>u.table==='comments').map(u=>u.body.buffer_note_id);
  assert.ok(marks.includes('deleted:note_change_1'),'deleted notes are marked so they are never resent');

  // A Buffer refusal is reported, not swallowed.
  calls=syncHarness(()=>[],[{id:'cm_2',content_item_id:'item_1',author_name:'coffee',body:'x',kind:'change'}],()=>{throw new Error('Thread is closed');});
  out=await runSync();
  assert.equal(out.notesPushError,'Thread is closed');
}

async function writeBackTests(){
  const created=[],updates=[];
  stub('_lib/buffer-oauth.js',{accessToken:async()=>'oauth_token'});
  stub('_lib/buffer.js',{createPostNote:async(token,postId,text)=>{created.push({token,postId,text});return {id:'buffer_note_1'};},deletePostNote:async()=>true});
  stub('_lib/email.js',{sendEmail:async()=>({sent:false}),uniqueRecipients:x=>x});
  stub('_lib/supabase.js',{
    one:async table=>{
      if(table==='clients')return {id:'client_1',company:'Coffee Chaz',approval_owner:'James',active:true,room_token_expires_at:new Date(Date.now()+60000).toISOString()};
      if(table==='content_items')return {id:'item_1',user_id:'user_1',client_id:'client_1',buffer_post_id:'post_abc',status:'review',review_snapshot_id:'snap_1'};
      return null;
    },
    select:async()=>[],
    insert:async(table,body)=>[Object.assign({id:'comment_1'},body)],
    update:async(table,query,body)=>{updates.push({table,query,body});return [body];},
    remove:async()=>null,rest:async()=>null
  });
  const event=body=>({httpMethod:'POST',headers:{},body:JSON.stringify(body)});
  // A plain comment stays in Receipts.
  let review=fresh('review-api.js');
  let res=await review.handler(event({action:'addComment',token:'room',payload:{postId:'item_1',name:'James',body:'Love it'}}));
  assert.equal(res.statusCode,200,res.body);
  assert.equal(created.length,0,'plain comments are not copied to Buffer');
  // A change request becomes one Buffer note with a link to the thread.
  res=await review.handler(event({action:'requestChanges',token:'room',payload:{postId:'item_1',name:'James',body:'This is chicken'}}));
  assert.equal(res.statusCode,200,res.body);
  assert.equal(JSON.parse(res.body).mirrored,true);
  assert.deepEqual(created[0],{token:'oauth_token',postId:'post_abc',text:'Changes requested by James (Coffee Chaz): "This is chicken"\nFull review thread: https://receipts.test/app?post=item_1'});
  assert.deepEqual(updates.find(u=>u.table==='comments').body,{buffer_note_id:'buffer_note_1'});

  // Buffer failing never blocks the client's change request.
  stub('_lib/buffer.js',{createPostNote:async()=>{throw new Error('Buffer down');}});
  review=fresh('review-api.js');
  res=await review.handler(event({action:'requestChanges',token:'room',payload:{postId:'item_1',name:'James',body:'Still saved'}}));
  assert.equal(res.statusCode,200,res.body);
  assert.equal(JSON.parse(res.body).mirrored,false);
}

async function roomVisibilityTests(){
  stub('_lib/supabase.js',{
    one:async table=>table==='clients'?{id:'client_1',company:'Co',approval_owner:'Owner',active:true,room_token_expires_at:new Date(Date.now()+60000).toISOString()}:null,
    select:async table=>{
      if(table==='content_items')return [{id:'item_1',title:'T',status:'review',version:1,review_snapshot_id:'snap_1'}];
      if(table==='content_snapshots')return [{id:'snap_1',caption:'C',version:1,snapshot_json:{}}];
      if(table==='comments')return [
        {id:'a',content_item_id:'item_1',author_type:'creator',author_name:'Ben',body:'Normal comment',kind:'comment',created_at:'2026-11-01T00:00:00.000Z'},
        {id:'b',content_item_id:'item_1',author_type:'buffer',author_name:'Jess',body:'Internal note',kind:'note',source:'buffer',client_visible:false,created_at:'2026-11-01T00:00:00.000Z'},
        {id:'c',content_item_id:'item_1',author_type:'buffer',author_name:'Jess',body:'Shared note',kind:'note',source:'buffer',client_visible:true,created_at:'2026-11-01T00:00:00.000Z'}
      ];
      return [];
    },
    insert:async()=>[],update:async()=>[],remove:async()=>null,rest:async()=>null
  });
  const review=fresh('review-api.js');
  const res=await review.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'getRoom',token:'room'})});
  assert.equal(res.statusCode,200,res.body);
  assert.deepEqual(JSON.parse(res.body).posts[0].comments.map(c=>c.body),['Normal comment','Shared note'],'internal Buffer notes never reach the client room');
}

async function demoTests(){
  const store=new Map();
  global.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  global.fetch=async()=>{throw new Error('offline');};
  global.window={location:{origin:'http://localhost:8888'}};
  window.ReceiptsUtil={id:p=>p+'_'+Math.random().toString(36).slice(2,8),initials:v=>v,roomUrl:t=>t};
  require('../js/demo-data');
  require('../js/api');
  const API=window.ReceiptsAPI;
  await API.init();
  const data=await API.bootstrap();
  const post=data.posts.find(p=>(p.comments||[]).some(c=>c.source==='buffer'));
  const client=data.clients.find(c=>c.id===post.clientId);
  let roomPost=(await API.getReviewRoom(client.roomToken)).posts.find(p=>p.id===post.id);
  assert.ok(!roomPost.comments.some(c=>c.id==='note_demo_2'));
  assert.ok(roomPost.comments.some(c=>c.id==='note_demo_1'));
  await API.setNoteVisibility('note_demo_2',true);
  roomPost=(await API.getReviewRoom(client.roomToken)).posts.find(p=>p.id===post.id);
  assert.ok(roomPost.comments.some(c=>c.id==='note_demo_2'));
}

(async function main(){
  await adapterTests();
  await syncTests();
  await pushPendingTests();
  await writeBackTests();
  await roomVisibilityTests();
  await demoTests();
  console.log('Buffer notes tests passed.');
})().catch(error=>{console.error(error);process.exit(1);});
