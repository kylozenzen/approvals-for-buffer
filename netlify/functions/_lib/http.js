'use strict';
function allowedOrigin(){return (process.env.APP_BASE_URL||'').replace(/\/$/,'');}
function requestHost(event){
  const headers=event.headers||{};
  return String(headers['x-forwarded-host']||headers['X-Forwarded-Host']||headers.host||headers.Host||'').split(',')[0].trim().toLowerCase();
}
function originAllowed(event){
  const headers=event.headers||{},origin=headers.origin||headers.Origin;
  if(!origin)return true;
  if(origin.replace(/\/$/,'')===allowedOrigin())return true;
  try{return new URL(origin).host.toLowerCase()===requestHost(event);}catch(e){return false;}
}
function corsHeaders(){const origin=allowedOrigin(),headers={'content-type':'application/json; charset=utf-8','access-control-allow-headers':'content-type, authorization, x-buffer-token','access-control-allow-methods':'POST, OPTIONS','cache-control':'no-store','vary':'Origin'};if(origin)headers['access-control-allow-origin']=origin;return headers;}
function json(status,body,headers){return {statusCode:status,headers:Object.assign({},corsHeaders(),headers||{}),body:JSON.stringify(body)};}
function options(event){if(event.httpMethod!=='OPTIONS')return null;if(!originAllowed(event))return json(403,{error:'Origin is not allowed.'});return {statusCode:204,headers:corsHeaders(),body:''};}
function parse(event){try{return event.body?JSON.parse(event.body):{};}catch(e){throw Object.assign(new Error('Invalid JSON body.'),{statusCode:400});}}
function fail(error){console.error('[Receipts]',error);return json(error.statusCode||500,{error:error.message||'Unexpected server error.'});}
module.exports={json,options,originAllowed,parse,fail};
