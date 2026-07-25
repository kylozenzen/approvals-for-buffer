'use strict';
const assert=require('node:assert/strict');

const responses=[
  {data:{account:{organizations:[
    {id:'org_one',name:'First workspace',ownerEmail:'one@example.com'},
    {id:'org_two',name:'Second workspace',ownerEmail:'two@example.com'}
  ]}}},
  {data:{posts:{edges:[
    {node:{
      id:'post_123',
      text:'A Buffer draft ready for review.',
      status:'draft',
      createdAt:'2026-07-24T12:00:00.000Z',
      dueAt:null,
      channelId:'channel_123',
      channel:{name:'nobodycreative',service:'linkedin',displayName:'Nobody Creative'},
      assets:[{type:'image',mimeType:'image/png',source:'https://example.com/source.png',thumbnail:'https://example.com/thumb.png'}]
    }}
  ]}}}
];
const requests=[];
global.fetch=async function(url,options){
  requests.push({url,options});
  const body=responses.shift();
  return {ok:true,status:200,text:async()=>JSON.stringify(body)};
};

async function main(){
  const BufferAPI=require('../netlify/functions/_lib/buffer');
  const result=await BufferAPI.getPosts('test_token','org_two');
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,'https://api.buffer.com');
  assert.equal(requests[0].options.headers.authorization,'Bearer test_token');
  assert.equal(result.organization.id,'org_two');
  assert.equal(result.organizationCount,2);
  assert.deepEqual(result.organizations,[
    {id:'org_one',name:'First workspace'},
    {id:'org_two',name:'Second workspace'}
  ]);
  assert.equal(result.posts.length,1);
  assert.equal(result.posts[0].bufferId,'post_123');
  assert.equal(result.posts[0].platform,'Nobody Creative');
  assert.equal(result.posts[0].image,'https://example.com/thumb.png');
  const queryBody=JSON.parse(requests[1].options.body);
  assert.deepEqual(queryBody.variables.statuses,['draft','needs_approval','scheduled']);
  console.log('Buffer sync adapter tests passed.');
}

main().catch(function(error){
  console.error(error);
  process.exit(1);
});
