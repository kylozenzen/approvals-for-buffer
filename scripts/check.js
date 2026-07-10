'use strict';
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const required=['index.html','app.html','netlify.toml','.env.example','supabase/migrations/001_receipts_beta.sql'];
let failed=false;
for(const file of required){
  if(!fs.existsSync(path.join(root,file))){console.error('Missing required file:',file);failed=true;}
}
function walk(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name);
    if(entry.name==='node_modules'||entry.name==='.git')return [];
    return entry.isDirectory()?walk(full):[full];
  });
}
for(const file of walk(root).filter(file=>file.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){failed=true;console.error(result.stderr||result.stdout);}
}
if(failed)process.exit(1);
console.log('Receipts Buffer-only MVP checks passed.');
