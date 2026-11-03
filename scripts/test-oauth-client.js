'use strict';
// Shared js/shared/oauth.js: the `exchange` hook hands code + verifier to the server.
const assert=require('node:assert/strict');

function storage(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),_m:m};}
global.sessionStorage=storage();
global.localStorage=storage();
global.window=global;
global.location={search:'?code=auth_code&state=state_1',hostname:'receipts.test',origin:'https://receipts.test'};
require('../js/shared/oauth.js');

(async function main(){
  sessionStorage.setItem('receipts_oauth_state','state_1');
  sessionStorage.setItem('receipts_oauth_verifier','verifier_1');
  sessionStorage.setItem('receipts_oauth_redirect_uri','https://receipts.test/auth/buffer/callback');
  let received=null;
  const result=await BufferOAuth.handleCallback({prefix:'receipts',clientId:'cid',exchange:async payload=>{received=payload;return {buffer:{connected:true}};}});
  assert.equal(result.ok,true);
  assert.deepEqual(received,{code:'auth_code',codeVerifier:'verifier_1',redirectUri:'https://receipts.test/auth/buffer/callback',clientId:'cid'});
  assert.equal(sessionStorage.getItem('receipts_oauth_verifier'),null,'verifier is cleared after use');

  // State mismatch never reaches the server.
  sessionStorage.setItem('receipts_oauth_state','different');
  sessionStorage.setItem('receipts_oauth_verifier','verifier_2');
  sessionStorage.setItem('receipts_oauth_redirect_uri','https://receipts.test/auth/buffer/callback');
  received=null;
  const bad=await BufferOAuth.handleCallback({prefix:'receipts',clientId:'cid',exchange:async payload=>{received=payload;}});
  assert.equal(bad.ok,false);
  assert.equal(bad.reason,'state_mismatch');
  assert.equal(received,null);

  // Server errors surface as token_exchange_failed.
  sessionStorage.setItem('receipts_oauth_state','state_1');
  sessionStorage.setItem('receipts_oauth_verifier','verifier_3');
  sessionStorage.setItem('receipts_oauth_redirect_uri','https://receipts.test/auth/buffer/callback');
  const failed=await BufferOAuth.handleCallback({prefix:'receipts',clientId:'cid',exchange:async()=>{throw new Error('invalid_grant');}});
  assert.equal(failed.reason,'token_exchange_failed');
  assert.equal(failed.message,'invalid_grant');

  console.log('Shared OAuth client tests passed.');
})().catch(error=>{console.error(error);process.exit(1);});
