'use strict';
const assert=require('assert/strict');
const Mail=require('../netlify/functions/_lib/email');

async function run(){
  assert.deepEqual(
    Mail.uniqueRecipients(['client@example.com',' CREATOR@example.com ','CLIENT@example.com','']),
    ['client@example.com','CREATOR@example.com']
  );

  const previousKey=process.env.RESEND_API_KEY;
  const previousFrom=process.env.RESEND_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  assert.deepEqual(await Mail.sendEmail({to:'client@example.com',subject:'Test',html:'<p>Test</p>'}),{sent:false});
  if(previousKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=previousKey;
  if(previousFrom===undefined)delete process.env.RESEND_FROM;else process.env.RESEND_FROM=previousFrom;
  console.log('Email delivery reporting checks passed.');
}

run().catch(error=>{console.error(error);process.exit(1);});
