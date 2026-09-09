'use strict';
(function(){
  var U=window.ReceiptsUtil,API=window.ReceiptsAPI,UI=window.ReceiptsUI,Auth=window.ReceiptsAuth;
  var app=document.getElementById('app');
  var state={page:'board',data:null,session:null,reviewToken:null,room:null,bufferOrganizations:[]};
  var WALKTHROUGH_KEY='receipts_frictionless_walkthrough_complete_v1';
  var RECEIPT_NUDGE_KEY='receipts_frictionless_receipt_nudge_v1';

  function getReviewToken(){var m=window.location.pathname.match(/^\/(?:review|r)\/([^/]+)/);if(m)return decodeURIComponent(m[1]);var q=new URLSearchParams(window.location.search);return q.get('review')||q.get('stamp');}
  function render(){if(state.reviewToken){if(state.room)app.innerHTML=UI.reviewRoom(state.room,state.reviewToken);return;}if(API.getMode()==='remote'&&!state.session){app.innerHTML=API.getConfig().frictionlessBeta?UI.betaError('Your browser-based beta session ended. Refresh to start or recover your workspace.'):UI.login();return;}if(!state.data){app.innerHTML=UI.loading();return;}app.innerHTML=UI.renderCreator(state);}
  function afterCreatorLoad(){
    if(!API.getConfig().frictionlessBeta)return;
    if(localStorage.getItem(WALKTHROUGH_KEY)!=='true'){U.openModal(UI.walkthrough(0));return;}
    if((state.data.receipts||[]).length&&localStorage.getItem(RECEIPT_NUDGE_KEY)!=='true'){
      localStorage.setItem(RECEIPT_NUDGE_KEY,'true');
      document.getElementById('nudge-root').innerHTML=UI.approvalNudge();
    }
  }
  async function loadCreator(){app.innerHTML=UI.loading('Loading your approval board…');try{state.data=await API.bootstrap();render();afterCreatorLoad();}catch(e){app.innerHTML=UI.error(e.message);}}
  async function loadRoom(){app.innerHTML=UI.loading('Opening approval room…');try{state.room=await API.getReviewRoom(state.reviewToken);render();}catch(e){app.innerHTML=UI.error(e.message);}}
  async function refresh(){if(state.reviewToken)return loadRoom();return loadCreator();}
  async function boot(){app.innerHTML=UI.loading();state.reviewToken=getReviewToken();try{if(state.reviewToken){await API.init();return loadRoom();}var auth=await Auth.init();state.session=auth.session;if(auth.mode==='remote'&&!auth.session){render();return;}await loadCreator();}catch(e){app.innerHTML=API.getConfig().frictionlessBeta?UI.betaError(e.message):UI.error(e.message);}}
  function onAuthChange(session){state.session=session;if(state.reviewToken)return;if(session)loadCreator();else{state.data=null;render();}}
  async function run(task,success){try{await task();if(success)U.toast(success);await refresh();}catch(e){U.toast(e.message||'Something went wrong');}}
  async function performSync(options){
    options=options||{};
    try{
      U.toast('Syncing Buffer…');
      var out=await API.syncBuffer(API.getBufferToken());
      state.bufferOrganizations=out.organizations||[];
      await refresh();
      var total=(out.added||0)+(out.updated||0);
      U.toast(total?'Buffer synced · '+total+' post'+(total===1?'':'s')+' checked':'Buffer synced · no active posts found');
      if(out.truncated)U.toast('Buffer returned the first 50 active posts.');
      var selected=state.data&&state.data.profile&&state.data.profile.bufferOrganizationId;
      if(out.organizationCount>1&&!selected&&!options.deferOrganization)U.openModal(UI.organizationModal(state.bufferOrganizations,out.organization&&out.organization.id));
      return out;
    }catch(e){if(options.throwOnError)throw e;U.toast(e.message||'Buffer sync failed');return null;}
  }

  window.ReceiptsActions={
    go:function(page){state.page=page;render();window.scrollTo(0,0);},
    openSync:function(){
      var hasServerKey=Boolean(API.getConfig().bufferKeyConfigured);
      if(API.getMode()==='demo'||API.getBufferToken()||hasServerKey){performSync();return;}
      U.openModal(UI.syncModal());
    },
    sync:function(){this.openSync();},
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
    newClient:function(){U.openModal(UI.newClientModal());},
    createClient:function(){var company=document.getElementById('new-company').value.trim(),owner=document.getElementById('new-owner').value.trim(),email=document.getElementById('new-email').value.trim();if(!company||!owner||!email){U.toast('Company, owner, and email are required');return;}var payload={company:company,name:owner,approvalOwner:owner,email:email,approvalNote:document.getElementById('new-note').value.trim(),color:document.getElementById('new-color').value};run(function(){return API.createClient(payload);},'Client room created');U.closeModal();},
    openPost:async function(id){try{var detail=await API.getPostDetail(id);U.openModal(UI.postModal(detail,state.data));}catch(e){U.toast(e.message);}},
    assign:function(postId,clientId){run(function(){return API.assignPost(postId,clientId||null);},clientId?'Client assigned':'Post unassigned');U.closeModal();},
    saveAssignment:function(postId){
      var el=document.getElementById('post-client'),clientId=el?el.value:'';
      run(function(){return API.assignPost(postId,clientId||null);},clientId?'Client assigned':'Post unassigned');U.closeModal();
    },
    assignAndReview:function(postId){
      var el=document.getElementById('post-client'),clientId=el?el.value:'';
      if(!clientId){U.toast('Choose a client first');return;}
      run(function(){return API.assignAndSendForReview(postId,clientId);},'Assigned and sent for review');U.closeModal();
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
    comment:function(token,postId){var v=reviewValues(postId);if(!v.body){U.toast('Write a comment first');return;}run(function(){return API.addReviewComment(token,postId,v.name,v.body);},'Comment added');},
    changes:function(token,postId){var v=reviewValues(postId);if(!v.body){U.toast('Describe the requested change first');return;}run(function(){return API.requestChanges(token,postId,v.name,v.body);},'Changes requested');},
    approveModal:function(token,postId){U.openModal(UI.approveModal(token,postId));setTimeout(function(){var el=document.getElementById('approval-code');if(el)el.focus();},50);},
    approve:function(token,postId){var code=document.getElementById('approval-code'),c=code?code.value.trim():'';if(!/^\d{6}$/.test(c)){U.toast('Enter the six-digit owner code');return;}run(async function(){var out=await API.approvePost(token,postId,'',c);U.toast(out.emailSent===false?'Approval saved and receipt created. Email notification was not sent because email delivery is not configured.':'Approval stamped, receipt saved, and email sent.');return out;});U.closeModal();}
  };

  window.ReceiptsApp={state:state,onAuthChange:onAuthChange,refresh:refresh};
  boot();
})();
