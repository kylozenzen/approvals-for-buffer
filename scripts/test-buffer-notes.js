'use strict';
// Buffer notes: adapter parsing + fallback, sync diffing, and client-room visibility.
const assert=require('node:assert/strict');
const path=require('node:path');

process.env.RECEIPTS_ENCRYPTION_SECRET='test-secret-test-secret-test-secret-123';
process.env.APP_BASE_URL='https://receipts.test';

const functionsRoot=path.resolve(__dirname,'../netlify/functions');
function stub(rel,exports){const file=require.resolve(path.join(functionsRoot,rel));require.cache[file]={id:file,filename:file,loaded:true,exports};}
function fresh(rel){const file=require.resolve(path.join(functionsRoot,rel));delete require.cache[file];return require(file);}

async function adapterTests(){
  const node={id:'post_1',text:'Hello',status:'draft',createdAt:'2026-11-01T00:00:00.000Z',dueAt:null,channelId:'ch',channel:{name:'n',service:'linkedin',displayName:'LinkedIn'},assets:[],
    notes:[
      {id:'n1',text:'  Check the date  ',type:'note',createdAt:'2026-11-02T00:00:00.000Z',updatedAt:null,author:{name:'Jess'}},
      {id:'n2',text:'   ',type:'note',createdAt:'2026-11-02T00:00:00.000Z',author:{name:'Empty'}},
      {id:'n3',text:'Deleted user note',type:'note',createdAt:'2026-11-02T01:00:00.000Z',author:null}
    ]};
  // Happy path: notes field accepted.
  let bodies=[];
  global.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));const q=bodies[bodies.length-1].query;const data=/GetOrganizations/.test(q)?{data:{account:{organizations:[{id:'org',name:'Org'}]}}}:{data:{posts:{edges:[{node}]}}};return {ok:true,status:200,text:async()=>JSON.stringify(data)};};
  let BufferAPI=fresh('_lib/buffer.js');
  let out=await BufferAPI.getPosts('tok');
  assert.equal(out.notesAvailable,true);
  assert.match(bodies[1].query,/notes \{/);
  assert.deepEqual(out.posts[0].notes.map(n=>n.id),['n1','n3'],'blank notes are dropped');
  assert.equal(out.posts[0].notes[0].text,'Check the date');
  assert.equal(out.posts[0].notes[0].updatedAt,'2026-11-02T00:00:00.000Z','updatedAt falls back to createdAt');
  assert.equal(out.posts[0].notes[1].authorName,'Buffer teammate','deleted authors get a fallback name');

  // Fallback: Buffer rejects the notes field -> sync continues without notes.
  bodies=[];
  global.fetch=async(url,options)=>{const body=JSON.parse(options.body);bodies.push(body);let data;if(/GetOrganizations/.test(body.query))data={data:{account:{organizations:[{id:'org',name:'Org'}]}}};else if(/notes \{/.test(body.query))data={errors:[{message:'Cannot query field "notes" on type "Post".'}]};else data={data:{posts:{edges:[{node:Object.assign({},node,{notes:undefined})}]}}};return {ok:true,status:200,text:async()=>JSON.stringify(data)};};
  BufferAPI=fresh('_lib/buffer.js');
  out=await BufferAPI.getPosts('tok');
  assert.equal(bodies.length,3,'retried once without notes');
  assert.doesNotMatch(bodies[2].query,/notes \{/);
  assert.equal(out.notesAvailable,false);
  assert.deepEqual(out.posts[0].notes,[]);

  // Unrelated GraphQL errors still fail loudly.
  global.fetch=async(url,options)=>{const body=JSON.parse(options.body);const data=/GetOrganizations/.test(body.query)?{data:{account:{organizations:[{id:'org',name:'Org'}]}}}:{errors:[{message:'Unauthorized'}]};return {ok:true,status:200,text:async()=>JSON.stringify(data)};};
  BufferAPI=fresh('_lib/buffer.js');
  await assert.rejects(()=>BufferAPI.getPosts('tok'),/Unauthorized/);
}

async function syncTests(){
  const calls={insert:[],update:[],remove:[]};
  const existingItem={id:'item_1',user_id:'user_1',version:1,current_fingerprint:'',latest_snapshot_id:'snap_1',review_snapshot_id:null,status:'draft'};
  const savedNotes=[
    {id:'c_keep',content_item_id:'item_1',buffer_note_id:'n_keep',body:'Same text',author_name:'Jess'},
    {id:'c_edit',content_item_id:'item_1',buffer_note_id:'n_edit',body:'Old text',author_name:'Jess'},
    {id:'c_gone',content_item_id:'item_1',buffer_note_id:'n_gone',body:'Deleted in Buffer',author_name:'Jess'}
  ];
  stub('_lib/auth.js',{userFromEvent:async()=>({id:'user_1',email:'ben@example.com'})});
  stub('_lib/buffer-oauth.js',{accessToken:async()=>'',connectionStatus:async()=>({connected:false})});
  stub('_lib/buffer.js',{getPosts:async()=>({notesAvailable:true,organization:{id:'org'},organizations:[],posts:[{bufferId:'buf_1',caption:'Caption',image:'',assets:[],platform:'LinkedIn',service:'linkedin',channelId:'ch',bufferStatus:'draft',dueAt:null,createdAt:'2026-11-01T00:00:00.000Z',notes:[
    {id:'n_keep',text:'Same text',authorName:'Jess',createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z'},
    {id:'n_edit',text:'New text',authorName:'Jess',createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-02T00:00:00.000Z'},
    {id:'n_new',text:'Brand new note',authorName:'Sam',createdAt:'2026-11-03T00:00:00.000Z',updatedAt:'2026-11-03T00:00:00.000Z'}
  ]}]})});
  stub('_lib/supabase.js',{
    one:async(table,query)=>{if(table==='profiles')return {buffer_organization_id:''};if(table==='content_items')return Object.assign({},existingItem,{current_fingerprint:currentFp});return null;},
    select:async(table,query)=>{if(table==='comments'&&/source=eq.buffer/.test(query))return savedNotes;return [];},
    insert:async(table,body)=>{calls.insert.push({table,body});return Array.isArray(body)?body:[Object.assign({id:'new_'+table},body)];},
    update:async(table,query,body)=>{calls.update.push({table,query,body});return [body];},
    remove:async(table,query)=>{calls.remove.push({table,query});},
    rest:async()=>null
  });
  stub('_lib/email.js',{sendEmail:async()=>({sent:false}),uniqueRecipients:x=>x});
  const C=fresh('_lib/crypto.js');
  // Make the stored fingerprint match so the post is "unchanged" — notes must not bump versions.
  var currentFp=C.fingerprint({bufferPostId:'buf_1',caption:'Caption',imageUrl:'',assets:[],platform:'LinkedIn',service:'linkedin',channelId:'ch',bufferStatus:'draft',dueAt:null});
  const api=fresh('creator-api.js');
  const res=await api.handler({httpMethod:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify({action:'syncBuffer'})});
  assert.equal(res.statusCode,200,res.body);
  const out=JSON.parse(res.body);
  assert.equal(out.changed,0,'notes alone never create a new snapshot');
  assert.equal(out.notesAdded,1);
  assert.equal(out.notesUpdated,1);
  assert.equal(out.notesRemoved,1);
  const noteInsert=calls.insert.find(x=>x.table==='comments');
  assert.equal(noteInsert.body.length,1);
  assert.equal(noteInsert.body[0].buffer_note_id,'n_new');
  assert.equal(noteInsert.body[0].client_visible,false,'new Buffer notes are internal by default');
  assert.equal(noteInsert.body[0].author_type,'buffer');
  assert.equal(noteInsert.body[0].kind,'note');
  assert.equal(noteInsert.body[0].snapshot_id,'snap_1');
  const edit=calls.update.find(x=>x.table==='comments');
  assert.match(edit.query,/id=eq.c_edit/);
  assert.equal(edit.body.body,'New text');
  assert.match(calls.remove[0].query,/id=in.\(c_gone\)/);
  assert.ok(!calls.update.some(x=>x.table==='content_snapshots'));
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
  const bodies=JSON.parse(res.body).posts[0].comments.map(c=>c.body);
  assert.deepEqual(bodies,['Normal comment','Shared note'],'internal Buffer notes never reach the client room');
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
  let room=await API.getReviewRoom(client.roomToken);
  let roomPost=room.posts.find(p=>p.id===post.id);
  assert.ok(!roomPost.comments.some(c=>c.id==='note_demo_2'),'hidden demo note stays out of the room');
  assert.ok(roomPost.comments.some(c=>c.id==='note_demo_1'),'shared demo note shows in the room');
  await API.setNoteVisibility('note_demo_2',true);
  room=await API.getReviewRoom(client.roomToken);
  roomPost=room.posts.find(p=>p.id===post.id);
  assert.ok(roomPost.comments.some(c=>c.id==='note_demo_2'),'sharing a note shows it in the room');
}

(async function main(){
  await adapterTests();
  await syncTests();
  await roomVisibilityTests();
  await demoTests();
  console.log('Buffer notes tests passed.');
})().catch(error=>{console.error(error);process.exit(1);});
