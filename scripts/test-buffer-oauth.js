'use strict';
// Buffer OAuth: server-side code exchange, encrypted storage, refresh, and redirect checks.
const assert=require('node:assert/strict');
const path=require('node:path');

process.env.RECEIPTS_ENCRYPTION_SECRET='test-secret-test-secret-test-secret-123';
process.env.APP_BASE_URL='https://receipts.test';
process.env.BUFFER_OAUTH_CLIENT_ID='public_client_id';

const functionsRoot=path.resolve(__dirname,'../netlify/functions');
function stub(rel,exports){const file=require.resolve(path.join(functionsRoot,rel));require.cache[file]={id:file,filename:file,loaded:true,exports};}

let row=null;
const tokenRequests=[];
stub('_lib/supabase.js',{
  one:async table=>table==='buffer_connections'?row:null,
  rest:async(table,method,query,body)=>{if(table==='buffer_connections'&&method==='POST')row=Object.assign({},body);return null;},
  update:async(table,query,body)=>{if(table==='buffer_connections')row=Object.assign({},row,body);return [row];},
  remove:async table=>{if(table==='buffer_connections')row=null;},
  select:async()=>[],insert:async()=>[]
});
const C=require(path.join(functionsRoot,'_lib/crypto.js'));
const OAuth=require(path.join(functionsRoot,'_lib/buffer-oauth.js'));
const event={headers:{host:'receipts.test','x-forwarded-proto':'https'}};
const user={id:'user_1'};

function tokenServer(responses){
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://auth.buffer.com/token');
    const params=Object.fromEntries(new URLSearchParams(options.body));
    tokenRequests.push(params);
    const next=responses.shift();
    return {ok:next.status===200,status:next.status,text:async()=>JSON.stringify(next.body)};
  };
}

(async function main(){
  // Redirect URIs from other origins are refused before calling Buffer.
  tokenServer([]);
  await assert.rejects(()=>OAuth.connect(user,{code:'c',codeVerifier:'v',redirectUri:'https://evil.example/auth/buffer/callback'},event),/not allowed/);
  assert.equal(tokenRequests.length,0);

  // Code exchange stores encrypted tokens, never plaintext.
  tokenServer([{status:200,body:{access_token:'access_1',refresh_token:'refresh_1',expires_in:3600,scope:'posts:read account:read offline_access'}}]);
  const connected=await OAuth.connect(user,{code:'code_1',codeVerifier:'verifier_1',redirectUri:'https://receipts.test/auth/buffer/callback'},event);
  assert.equal(connected.connected,true);
  assert.deepEqual(tokenRequests[0],{client_id:'public_client_id',grant_type:'authorization_code',code:'code_1',redirect_uri:'https://receipts.test/auth/buffer/callback',code_verifier:'verifier_1'});
  assert.ok(!JSON.stringify(row).includes('access_1')&&!JSON.stringify(row).includes('refresh_1'),'tokens are encrypted at rest');
  assert.equal(C.decrypt(row.access_token_ciphertext),'access_1');

  // A fresh token is returned without refreshing.
  assert.equal(await OAuth.accessToken('user_1'),'access_1');
  assert.equal(tokenRequests.length,1);

  // An expiring token is refreshed; Buffer omitting refresh_token keeps the old one.
  row.expires_at=new Date(Date.now()+30*1000).toISOString();
  tokenServer([{status:200,body:{access_token:'access_2',expires_in:3600}}]);
  assert.equal(await OAuth.accessToken('user_1'),'access_2');
  assert.equal(tokenRequests[1].grant_type,'refresh_token');
  assert.equal(tokenRequests[1].refresh_token,'refresh_1');
  assert.equal(C.decrypt(row.refresh_token_ciphertext),'refresh_1');

  // A failed refresh flags the connection for reconnect.
  tokenServer([{status:400,body:{error:'invalid_grant'}}]);
  await assert.rejects(()=>OAuth.accessToken('user_1',true),err=>err.reconnect===true&&err.statusCode===401);
  assert.equal(row.needs_reconnect,true);
  assert.equal((await OAuth.connectionStatus('user_1')).needsReconnect,true);

  // Disconnect removes the connection.
  await OAuth.disconnect(user);
  assert.equal((await OAuth.connectionStatus('user_1')).connected,false);
  assert.equal(await OAuth.accessToken('user_1'),'');

  // A missing table (migration 003 not applied) reads as "not connected" rather than crashing bootstrap.
  stub('_lib/supabase.js',{one:async()=>{throw new Error('relation "buffer_connections" does not exist');}});
  delete require.cache[require.resolve(path.join(functionsRoot,'_lib/buffer-oauth.js'))];
  const Fresh=require(path.join(functionsRoot,'_lib/buffer-oauth.js'));
  assert.equal((await Fresh.connectionStatus('user_1')).connected,false);

  console.log('Buffer OAuth tests passed.');
})().catch(error=>{console.error(error);process.exit(1);});
