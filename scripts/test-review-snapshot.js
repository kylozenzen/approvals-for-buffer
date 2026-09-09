'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');

process.env.APP_BASE_URL='https://receipts.test';

const functionsRoot=path.resolve(__dirname,'../netlify/functions');
const dbPath=require.resolve(path.join(functionsRoot,'_lib/supabase.js'));
const cryptoPath=require.resolve(path.join(functionsRoot,'_lib/crypto.js'));
const emailPath=require.resolve(path.join(functionsRoot,'_lib/email.js'));

require.cache[dbPath]={
  id:dbPath,
  filename:dbPath,
  loaded:true,
  exports:{
    one:async table=>{
      if(table==='clients')return {
        id:'client_1',
        company:'Client One',
        approval_owner:'Owner One',
        approval_note:'',
        color:'#cafd00',
        initials:'CO',
        active:true,
        room_token_expires_at:new Date(Date.now()+60000).toISOString()
      };
      return null;
    },
    select:async table=>{
      if(table==='content_items')return [{
        id:'post_1',
        title:'Current title',
        caption:'CURRENT CONTENT THAT MUST NOT BE REVIEWED',
        image_url:'https://example.com/current.png',
        platform:'Current platform',
        status:'review',
        version:3,
        review_snapshot_id:'snapshot_1',
        changed_since_review:false,
        archived:false
      }];
      if(table==='content_snapshots')return [{
        id:'snapshot_1',
        caption:'Exact reviewed caption',
        image_url:'https://example.com/reviewed.png',
        platform:'LinkedIn',
        service:'linkedin',
        version:2,
        snapshot_json:{caption:'Exact reviewed caption'}
      }];
      if(table==='comments')return [];
      return [];
    }
  }
};
require.cache[cryptoPath]={
  id:cryptoPath,
  filename:cryptoPath,
  loaded:true,
  exports:{sha256:value=>'hash:'+value,safeHashEqual:()=>true}
};
require.cache[emailPath]={
  id:emailPath,
  filename:emailPath,
  loaded:true,
  exports:{sendEmail:async()=>({sent:false})}
};

async function main(){
  const review=require('../netlify/functions/review-api');
  const response=await review.handler({
    httpMethod:'POST',
    headers:{origin:'https://receipts.test'},
    body:JSON.stringify({action:'getRoom',token:'room_token',payload:{}})
  });
  assert.equal(response.statusCode,200);
  const body=JSON.parse(response.body);
  assert.equal(body.posts[0].caption,'Exact reviewed caption');
  assert.equal(body.posts[0].image,'https://example.com/reviewed.png');
  assert.equal(body.posts[0].platform,'LinkedIn');
  assert.equal(body.posts[0].service,'linkedin');
  assert.equal(body.posts[0].version,2);
  console.log('Public review snapshot tests passed.');
}

main().catch(function(error){
  console.error(error);
  process.exit(1);
});
