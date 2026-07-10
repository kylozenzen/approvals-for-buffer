'use strict';
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
    throw Object.assign(new Error((data.errors&&data.errors[0]&&data.errors[0].message)||data.error||'Buffer API request failed.'),{statusCode:res.status||502});
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

async function getPosts(token){
  if(!token)throw Object.assign(new Error('Add a Buffer API key in Settings or configure BUFFER_API_KEY in Netlify.'),{statusCode:400});
  const account=await call(token,'query GetOrganizations { account { organizations { id name ownerEmail } } }');
  const orgs=account&&account.data&&account.data.account&&account.data.account.organizations||[];
  const orgId=(process.env.BUFFER_ORGANIZATION_ID||'').trim();
  const org=orgId?orgs.find(item=>item.id===orgId):orgs[0];
  if(!org)return {posts:[],organization:null};
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
  return {posts,organization:{id:org.id,name:org.name,ownerEmail:org.ownerEmail||''},organizationCount:orgs.length};
}

module.exports={getPosts};
