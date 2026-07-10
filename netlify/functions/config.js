'use strict';
const {json}=require('./_lib/http');
exports.handler=async function(){const configured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.RECEIPTS_ENCRYPTION_SECRET);return json(200,{backendConfigured:configured,supabaseUrl:configured?process.env.SUPABASE_URL:'',supabaseAnonKey:configured?process.env.SUPABASE_ANON_KEY:'',emailConfigured:Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_FROM),appBaseUrl:process.env.APP_BASE_URL||''});};
