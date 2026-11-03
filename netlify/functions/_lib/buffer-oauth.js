'use strict';
// Buffer OAuth (authorization code + PKCE) for Receipts.
//
// The browser starts the flow and keeps the PKCE verifier; the code exchange and
// every refresh happen here so tokens never live in the browser. Tokens are
// encrypted with RECEIPTS_ENCRYPTION_SECRET and stored in public.buffer_connections.
const db=require('./supabase');
const C=require('./crypto');

const TOKEN_ENDPOINT='https://auth.buffer.com/token';
const CALLBACK_PATH='/auth/buffer/callback';
const REFRESH_SKEW_MS=2*60*1000;

function q(v){return encodeURIComponent(v);}
function clientId(){return String(process.env.BUFFER_OAUTH_CLIENT_ID||'').trim();}
function isConfigured(){return Boolean(clientId());}

function allowedRedirectUris(event){
  const headers=(event&&event.headers)||{};
  const host=String(headers['x-forwarded-host']||headers.host||'').split(',')[0].trim();
  const proto=String(headers['x-forwarded-proto']||'https').split(',')[0].trim();
  const bases=[(process.env.APP_BASE_URL||'').replace(/\/$/,'')];
  if(host)bases.push(proto+'://'+host);
  return bases.filter(Boolean).map(base=>base+CALLBACK_PATH);
}

async function tokenRequest(params){
  const id=clientId();
  if(!id)throw Object.assign(new Error('Buffer OAuth is not configured. Add BUFFER_OAUTH_CLIENT_ID in Netlify.'),{statusCode:503});
  const body=new URLSearchParams(Object.assign({client_id:id},params));
  if(process.env.BUFFER_OAUTH_CLIENT_SECRET)body.set('client_secret',process.env.BUFFER_OAUTH_CLIENT_SECRET);
  const res=await fetch(TOKEN_ENDPOINT,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()});
  const text=await res.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch(e){data={};}
  if(!res.ok||!data.access_token){
    const message=data.error_description||data.error||'Buffer did not return an access token.';
    throw Object.assign(new Error(message),{statusCode:res.status>=500?502:400,oauthError:data.error||'token_request_failed'});
  }
  return data;
}

function rowFromTokens(tokens,previous){
  const expiresIn=Number(tokens.expires_in||0);
  const scope=Array.isArray(tokens.scope)?tokens.scope.join(' '):String(tokens.scope||'');
  return {
    access_token_ciphertext:C.encrypt(tokens.access_token),
    // Buffer may omit refresh_token on refresh; keep the one we already have.
    refresh_token_ciphertext:tokens.refresh_token?C.encrypt(tokens.refresh_token):(previous&&previous.refresh_token_ciphertext)||null,
    expires_at:expiresIn?new Date(Date.now()+expiresIn*1000).toISOString():null,
    scope:scope||(previous&&previous.scope)||'',
    needs_reconnect:false
  };
}

async function loadConnection(userId){
  return db.one('buffer_connections','select=*&user_id=eq.'+q(userId));
}

async function connect(user,p,event){
  const code=String(p.code||'').trim(),verifier=String(p.codeVerifier||'').trim(),redirectUri=String(p.redirectUri||'').trim();
  if(!code||!verifier||!redirectUri)throw Object.assign(new Error('Buffer sign-in did not finish. Please try connecting again.'),{statusCode:400});
  if(!allowedRedirectUris(event).includes(redirectUri))throw Object.assign(new Error('This Buffer redirect address is not allowed for this site.'),{statusCode:400});
  const tokens=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirectUri,code_verifier:verifier});
  const row=Object.assign({user_id:user.id,connected_at:new Date().toISOString()},rowFromTokens(tokens,null));
  await db.rest('buffer_connections','POST','on_conflict=user_id',row,'resolution=merge-duplicates,return=minimal');
  return status({scope:row.scope,expires_at:row.expires_at,connected_at:row.connected_at,needs_reconnect:false});
}

async function disconnect(user){
  await db.remove('buffer_connections','user_id=eq.'+q(user.id));
  return status(null);
}

async function markReconnect(userId){
  try{await db.update('buffer_connections','user_id=eq.'+q(userId),{needs_reconnect:true});}catch(e){console.error('[Receipts] Could not flag Buffer reconnect:',e.message);}
}

async function refresh(userId,row){
  let refreshToken='';
  try{refreshToken=C.decrypt(row.refresh_token_ciphertext);}catch(e){}
  if(!refreshToken){await markReconnect(userId);throw Object.assign(new Error('Your Buffer connection expired. Reconnect Buffer in Settings.'),{statusCode:401,reconnect:true});}
  let tokens;
  try{tokens=await tokenRequest({grant_type:'refresh_token',refresh_token:refreshToken});}
  catch(e){await markReconnect(userId);throw Object.assign(new Error('Buffer needs you to reconnect. Open Settings and choose Connect with Buffer.'),{statusCode:401,reconnect:true});}
  const next=rowFromTokens(tokens,row);
  await db.update('buffer_connections','user_id=eq.'+q(userId),next);
  return tokens.access_token;
}

// Returns a usable access token for this creator, refreshing if it is about to expire.
// force=true refreshes regardless of expiry (used after Buffer answers 401).
async function accessToken(userId,force){
  const row=await loadConnection(userId);
  if(!row)return '';
  const expired=row.expires_at&&new Date(row.expires_at).getTime()-REFRESH_SKEW_MS<=Date.now();
  if(force||expired||row.needs_reconnect)return refresh(userId,row);
  try{return C.decrypt(row.access_token_ciphertext);}catch(e){return refresh(userId,row);}
}

function status(row){
  return {
    connected:Boolean(row),
    needsReconnect:Boolean(row&&row.needs_reconnect),
    connectedAt:(row&&row.connected_at)||null,
    expiresAt:(row&&row.expires_at)||null,
    scope:(row&&row.scope)||''
  };
}

async function connectionStatus(userId){
  try{return status(await loadConnection(userId));}
  catch(e){
    // Migration 003 not applied yet: behave as "not connected" instead of breaking bootstrap.
    console.warn('[Receipts] buffer_connections unavailable:',e.message);
    return status(null);
  }
}

module.exports={CALLBACK_PATH,isConfigured,clientId,allowedRedirectUris,connect,disconnect,accessToken,connectionStatus,status};
