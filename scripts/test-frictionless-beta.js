'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const root=path.resolve(__dirname,'..');
const authSource=fs.readFileSync(path.join(root,'js/auth.js'),'utf8');

async function authScenario(frictionless,existing,created){
  let anonymousCalls=0,magicCalls=0,sessionSet;
  const auth={
    getSession:async()=>({data:{session:existing||null},error:null}),
    signInAnonymously:async()=>{anonymousCalls++;return created instanceof Error?{data:{session:null},error:created}:{data:{session:created},error:null};},
    signInWithOtp:async()=>{magicCalls++;return {error:null};},
    onAuthStateChange:()=>{},signOut:async()=>{}
  };
  const window={location:{origin:'https://receipts.test'},ReceiptsAPI:{init:async()=>({mode:'remote',config:{supabaseUrl:'https://project.test',supabaseAnonKey:'public-anon',frictionlessBeta:frictionless}}),setSession:s=>{sessionSet=s;}},supabase:{createClient:()=>({auth})}};
  vm.runInNewContext(authSource,{window,Error});
  let result,error;
  try{result=await window.ReceiptsAuth.init();}catch(e){error=e;}
  return {window,result,error,anonymousCalls,magicCalls:()=>magicCalls,sessionSet};
}
(async()=>{
  const none=await authScenario(false,null,{user:{id:'unused'},access_token:'unused'});
  assert.equal(none.anonymousCalls,0,'normal mode must preserve magic-link gate');
  assert.equal(none.result.session,null);
  await none.window.ReceiptsAuth.sendMagicLink('creator@example.com');
  assert.equal(none.magicCalls(),1,'normal mode still sends a magic link');

  const created={user:{id:'anonymous-a'},access_token:'token-a'};
  const fresh=await authScenario(true,null,created);
  assert.equal(fresh.anonymousCalls,1);
  assert.equal(fresh.sessionSet.user.id,'anonymous-a');

  const existing={user:{id:'anonymous-existing'},access_token:'existing-token'};
  const reused=await authScenario(true,existing,created);
  assert.equal(reused.anonymousCalls,0,'an existing session must be reused');
  assert.equal(reused.sessionSet.user.id,'anonymous-existing');

  const failed=await authScenario(true,null,new Error('disabled'));
  assert.match(failed.error.message,/temporary beta workspace/);

  const second=await authScenario(true,null,{user:{id:'anonymous-b'},access_token:'token-b'});
  assert.notEqual(fresh.sessionSet.user.id,second.sessionSet.user.id,'anonymous testers receive distinct IDs');

  const config=require('../netlify/functions/config');
  const old=process.env.FRICTIONLESS_BETA;
  process.env.FRICTIONLESS_BETA='true';
  let response=await config.handler();
  assert.equal(JSON.parse(response.body).frictionlessBeta,true);
  process.env.FRICTIONLESS_BETA='false';
  response=await config.handler();
  assert.equal(JSON.parse(response.body).frictionlessBeta,false);
  if(old===undefined)delete process.env.FRICTIONLESS_BETA;else process.env.FRICTIONLESS_BETA=old;

  const app=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'js/api.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  const creator=fs.readFileSync(path.join(root,'netlify/functions/creator-api.js'),'utf8');
  const review=fs.readFileSync(path.join(root,'netlify/functions/review-api.js'),'utf8');
  assert.match(creator,/userFromEvent\(event\)/,'creator API remains authenticated');
  assert.doesNotMatch(review,/userFromEvent\(event\)/,'public review API remains creator-login-free');
  assert.match(app,/if\(state\.reviewToken\)\{await API\.init\(\);return loadRoom\(\);\}/,'review rooms bypass creator auth initialization');
  assert.match(creator,/user_id=eq\.'\+q\(user\.id\)/,'creator rows remain scoped to the authenticated user');
  assert.match(api,/var bufferToken='';/);
  assert.doesNotMatch(api,/localStorage[^\n]*bufferToken|bufferToken[^\n]*localStorage/,'Buffer key stays memory-only');
  assert.match(app,/WALKTHROUGH_KEY/);assert.match(app,/localStorage\.getItem\(WALKTHROUGH_KEY\)/);assert.match(app,/replayWalkthrough/);
  assert.match(app,/RECEIPT_NUDGE_KEY/);assert.match(app,/localStorage\.setItem\(RECEIPT_NUDGE_KEY,'true'\)/);
  assert.doesNotMatch(app,/fields=\{[^}]*buffer|fields=\{[^}]*token|fields=\{[^}]*approval/i,'feedback allowlist excludes sensitive values');
  assert.match(ui,/exact approved snapshot, approver, approval timestamp, version, and fingerprint/);

  const html=fs.readFileSync(path.join(root,'app.html'),'utf8');
  const blueprint=(html.match(/<form name="beta-feedback"[\s\S]*?<\/form>/)||[''])[0];
  const visible=(ui.match(/function feedbackModal\(\)[\s\S]*?function approvalNudge/)||[''])[0];
  const names=['form-name','name','email','what_happened','message','creator_page','timestamp','user_agent','creator_id','frictionless_beta'];
  names.forEach(name=>assert.match(blueprint,new RegExp('name="'+name+'"'),'blueprint missing '+name));
  names.forEach(name=>assert.match(visible,new RegExp('name="'+name+'"'),'visible form missing '+name));
  ['creator_page','timestamp','user_agent','creator_id','frictionless_beta'].forEach(name=>assert.match(app,new RegExp(name+':'),'AJAX context missing '+name));
  console.log('Frictionless beta checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
