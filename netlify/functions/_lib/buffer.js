'use strict';
// Buffer notes (Post.notes) are internal team comments written inside Buffer.
// They are pulled read-only; see https://developers.buffer.com/reference.html (Note type).
const NOTES_FIELDS=`
        notes {
          id
          text
          type
          createdAt
          updatedAt
          author { name }
        }`;

function postsQuery(includeNotes){
  return `query GetPosts($orgId: OrganizationId!, $statuses: [PostStatus!]!) {
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
        }${includeNotes?NOTES_FIELDS:''}
      }
    }
  }
}`;
}

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
    const status=res.status&&res.status!==200?res.status:502;
    const message=(data.errors&&data.errors[0]&&data.errors[0].message)||data.error||'Buffer API request failed.';
    throw Object.assign(new Error(message),{statusCode:status,bufferStatus:res.status,graphql:Boolean(data.errors)});
  }
  return data;
}

function normalizeAssets(value){
  return (Array.isArray(value)?value:[]).map(asset=>({
    type:asset&&asset.type||'',
    mimeType:asset&&asset.mimeType||'',
    source:asset&&asset.source||'',
    thumbnail:asset&&asset.thumbnail||''
  }));
}

function normalizeNotes(value){
  return (Array.isArray(value)?value:[])
    .filter(note=>note&&note.id&&String(note.text||'').trim())
    .map(note=>({
      id:String(note.id),
      text:String(note.text).trim(),
      type:note.type||'',
      authorName:(note.author&&note.author.name)||'Buffer teammate',
      createdAt:note.createdAt||null,
      updatedAt:note.updatedAt||note.createdAt||null
    }));
}

// A GraphQL validation error that names the notes field means this Buffer
// account/client can't read notes yet. Retry without them instead of failing sync.
function isNotesFieldError(error){
  return Boolean(error&&error.graphql&&/\bnotes?\b|\bNote\b/i.test(error.message||''));
}

async function getPosts(token,selectedOrgId){
  if(!token)throw Object.assign(new Error('Connect Buffer in Settings, add a Buffer API key, or configure BUFFER_API_KEY in Netlify.'),{statusCode:400});
  const account=await call(token,'query GetOrganizations { account { organizations { id name ownerEmail } } }');
  const orgs=account&&account.data&&account.data.account&&account.data.account.organizations||[];
  const orgId=(selectedOrgId||process.env.BUFFER_ORGANIZATION_ID||'').trim();
  const org=orgId?orgs.find(item=>item.id===orgId):orgs[0];
  if(!org)return {posts:[],organization:null,organizations:orgs,notesAvailable:false};
  const variables={orgId:org.id,statuses:['draft','needs_approval','scheduled']};
  let postsData,notesAvailable=true;
  try{
    postsData=await call(token,postsQuery(true),variables);
  }catch(error){
    if(!isNotesFieldError(error))throw error;
    console.warn('[Receipts] Buffer notes unavailable, syncing without them:',error.message);
    notesAvailable=false;
    postsData=await call(token,postsQuery(false),variables);
  }
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
        createdAt:node.createdAt||new Date().toISOString(),
        notes:notesAvailable?normalizeNotes(node.notes):[]
      };
    });
  return {posts,notesAvailable,organization:{id:org.id,name:org.name,ownerEmail:org.ownerEmail||''},organizationCount:orgs.length,organizations:orgs.map(item=>({id:item.id,name:item.name})),truncated:edges.length>=50};
}

module.exports={getPosts,normalizeNotes,isNotesFieldError,postsQuery};
