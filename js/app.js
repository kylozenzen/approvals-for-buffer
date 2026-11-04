'use strict';
(function(){
  var U=window.ReceiptsUtil,API=window.ReceiptsAPI,UI=window.ReceiptsUI,Auth=window.ReceiptsAuth;
  var app=document.getElementById('app');
  var state={page:'board',data:null,session:null,reviewToken:null,room:null,expandedReviewPostId:undefined,bufferOrganizations:[]};
  var WALKTHROUGH_KEY='receipts_frictionless_walkthrough_complete_v1';
  var RECEIPT_NUDGE_KEY='receipts_frictionless_receipt_nudge_v1';

  function getReviewToken(){var m=window.location.pathname.match(/^\/(?:review|r)\/([^/]+)/);if(m)return decodeURIComponent(m[1]);var q=new URLSearchParams(window.location.search);return q.get('review')||q.get('stamp');}
  function render(){if(state.reviewToken){if(state.room)app.innerHTML=UI.reviewRoom(state.room,state.reviewToken,state.expandedReviewPostId);return;}if(API.getMode()==='remote'&&!state.session){app.innerHTML=API.getConfig().frictionlessBeta?UI.betaError('Your browser-based beta session ended. Refresh to start or recover your workspace.'):UI.login();return;}if(!state.data){app.innerHTML=UI.loading();return;}app.innerHTML=UI.renderCreator(state);}
  function afterCreatorLoad(){
    if(!API.getConfig().frictionlessBeta)return;
    if(localStorage.getItem(WALKTHROUGH_KEY)!=='true'){U.openModal(UI.walkthrough(0));return;}
    if((state.data.receipts||[]).length&&localStorage.getItem(RECEIPT_NUDGE_KEY)!=='true'){
      localStorage.setItem(RECEIPT_NUDGE_KEY,'true');
      document.getElementById('nudge-root').innerHTML=UI.approvalNudge();
    }
  }
  // A "Full review thread" link in a Buffer note opens /app?post=<id> straight to that post.
  var linkedPostId=(function(){try{return new URLSearchParams(window.location.search).get('post');}catch(e){return null;}})();
  function openLinkedPost(){
    if(!linkedPostId||!state.data)return;
    var id=linkedPostId;linkedPostId=null;
    try{var url=new URL(window.location.href);url.searchParams.delete('post');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}catch(e){}
    if((state.data.posts||[]).some(function(p){return p.id===id;}))window.ReceiptsActions.openPost(id);
    else U.toast('That post isn\'t in your Receipts board.');
  }
  async function loadCreator(){app.innerHTML=UI.loading('Loading your approval board…');try{state.data=await API.bootstrap();render();afterCreatorLoad();openLinkedPost();setTimeout(afterCreatorReady,0);}catch(e){app.innerHTML=UI.error(e.message);}}
  async function loadRoom(){app.innerHTML=UI.loading('Opening approval room…');try{state.room=await API.getReviewRoom(state.reviewToken);if(state.expandedReviewPostId===undefined){var firstWaiting=(state.room.posts||[]).find(function(p){return p.status==='review';});state.expandedReviewPostId=firstWaiting?firstWaiting.id:null;}render();}catch(e){app.innerHTML=UI.error(e.message);}}
  async function refresh(){if(state.reviewToken)return loadRoom();return loadCreator();}
  async function boot(){app.innerHTML=UI.loading();state.reviewToken=getReviewToken();try{if(state.reviewToken){await API.init();return loadRoom();}var auth=await Auth.init();state.session=auth.session;if(auth.mode==='remote'&&!auth.session){render();return;}if(isBufferCallback())return finishBufferConnect();await loadCreator();}catch(e){app.innerHTML=API.getConfig().frictionlessBeta?UI.betaError(e.message):UI.error(e.message);}}
  function onAuthChange(session){state.session=session;if(state.reviewToken)return;if(session)loadCreator();else{state.data=null;render();}}
  async function run(task,success){try{await task();if(success)U.toast(success);await refresh();}catch(e){U.toast(e.message||'Something went wrong');}}
  var BUFFER_OAUTH_PREFIX='receipts',BUFFER_CALLBACK_PATH='/auth/buffer/callback';
  function isBufferCallback(){return window.location.pathname===BUFFER_CALLBACK_PATH;}
  function bufferConnected(){return Boolean(state.data&&state.data.buffer&&state.data.buffer.connected&&!state.data.buffer.needsReconnect);}
  async function finishBufferConnect(){
    app.innerHTML=UI.loading('Finishing your Buffer connection…');
    var result;
    try{
      if(!window.BufferOAuth)throw new Error('Buffer sign-in did not load. Refresh and try again.');
      result=await window.BufferOAuth.handleCallback({prefix:BUFFER_OAUTH_PREFIX,clientId:API.getConfig().bufferOAuthClientId,exchange:function(payload){return API.connectBuffer(payload);}});
    }catch(e){result={ok:false,message:e.message};}
    window.history.replaceState(null,'','/app');
    state.page='settings';
    await loadCreator();
    if(!result.ok){U.toast(result.reason==='cancelled'?'Buffer connection cancelled':(result.message||'Buffer connection failed'));return;}
    U.toast('Buffer connected');
    await performSync();
  }
  var syncing=false,lastSyncAt=0,lastNoteError='';
  function canAutoSync(){return API.getMode()==='remote'&&Boolean(API.getBufferToken()||bufferConnected()||API.getConfig().bufferKeyConfigured);}
  // Reload board data without the full-screen loading state (open modals live in #modal-root and stay put).
  async function softRefresh(){try{state.data=await API.bootstrap();render();}catch(e){}}
  function noteMessages(out,quiet){
    if(out.notesNeedMigration)U.toast('Buffer notes need Supabase migration 003 before they can sync.');
    if(out.notesNeedScope)U.toast(bufferConnected()?'Reconnect Buffer in Settings to allow Notes.':'Your Buffer key needs Notes access (notes:read and notes:write). Make a new key with Notes enabled.');
    if(out.notesError){var msg='Buffer Notes could not be read: '+out.notesError;if(!quiet||msg!==lastNoteError)U.toast(msg);lastNoteError=msg;}
    if(out.notesPushError){var pmsg='Could not update Buffer notes: '+out.notesPushError;if(!quiet||pmsg!==lastNoteError)U.toast(pmsg);lastNoteError=pmsg;}
    if(out.notesPushed)U.toast('Buffer notes updated for '+out.notesPushed+' client '+(out.notesPushed===1?'response':'responses'));
    if(out.notesNoToken&&!quiet)U.toast('Receipts can\'t reach Buffer in this tab. Paste your Buffer key (with Notes access) or connect Buffer in Settings.');
  }
  // quiet: background sync on load, on a timer, and when the tab regains focus.
  // It only speaks up when something new arrived or something needs fixing.
  async function performSync(options){
    options=options||{};
    if(syncing)return null;
    syncing=true;
    try{
      if(!options.quiet)U.toast('Refreshing tracked Buffer posts…');
      var out=await API.syncBuffer(API.getBufferToken());
      lastSyncAt=Date.now();
      state.bufferOrganizations=out.organizations||[];
      if(options.quiet)await softRefresh();else await refresh();
      var total=(out.added||0)+(out.updated||0);
      var noteCount=(out.notesAdded||0)+(out.notesUpdated||0);
      if(!options.quiet)U.toast((total?'Buffer synced · '+total+' post'+(total===1?'':'s')+' checked':'Buffer synced · no active posts found')+(noteCount?' · '+noteCount+' Buffer note'+(noteCount===1?'':'s')+' pulled in':''));
      else if(noteCount)U.toast(noteCount+' Buffer notes updated');
      noteMessages(out,options.quiet);
      if(out.truncated&&!options.quiet)U.toast('Buffer returned the first 50 active posts.');
      var selected=state.data&&state.data.profile&&state.data.profile.bufferOrganizationId;
      if(out.organizationCount>1&&!selected&&!options.deferOrganization)U.openModal(UI.organizationModal(state.bufferOrganizations,out.organization&&out.organization.id));
      return out;
    }catch(e){
      if(options.throwOnError)throw e;
      if(!options.quiet||/reconnect/i.test(e.message||''))U.toast(e.message||'Buffer sync failed');
      if(/reconnect/i.test(e.message||''))refresh();
      return null;
    }finally{syncing=false;}
  }
  var AUTO_SYNC_MS=2*60*1000;
  function startAutoSync(){
    if(startAutoSync.started)return;startAutoSync.started=true;
    setInterval(function(){if(!state.reviewToken&&document.visibilityState==='visible'&&canAutoSync())performSync({quiet:true,deferOrganization:true});},AUTO_SYNC_MS);
    document.addEventListener('visibilitychange',function(){if(!state.reviewToken&&document.visibilityState==='visible'&&canAutoSync()&&Date.now()-lastSyncAt>60*1000)performSync({quiet:true,deferOrganization:true});});
  }
  function afterCreatorReady(){if(state.reviewToken||API.getMode()!=='remote')return;startAutoSync();if(canAutoSync()&&Date.now()-lastSyncAt>60*1000)performSync({quiet:true,deferOrganization:true});}

  window.ReceiptsActions={
    go:function(page){state.page=page;render();window.scrollTo(0,0);},
    openSync:function(){
      var hasServerKey=Boolean(API.getConfig().bufferKeyConfigured);
      if(API.getMode()==='demo'||API.getBufferToken()||bufferConnected()||hasServerKey){performSync();return;}
      U.openModal(UI.syncModal());
    },
    sync:function(){this.openSync();},
    connectBuffer:async function(){
      var cfg=API.getConfig();
      if(API.getMode()!=='remote'){U.toast('Buffer sign-in works once the shared beta backend is configured.');return;}
      if(!cfg.bufferOAuthConfigured||!window.BufferOAuth){U.toast('Buffer sign-in is not configured yet. Paste a Buffer API key instead.');return;}
      try{await window.BufferOAuth.startAuthorization({prefix:BUFFER_OAUTH_PREFIX,clientId:cfg.bufferOAuthClientId,redirectUri:window.location.origin+BUFFER_CALLBACK_PATH,scope:cfg.bufferOAuthScope||'posts:read posts:write account:read notes:read notes:write offline_access',returnTo:'/app'});}
      catch(e){U.toast(e.message||'Could not start Buffer sign-in');}
    },
    disconnectBuffer:function(){if(!window.confirm('Disconnect Buffer? Receipts will stop syncing until you connect again. Existing posts and receipts stay.'))return;run(function(){return API.disconnectBuffer();},'Buffer disconnected');},
    toggleNote:async function(commentId,visible,postId){try{await API.setNoteVisibility(commentId,visible);U.toast(visible?'Note shared in the client room':'Note hidden from the client room');var detail=await API.getPostDetail(postId);U.openModal(UI.postModal(detail,state.data));}catch(e){U.toast(e.message||'Could not update that note');}},
    syncFromModal:async function(){
      var el=document.getElementById('sync-buffer-token'),error=document.getElementById('sync-error'),button=document.getElementById('sync-connect-button');
      var rawToken=el?el.value:'',token=rawToken.trim(),buttonLabel=button?button.innerHTML:'';
      if(!token||/\s/.test(rawToken)||token.length<20){
        if(error)error.textContent=!token?'Paste a Buffer API key first.':/\s/.test(rawToken)?'Buffer API keys cannot contain spaces.':'That key looks too short to be a Buffer API key.';
        return;
      }
      if(error)error.textContent='';
      if(button){button.disabled=true;button.textContent='Connecting…';}
      API.saveBufferToken(token);
      try{
        var out=await performSync({throwOnError:true,deferOrganization:true});
        U.closeModal();
        var selected=state.data&&state.data.profile&&state.data.profile.bufferOrganizationId;
        if(out.organizationCount>1&&!selected)U.openModal(UI.organizationModal(state.bufferOrganizations,out.organization&&out.organization.id));
      }catch(e){
        if(error)error.textContent=e.message||'Buffer sync failed. Please check your key and try again.';
        if(button){button.disabled=false;button.innerHTML=buttonLabel;}
      }
    },
    chooseOrganization:async function(organizationId){
      if(!organizationId){U.toast('Choose a Buffer organization');return;}
      U.closeModal();
      try{await API.selectBufferOrganization(organizationId);await performSync();}catch(e){U.toast(e.message||'Could not select that Buffer organization');}
    },
    openPicker:async function(clientId){this.pickerClientId=clientId||null;try{var out=await API.bufferCandidates();this.pickerPage=null;U.openModal(UI.pickerModal(out,state.data,this.pickerClientId,null));}catch(e){U.toast(e.message||'Could not browse Buffer drafts');}},
    nextDrafts:async function(after){try{var out=await API.bufferCandidates(after);this.pickerPage=after;U.openModal(UI.pickerModal(out,state.data,this.pickerClientId,after));}catch(e){U.toast(e.message||'Could not load the next drafts');}},
    importDraft:async function(bufferId,after){var select=document.getElementById('picker-room'),clientId=select&&select.value;if(!clientId){U.toast('Choose a client room first');return;}try{await API.importSelected(clientId,bufferId,after);U.closeModal();await refresh();U.toast('Selected Buffer draft imported');}catch(e){U.toast(e.message||'Could not import that draft');}},
    archivePost:async function(id){if(!window.confirm('Archive this post in Receipts? This frees the room slot but keeps all snapshots, comments, and approval receipts. Nothing is deleted from Buffer.'))return;try{await API.archivePost(id);U.closeModal();await refresh();U.toast('Post archived; its history is preserved');}catch(e){U.toast(e.message);}},
    archiveRoom:async function(id){if(!window.confirm('Archive this client room? Its public link stops working immediately and its active post is archived. All snapshots, comments, and receipts stay saved. Nothing is deleted from Buffer.'))return;try{await API.archiveClient(id);await refresh();U.toast('Room archived and public access revoked');}catch(e){U.toast(e.message);}},
    newClient:function(){if(state.data&&state.data.capacity&&state.data.capacity.activeRooms>=3){U.toast('Three rooms in use. Archive a room before creating another.');return;}U.openModal(UI.newClientModal());},
    createClient:async function(){var company=document.getElementById('new-company').value.trim(),owner=document.getElementById('new-owner').value.trim(),email=document.getElementById('new-email').value.trim();if(!company||!owner||!email){U.toast('Company, owner, and email are required');return;}var payload={company:company,name:owner,approvalOwner:owner,email:email,approvalNote:document.getElementById('new-note').value.trim(),color:document.getElementById('new-color').value};try{await API.createClient(payload);U.closeModal();await refresh();U.toast('Client room created');}catch(e){U.toast(e.message||'Room limit reached. Archive a room first.');}},
    openPost:async function(id){try{var detail=await API.getPostDetail(id);U.openModal(UI.postModal(detail,state.data));var n=detail.notes||{};if(n.added)U.toast(n.added+' new Buffer note'+(n.added===1?'':'s')+' on this post');if(n.needScope||n.error||n.pushError||n.pushed||n.noToken)noteMessages({notesNeedScope:n.needScope,notesError:n.error,notesPushError:n.pushError,notesPushed:n.pushed,notesNoToken:n.noToken},false);}catch(e){U.toast(e.message);}},
    assign:function(postId,clientId){run(function(){return API.assignPost(postId,clientId||null);},clientId?'Client assigned':'Post unassigned');},
    saveAssignment:function(postId){
      var el=document.getElementById('post-client'),clientId=el?el.value:'';
      run(function(){return API.assignPost(postId,clientId||null);},clientId?'Client assigned':'Post unassigned');U.closeModal();
    },
    assignAndReview:function(postId){
      var el=document.getElementById('post-client'),clientId=el?el.value:'';
      if(!clientId){U.toast('Choose a client first');return;}
      run(function(){return API.assignAndSendForReview(postId,clientId);},'Assigned and sent for review');
    },
    sendReview:function(postId){run(function(){return API.sendForReview(postId);},'Latest Buffer snapshot sent for review');U.closeModal();},
    creatorComment:function(postId){var el=document.getElementById('creator-comment'),body=el?el.value.trim():'';if(!body){U.toast('Write a note first');return;}run(function(){return API.addCreatorComment(postId,body);},'Creator note added');U.closeModal();},
    copyRoom:function(clientId){var c=(state.data.clients||[]).find(function(x){return x.id===clientId;});if(c&&c.roomToken)U.copy(U.roomUrl(c.roomToken),'Approval room copied');else U.toast('Rotate the room link to create a new one');},
    copyOwnerCode:function(clientId){var c=(state.data.clients||[]).find(function(x){return x.id===clientId;});if(c&&c.approvalCode)U.copy(c.approvalCode,'Owner code copied');else U.toast('Reset the owner code to create a new one');},
    invite:function(clientId){run(async function(){var out=await API.inviteClient(clientId);if(!out.sent&&out.preview)U.copy(out.preview,'Email is not configured—invite copied instead');},'Invite handled');},
    roomControls:function(clientId){U.openModal(UI.expiryModal(clientId));},
    saveRoomExpiry:function(clientId){var selected=document.querySelector('input[name="room-expiry"]:checked'),value=selected?selected.value:'7',expiresAt=value==='none'?null:new Date(Date.now()+Number(value)*24*60*60*1000).toISOString();U.closeModal();run(function(){return API.updateRoomControls(clientId,{expiresAt:expiresAt});},'Room expiry updated');},
    clearLock:function(clientId){run(function(){return API.updateRoomControls(clientId,{clearLock:true});},'Approval lock cleared');},
    rotate:function(clientId,kind){var item=kind==='room'?'link':'code';if(!window.confirm('Reset this '+item+'? The client’s existing '+item+' stops working immediately.'))return;run(function(){return API.rotateClient(clientId,kind);},kind==='room'?'Room link reset':'Owner code reset');},
    resendReceipt:function(id){run(async function(){var out=await API.resendApprovalEmail(id);U.toast(out.sent?'Approval email resent':'Email notification was not sent because email delivery is not configured.');return out;});},
    openReceipt:function(id){var r=(state.data.receipts||[]).find(function(x){return x.id===id;});if(r)U.openModal(UI.receiptModal(r));},
    saveOrganization:function(){var el=document.getElementById('buffer-organization');if(!el||!el.value.trim()){U.toast('Enter a Buffer organization ID');return;}run(function(){return API.selectBufferOrganization(el.value.trim());},'Buffer organization saved');},
    saveToken:function(){var el=document.getElementById('buffer-token');API.saveBufferToken(el?el.value.trim():'');U.toast('Buffer key is available for this session only');},
    clearToken:function(){API.saveBufferToken('');var el=document.getElementById('buffer-token');if(el)el.value='';U.toast('Buffer key cleared');},
    help:function(kind){U.openModal(UI.helpModal(kind));},
    replayWalkthrough:function(){U.openModal(UI.walkthrough(0));},
    walkthroughNext:function(step){if(step<4){U.openModal(UI.walkthrough(step));return;}this.finishWalkthrough(true);},
    finishWalkthrough:function(connect){localStorage.setItem(WALKTHROUGH_KEY,'true');U.closeModal();if(connect)this.openSync();},
    openFeedback:function(){this.dismissNudge();U.openModal(UI.feedbackModal());setTimeout(function(){var form=document.getElementById('beta-feedback-form');if(form)form.addEventListener('submit',window.ReceiptsActions.submitFeedback);},0);},
    submitFeedback:async function(event){
      event.preventDefault();var form=event.currentTarget,button=form.querySelector('[type="submit"]'),error=document.getElementById('feedback-error');
      var messageField=form.elements.namedItem('message');
      if(!messageField.value.trim()){error.textContent='Tell us what happened before sending.';return;}
      var fields={
        'form-name':'beta-feedback',name:form.elements.namedItem('name').value.trim(),email:form.elements.namedItem('email').value.trim(),what_happened:form.elements.namedItem('what_happened').value,message:messageField.value.trim(),
        creator_page:state.page,timestamp:new Date().toISOString(),user_agent:navigator.userAgent,
        creator_id:state.session&&state.session.user?state.session.user.id:'',frictionless_beta:String(Boolean(API.getConfig().frictionlessBeta))
      };
      button.disabled=true;error.textContent='';
      try{var response=await fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString()});if(!response.ok)throw new Error('Feedback could not be sent. Please try again.');U.closeModal();U.toast('Thanks — feedback sent.');}
      catch(e){button.disabled=false;error.textContent=e.message||'Feedback could not be sent. Your message is still here.';}
    },
    dismissNudge:function(){document.getElementById('nudge-root').innerHTML='';},
    resetDemo:function(){if(!window.confirm('Reset the interactive demo?'))return;run(function(){return API.reset();},'Demo restored');},
    login:async function(){var el=document.getElementById('login-email'),email=el?el.value.trim():'';if(!email){U.toast('Enter your email');return;}try{await Auth.sendMagicLink(email);U.toast('Magic link sent—check your email');}catch(e){U.toast(e.message);}},
    signOut:async function(){await Auth.signOut();}
  };

  function reviewValues(postId){var name=document.getElementById('review-name-'+postId),body=document.getElementById('review-body-'+postId);return {name:name?name.value.trim():'Client',body:body?body.value.trim():''};}
  window.ReviewActions={
    toggle:function(postId){state.expandedReviewPostId=state.expandedReviewPostId===postId?null:postId;render();},
    comment:function(token,postId){var v=reviewValues(postId);if(!v.body){U.toast('Write a comment first');return;}state.expandedReviewPostId=postId;run(function(){return API.addReviewComment(token,postId,v.name,v.body);},'Comment added');},
    changes:function(token,postId){var v=reviewValues(postId);if(!v.body){U.toast('Describe the requested change first');return;}state.expandedReviewPostId=postId;run(function(){return API.requestChanges(token,postId,v.name,v.body);},'Changes requested');},
    approveModal:function(token,postId){U.openModal(UI.approveModal(token,postId));setTimeout(function(){var el=document.getElementById('approval-code');if(el)el.focus();},50);},
    approve:function(token,postId){var code=document.getElementById('approval-code'),c=code?code.value.trim():'';if(!/^\d{6}$/.test(c)){U.toast('Enter the six-digit owner code');return;}state.expandedReviewPostId=postId;run(async function(){var out=await API.approvePost(token,postId,'',c);U.toast(out.emailSent===false?'Approval saved and receipt created. Email notification was not sent because email delivery is not configured.':'Approval stamped, receipt saved, and email sent.');return out;});U.closeModal();}
  };

  window.ReceiptsApp={state:state,onAuthChange:onAuthChange,refresh:refresh};
  boot();
})();
