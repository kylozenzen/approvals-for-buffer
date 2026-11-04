'use strict';
// Read-only post sync plus Buffer's Notes API (experimental; needs the
// notes:read and notes:write scopes). Notes guide:
// https://developers.buffer.com/guides/notes.html
const POSTS_QUERY=`query GetPosts($orgId: OrganizationId!, $statuses: [PostStatus!]!) {
  posts(
    first: 50
    input: {
      organizationId: $orgId
      filter: { status: $statuses }
      sort: [{ field: createdAt, direction: desc }]
    }
  ) {
    edges {
      node {
        id
        text
        status
        createdAt
        dueAt
        channelId
        channel { name service displayName }
        assets {
          type
          mimeType
          source
          thumbnail
        }
      }
    }
  }
}`;

const LIST_NOTES_QUERY=`query ListNotes($input: CollaborationNotesInput!, $first: Int = 100, $after: String) {
  collaborationNotes(input: $input, first: $first, after: $after) {
    edges {
      node {
        id
        text
        authorId
        author { id name }
        createdAt
        updatedAt
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CREATE_NOTE_MUTATION=`mutation CreateNote($input: CreateCollaborationNoteInput!) {
  createCollaborationNote(input: $input) {
    __typename
    ... on CreateCollaborationNoteSuccess { edge { node { id text } } }
    ... on MutationError { message }
  }
}`;

const DELETE_NOTE_MUTATION=`mutation DeleteNote($input: DeleteCollaborationNoteInput!) {
  deleteCollaborationNote(input: $input) {
    __typename
    ... on MutationError { message }
  }
}`;

async function call(token,query,variables){
  const res=await fetch('https://api.buffer.com',{
    method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify({query,variables:variables||{}})
  });
  const text=await res.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch(e){throw new Error('Buffer returned an unreadable response.');}
  if(!res.ok||data.errors){
    const first=(data.errors&&data.errors[0])||{};
    const code=(first.extensions&&first.extensions.code)||'';
    const message=first.message||data.error||'Buffer API request failed.';
    const status=res.status&&res.status!==200?res.status:502;
    throw Object.assign(new Error(message),{statusCode:status,bufferStatus:res.status,graphql:Boolean(data.errors),code});
  }
  return data;
}

// Missing notes:read / notes:write on the key or OAuth token.
function isScopeError(error){
  return Boolean(error&&(error.code==='INSUFFICIENT_SCOPE'||/INSUFFICIENT_SCOPE|insufficient scope|notes:(read|write)/i.test(error.message||'')));
}

function normalizeAssets(value){
  return (Array.isArray(value)?value:[]).map(asset=>({
    type:asset&&asset.type||'',
    mimeType:asset&&asset.mimeType||'',
    source:asset&&asset.source||'',
    thumbnail:asset&&asset.thumbnail||''
  }));
}

function normalizeNote(node){
  if(!node||!node.id||!String(node.text||'').trim())return null;
  return {
    id:String(node.id),
    text:String(node.text).trim(),
    authorName:(node.author&&node.author.name)||'Buffer teammate',
    createdAt:node.createdAt||null,
    updatedAt:node.updatedAt||node.createdAt||null
  };
}

async function getPosts(token,selectedOrgId){
  if(!token)throw Object.assign(new Error('Connect Buffer in Settings, add a Buffer API key, or configure BUFFER_API_KEY in Netlify.'),{statusCode:400});
  const account=await call(token,'query GetOrganizations { account { organizations { id name ownerEmail } } }');
  const orgs=account&&account.data&&account.data.account&&account.data.account.organizations||[];
  const orgId=(selectedOrgId||process.env.BUFFER_ORGANIZATION_ID||'').trim();
  const org=orgId?orgs.find(item=>item.id===orgId):orgs[0];
  if(!org)return {posts:[],organization:null,organizations:orgs};
  const postsData=await call(token,POSTS_QUERY,{orgId:org.id,statuses:['draft','needs_approval','scheduled']});
  const edges=(postsData.data&&postsData.data.posts&&postsData.data.posts.edges)||[];
  const seen=new Set();
  const posts=edges
    .map(edge=>edge.node)
    .filter(node=>node&&node.id&&!seen.has(node.id)&&seen.add(node.id))
    .map(node=>{
      const assets=normalizeAssets(node.assets);
      const first=assets[0]||{};
      return {
        bufferId:node.id,
        caption:node.text||'',
        image:first.thumbnail||first.source||'',
        assets,
        platform:(node.channel&&(node.channel.displayName||node.channel.name||node.channel.service))||'Buffer',
        service:(node.channel&&node.channel.service)||'',
        channelId:node.channelId||'',
        bufferStatus:node.status||'draft',
        dueAt:node.dueAt||null,
        createdAt:node.createdAt||new Date().toISOString()
      };
    });
  return {posts,organization:{id:org.id,name:org.name,ownerEmail:org.ownerEmail||''},organizationCount:orgs.length,organizations:orgs.map(item=>({id:item.id,name:item.name})),truncated:edges.length>=50};
}

// All notes on one post's thread, newest first (up to 5 pages of 100).
async function listPostNotes(token,postId){
  const notes=[];
  let after=null;
  for(let page=0;page<5;page++){
    const data=await call(token,LIST_NOTES_QUERY,{input:{subject:{postId}},first:100,after});
    const conn=data.data&&data.data.collaborationNotes;
    ((conn&&conn.edges)||[]).forEach(edge=>{const note=normalizeNote(edge&&edge.node);if(note)notes.push(note);});
    if(!conn||!conn.pageInfo||!conn.pageInfo.hasNextPage||!conn.pageInfo.endCursor)break;
    after=conn.pageInfo.endCursor;
  }
  return notes;
}

async function createPostNote(token,postId,text){
  const data=await call(token,CREATE_NOTE_MUTATION,{input:{subject:{postId},text:String(text).slice(0,4000),annotations:[]}});
  const result=data.data&&data.data.createCollaborationNote;
  if(!result||result.__typename!=='CreateCollaborationNoteSuccess'){
    throw Object.assign(new Error((result&&result.message)||'Buffer did not save the note.'),{statusCode:502,typename:result&&result.__typename});
  }
  const node=result.edge&&result.edge.node;
  return {id:node&&node.id?String(node.id):null};
}

async function deletePostNote(token,noteId){
  const data=await call(token,DELETE_NOTE_MUTATION,{input:{noteId}});
  const result=data.data&&data.data.deleteCollaborationNote;
  if(!result||result.__typename!=='DeleteCollaborationNoteSuccess'){
    throw Object.assign(new Error((result&&result.message)||'Buffer did not delete the note.'),{statusCode:502,typename:result&&result.__typename});
  }
  return true;
}

module.exports={getPosts,listPostNotes,createPostNote,deletePostNote,normalizeNote,isScopeError,call};
