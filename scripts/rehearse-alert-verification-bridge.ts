import { chmod,mkdir,rename,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import {
  AlertVerificationError,canaryAlert,evaluateCanaryWindow,InMemoryAlertReplayStore,parseCanaryMonitoringPolicy,signAlert,verifySignedAlert,
} from '@commerce/operations';
import policyJson from '../config/eve-canary-monitoring.json' with {type:'json'};

if(process.env.APP_MODE==='production')throw new Error('Alert bridge rehearsal cannot run in production mode.');
if(process.env.AI_ENABLED&&!['false','0'].includes(process.env.AI_ENABLED))throw new Error('AI_ENABLED must remain false.');
if(process.env.COMMERCE_AGENT_LIVE_AI&&!['false','0'].includes(process.env.COMMERCE_AGENT_LIVE_AI))throw new Error('COMMERCE_AGENT_LIVE_AI must remain false.');

const now=new Date('2026-11-17T12:00:00.000Z'),tenantId='20000000-0000-4000-8000-000000000001';
const secret='synthetic-alert-bridge-secret-32-bytes',policy=parseCanaryMonitoringPolicy(policyJson);
const evaluation=evaluateCanaryWindow({tenantId,signals:[],policy,now}),alert=canaryAlert('staging','breached',evaluation);
alert.observedAt=now.toISOString();
const rawBody=JSON.stringify(alert),headers={'x-commerce-event-id':alert.eventId,'x-commerce-event-timestamp':alert.observedAt,
  'x-commerce-signature':signAlert(rawBody,alert.observedAt,secret)};
const store=new InMemoryAlertReplayStore(()=>now);
const scope={expectedEnvironment:'staging',allowedSources:['commerce-agent-canary-monitor'] as const};
const verified=await verifySignedAlert({rawBody,headers,secret,replayStore:store,now,...scope});

async function rejectedAs(expected:AlertVerificationError['code'],action:()=>Promise<unknown>){
  try{await action();return false;}catch(error){return error instanceof AlertVerificationError&&error.code===expected;}
}
const checks={
  validSignatureAccepted:verified.eventId===alert.eventId&&verified.contentCaptured===false,
  safeProjection:JSON.stringify(verified)===JSON.stringify({schemaVersion:'1',eventId:alert.eventId,source:'commerce-agent-canary-monitor',environment:'staging',
    status:'breached',observedAt:now.toISOString(),tenantId,contentCaptured:false}),
  replayRejected:await rejectedAs('REPLAYED_EVENT',()=>verifySignedAlert({rawBody,headers,secret,replayStore:store,now,...scope})),
  tamperRejected:await rejectedAs('INVALID_SIGNATURE',()=>verifySignedAlert({rawBody:`${rawBody} `,headers,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope})),
  staleRejected:await rejectedAs('STALE_REQUEST',()=>verifySignedAlert({rawBody,headers,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now:new Date(now.getTime()+300_001),...scope})),
  scopeMismatchRejected:await rejectedAs('SCOPE_MISMATCH',()=>verifySignedAlert({rawBody,headers,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope,expectedEnvironment:'production'})),
  extraContentRejected:await rejectedAs('INVALID_ALERT',()=>{
    const body=JSON.stringify({...alert,prompt:'forbidden'}),signed={...headers,'x-commerce-signature':signAlert(body,alert.observedAt,secret)};
    return verifySignedAlert({rawBody:body,headers:signed,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope});
  }),
};
const passed=Object.values(checks).every(Boolean);
const report={schemaVersion:1,evidenceId:'EVE-ALERT-BRIDGE-FOUNDATION-20261117-01',recordedAt:new Date().toISOString(),
  status:passed?'engineering-foundation-passed-external-delivery-pending':'failed',scope:'synthetic-local-only',checks,
  controls:{signature:'HMAC-SHA256 exact raw body with constant-time comparison',expectedEnvironment:'staging',allowedSources:scope.allowedSources,
    freshnessWindowSeconds:300,futureSkewSeconds:60,
    replayProtection:'atomic store contract; in-memory implementation used for rehearsal only',bodyLimitBytes:16384,contentCaptured:false},
  externalDelivery:{provider:null,deliveryVerified:false,humanAcknowledgementVerified:false,durableReplayStoreVerified:false},
  safety:{liveAiCalls:0,marketplaceWrites:0,databaseMutations:0,productionTenantDataUsed:false},
  limitations:['No external provider received this alert.','No human acknowledgement or escalation was tested.',
    'The rehearsal replay store is process-local; deployment requires a shared durable store with atomic consume semantics.',
    'This file must not be linked as alertDeliveryDryRun evidence until external delivery and acknowledgement are verified.']};
const reportPath=resolve(process.env.EVE_ALERT_BRIDGE_REPORT_PATH??'docs/evidence/eve-alert-verification-bridge-foundation-latest.json');
await mkdir(dirname(reportPath),{recursive:true});const temporary=`${reportPath}.${process.pid}.tmp`;
await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(temporary,reportPath);await chmod(reportPath,0o600);
console.log(JSON.stringify(report,null,2));if(!passed)process.exitCode=1;
