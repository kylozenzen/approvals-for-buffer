'use strict';
const cors={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'content-type, authorization, x-buffer-token',
  'access-control-allow-methods':'POST, OPTIONS',
  'cache-control':'no-store'
};
function json(status,body,headers){return {statusCode:status,headers:Object.assign({},cors,headers||{}),body:JSON.stringify(body)};}
function options(event){return event.httpMethod==='OPTIONS'?{statusCode:204,headers:cors,body:''}:null;}
function parse(event){try{return event.body?JSON.parse(event.body):{};}catch(e){throw Object.assign(new Error('Invalid JSON body.'),{statusCode:400});}}
function fail(error){console.error('[Receipts]',error);return json(error.statusCode||500,{error:error.message||'Unexpected server error.'});}
module.exports={json,options,parse,fail,cors};
