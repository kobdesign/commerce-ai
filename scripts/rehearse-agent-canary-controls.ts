import { chmod,mkdir,rename,readFile,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { executeAgentRoute,readAgentRouteConfiguration } from '@commerce/agent-routing';
import { canaryAlert,CanaryTransitionTracker,deliverSignedAlert,evaluateCanaryWindow,parseCanaryMonitoringPolicy,signAlert } from '@commerce/operations';

if(process.env.APP_MODE==='production')throw new Error('Eve canary control rehearsal cannot run in production mode.');
if(process.env.AI_ENABLED&&!['false','0'].includes(process.env.AI_ENABLED))throw new Error('AI_ENABLED must remain false for the synthetic rehearsal.');
if(process.env.COMMERCE_AGENT_LIVE_AI&&!['false','0'].includes(process.env.COMMERCE_AGENT_LIVE_AI))throw new Error('COMMERCE_AGENT_LIVE_AI must remain false for the synthetic rehearsal.');

const policy=parseCanaryMonitoringPolicy(JSON.parse(await readFile(new URL('../config/eve-canary-monitoring.json',import.meta.url),'utf8')));
const tenantId='11111111-1111-4111-8111-111111111111',otherTenantId='22222222-2222-4222-8222-222222222222';
const now=new Date('2026-11-15T12:00:00.000Z');let sequence=0;
const eventId=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`;
const common=(tenant=tenantId)=>({schemaVersion:1 as const,eventId:eventId(),observedAt:'2026-11-15T11:59:00.000Z',tenantId:tenant,
  executionId:`bbbbbbbb-bbbb-4bbb-8bbb-${String(sequence).padStart(12,'0')}`,contentCaptured:false as const});
const healthySignals=[
  {...common(),kind:'route' as const,engine:'eve' as const,reason:'dynamic_tenant_enabled'},
  {...common(),kind:'route' as const,engine:'eve' as const,reason:'dynamic_tenant_enabled'},
  {...common(),kind:'session' as const,outcome:'started' as const},
  {...common(),kind:'session' as const,outcome:'completed' as const},
  {...common(),kind:'cost' as const,status:'reported' as const,amountUsd:0.02},
  {...common(),kind:'grant' as const,outcome:'issued' as const},
  {...common(),kind:'grant' as const,outcome:'consumed' as const},
  {...common(otherTenantId),kind:'error' as const,stage:'runtime' as const,code:'execution_failed' as const},
];
const breachedSignals=[...healthySignals,
  {...common(),kind:'fallback' as const,reason:'eve_unavailable' as const},
  {...common(),kind:'error' as const,stage:'runtime' as const,code:'unavailable' as const},
  {...common(),kind:'cost' as const,status:'reported' as const,amountUsd:0.2},
  {...common(),kind:'grant' as const,outcome:'replay' as const},
  {...common(),kind:'grant' as const,outcome:'replay' as const},
  {...common(),kind:'grant' as const,outcome:'rate_limited' as const},
  {...common(),kind:'grant' as const,outcome:'expired' as const},
];
const healthy=evaluateCanaryWindow({tenantId,signals:healthySignals,policy,now});
const breached=evaluateCanaryWindow({tenantId,signals:breachedSignals,policy,now});
const tracker=new CanaryTransitionTracker(policy.requiredConsecutiveBreaches,policy.requiredConsecutiveRecoveries);
tracker.observe(healthy);const firstBreach=tracker.observe(breached),breachTransition=tracker.observe(breached);
const alert=canaryAlert('synthetic-local','breached',breached),secret='synthetic-rehearsal-secret-32-bytes';let signedDelivery=false;
await deliverSignedAlert(alert,'https://alerts.invalid/eve-canary',secret,{attempts:1,backoffMs:0,fetcher:async(_input,init)=>{
  const headers=init?.headers as Record<string,string>,body=String(init?.body);
  signedDelivery=headers['x-commerce-signature']===signAlert(body,alert.observedAt,secret)&&headers['x-commerce-event-id']===alert.eventId;
  return new Response(null,{status:signedDelivery?204:400});
}});

let eveCalls=0,legacyCalls=0;
const killed=await executeAgentRoute({tenantId,configuration:readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'true',COMMERCE_AGENT_EVE_TENANT_IDS:tenantId}),
  legacy:async()=>{legacyCalls++;return 'legacy-safe';},eve:async()=>{eveCalls++;return 'eve';}});
const firstRecovery=tracker.observe(healthy),recoveryTransition=tracker.observe(healthy);
const serialized=JSON.stringify({healthy,breached,alert});
const checks={baselineHealthy:healthy.status==='healthy',crossTenantSignalExcluded:healthy.summary.errors===0,
  firstBreachSuppressed:firstBreach===null,thresholdBreachDetected:breachTransition==='breached'&&breached.breaches.includes('fallback_rate')&&
    breached.breaches.includes('error_rate')&&breached.breaches.includes('reported_cost')&&breached.breaches.includes('grant_replay')&&
    breached.breaches.includes('grant_rate_limited')&&breached.breaches.includes('grant_expired'),signedAlertDelivered:signedDelivery,
  killSwitchSelectedLegacy:killed.selectedEngine==='legacy'&&killed.routeReason==='kill_switch'&&killed.servedBy==='legacy',
  killSwitchPreventedEveCall:eveCalls===0&&legacyCalls===1,firstRecoverySuppressed:firstRecovery===null,recoveryDetected:recoveryTransition==='recovered',
  metadataOnly:!serialized.includes('prompt')&&!serialized.includes('message')&&!serialized.includes('customer')&&!serialized.includes('authorization')};
const passed=Object.values(checks).every(Boolean);
const report={schemaVersion:1,status:passed?'passed':'failed',scope:'synthetic tenant only',policy:{profileId:policy.profileId,classification:policy.classification,
  approvalStatus:policy.approvalStatus,sloStatus:policy.slo.status,incidentOwnershipStatus:policy.incidentOwnership.status},checks,
  metrics:{baseline:healthy.summary,breach:breached.summary},alert:{delivery:'in-memory signed webhook verifier',signature:'verified; secret omitted'},
  liveAiCalls:0,marketplaceWrites:0,databaseMutations:0,limitations:['Engineering rehearsal thresholds are not an approved SLO.',
    'No external alert provider or human incident acknowledgement was tested.','No production tenant, credential, model or marketplace account was used.']};
const reportPath=resolve(process.env.EVE_CANARY_REHEARSAL_REPORT_PATH??'docs/evidence/eve-canary-incident-rehearsal-latest.json');
await mkdir(dirname(reportPath),{recursive:true});const temporary=`${reportPath}.${process.pid}.tmp`;
await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(temporary,reportPath);await chmod(reportPath,0o600);
console.log(JSON.stringify(report,null,2));if(!passed)process.exitCode=1;
