import { readFileSync,writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { buildReviewMigrationSql,reviewMigrationManifest,verifyReviewSql } from './lib/review-release.mjs';
const flag=process.argv.indexOf('--env');
if(flag<0||!process.argv[flag+1])throw new Error('Pass --env <private HRP environment file>; add --apply only for an authorized release');
const env=parse(readFileSync(process.argv[flag+1]));
if(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='vohrerrbthbrkwjllnlj.supabase.co')throw new Error('This release script is restricted to the verified HRP project');
async function rpc(sql){
 const response=await fetch(env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/rpc/exec_sql',{
  method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({sql}),signal:AbortSignal.timeout(55000)});
 const body=await response.text();return {ok:response.ok,status:response.status,data:body?JSON.parse(body):null};
}
if(!process.argv.includes('--apply')){
 console.log(JSON.stringify({mode:'plan',project:'vohrerrbthbrkwjllnlj',migrations:reviewMigrationManifest().map(({version,sha256})=>({version,sha256})),transactional:true,businessData:'fingerprint-verified unchanged'}));
}else{
 const applied=await rpc(buildReviewMigrationSql());
 if(!applied.ok)throw new Error('Release transaction failed and must be inspected before retry: '+JSON.stringify(applied.data));
 const verified=await rpc(verifyReviewSql);
 if(!verified.ok)throw new Error('Post-release verification failed: '+JSON.stringify(verified.data));
 const receipt=await rpc(`do $receipt$ declare v jsonb; begin select to_jsonb(r)-'schema_before' into v from hrp_private.review_releases r where id='review-20261101'; raise exception 'HRP_RELEASE:%',v; end $receipt$;`);
 if(!receipt.data?.message?.startsWith('HRP_RELEASE:'))throw new Error('Cannot read committed release receipt');
 const evidence=JSON.parse(receipt.data.message.slice('HRP_RELEASE:'.length));
 const outputFlag=process.argv.indexOf('--evidence');
 if(outputFlag>=0)writeFileSync(process.argv[outputFlag+1],JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:'verified',project:'vohrerrbthbrkwjllnlj',completedAt:evidence.completed_at,migrations:evidence.migration_count,businessDataUnchanged:JSON.stringify(evidence.fingerprints_before)===JSON.stringify(evidence.fingerprints_after)}));
}
