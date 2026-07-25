'use strict';
const assert=require('node:assert/strict');

const store=new Map();
global.localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,value)=>store.set(key,String(value)),
  removeItem:key=>store.delete(key)
};
global.fetch=async()=>{throw new Error('No remote backend in demo test');};
global.window={location:{origin:'http://localhost:8888'}};
window.ReceiptsUtil={
  id:prefix=>prefix+'_test_'+Math.random().toString(36).slice(2,8),
  initials:value=>String(value||'').split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase(),
  roomUrl:token=>'http://localhost:8888/review/'+encodeURIComponent(token)
};

require('../js/demo-data');
require('../js/api');

async function main(){
  const API=window.ReceiptsAPI;
  const started=await API.init();
  assert.equal(started.mode,'demo');

  const initial=await API.bootstrap();
  const post=initial.posts.find(item=>item.status==='draft');
  const client=initial.clients[0];
  assert.ok(post,'Demo data should include a draft post');
  assert.ok(client,'Demo data should include a client');

  await API.assignAndSendForReview(post.id,client.id);
  const assigned=await API.bootstrap();
  const waiting=assigned.posts.find(item=>item.id===post.id);
  assert.equal(waiting.clientId,client.id);
  assert.equal(waiting.status,'review');

  const room=await API.getReviewRoom(client.roomToken);
  assert.ok(room.posts.some(item=>item.id===post.id));

  const approval=await API.approvePost(client.roomToken,post.id,client.approvalOwner,client.approvalCode);
  assert.match(approval.receiptCode,/^RCP-/);
  const approved=await API.bootstrap();
  assert.equal(approved.posts.find(item=>item.id===post.id).status,'approved');
  assert.ok(approved.receipts.some(item=>item.postId===post.id));
  console.log('Demo sync-to-approval flow tests passed.');
}

main().catch(function(error){
  console.error(error);
  process.exit(1);
});
