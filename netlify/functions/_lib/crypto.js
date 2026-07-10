'use strict';
const crypto=require('crypto');
function sha256(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function secretKey(){const secret=process.env.RECEIPTS_ENCRYPTION_SECRET;if(!secret)throw Object.assign(new Error('RECEIPTS_ENCRYPTION_SECRET is not configured.'),{statusCode:503});return crypto.createHash('sha256').update(secret).digest();}
function encrypt(value){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',secretKey(),iv);const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);const tag=cipher.getAuthTag();return Buffer.concat([iv,tag,encrypted]).toString('base64url');}
function decrypt(value){if(!value)return '';const raw=Buffer.from(value,'base64url');const iv=raw.subarray(0,12),tag=raw.subarray(12,28),body=raw.subarray(28);const decipher=crypto.createDecipheriv('aes-256-gcm',secretKey(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');}
function randomToken(){return crypto.randomBytes(24).toString('base64url');}
function ownerCode(){return String(crypto.randomInt(100000,1000000));}
function receiptCode(){return 'RCP-'+crypto.randomBytes(5).toString('base64url').replace(/[-_]/g,'').slice(0,7).toUpperCase();}
function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';}
function fingerprint(snapshot){return sha256(stable(snapshot));}
function safeHashEqual(a,b){try{const aa=Buffer.from(String(a),'hex'),bb=Buffer.from(String(b),'hex');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}catch(e){return false;}}
module.exports={sha256,encrypt,decrypt,randomToken,ownerCode,receiptCode,fingerprint,safeHashEqual};
