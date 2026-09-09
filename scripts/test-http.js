'use strict';
const assert=require('node:assert/strict');

process.env.APP_BASE_URL='https://receipts.example';
const H=require('../netlify/functions/_lib/http');

assert.equal(H.originAllowed({headers:{origin:'https://receipts.example',host:'receipts.example'}}),true);
assert.equal(H.originAllowed({headers:{origin:'https://deploy-preview-12--receipts.netlify.app',host:'deploy-preview-12--receipts.netlify.app'}}),true);
assert.equal(H.originAllowed({headers:{Origin:'https://custom.example',Host:'custom.example'}}),true);
assert.equal(H.originAllowed({headers:{origin:'https://custom.example','x-forwarded-host':'custom.example'}}),true);
assert.equal(H.originAllowed({headers:{origin:'https://attacker.example',host:'receipts.example'}}),false);
assert.equal(H.originAllowed({headers:{origin:'not a url',host:'receipts.example'}}),false);
assert.equal(H.originAllowed({headers:{host:'receipts.example'}}),true);

assert.equal(H.options({httpMethod:'OPTIONS',headers:{origin:'https://deploy-preview-12--receipts.netlify.app',host:'deploy-preview-12--receipts.netlify.app'}}).statusCode,204);
assert.equal(H.options({httpMethod:'OPTIONS',headers:{origin:'https://attacker.example',host:'receipts.example'}}).statusCode,403);

console.log('HTTP origin checks passed.');
