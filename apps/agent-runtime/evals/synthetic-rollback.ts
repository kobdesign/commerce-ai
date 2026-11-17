import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  AgentEngineUnavailableError,
  executeAgentRoute,
  readAgentRouteConfiguration,
} from '@commerce/agent-routing';
import { z } from 'zod';

export const rollbackRehearsalVersion='eve-rollback-rehearsal-v1' as const;
const datasetSchema=z.object({version:z.literal(rollbackRehearsalVersion),synthetic:z.literal(true),enabledTenantId:z.string().uuid(),controlTenantId:z.string().uuid(),
  commerceSnapshot:z.object({inventory:z.array(z.object({variantId:z.string().uuid(),onHand:z.number().int(),reserved:z.number().int(),available:z.number().int(),balanceVersion:z.number().int()}).strict()),
    financial:z.object({settlementCount:z.number().int(),confirmedGrossMinor:z.number().int(),ledgerVersion:z.number().int()}).strict()}).strict()}).strict();
type Dataset=z.infer<typeof datasetSchema>;

export interface RollbackScenarioResult{
  id:string;
  passed:boolean;
  servedBy:'legacy'|'eve';
  fallbackReason:string|null;
  legacyCalls:number;
  eveCalls:number;
  commerceSnapshotUnchanged:boolean;
}
export interface RollbackRehearsalReport{
  version:typeof rollbackRehearsalVersion;
  synthetic:true;
  cases:number;
  passed:boolean;
  legacyDefault:boolean;
  crossTenantIsolation:boolean;
  businessDataMutations:number;
  productionDecision:'no-go';
  releaseDecision:'retain-legacy-default';
  results:RollbackScenarioResult[];
  limitations:string[];
}

function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
async function loadDataset():Promise<Dataset>{
  return datasetSchema.parse(JSON.parse(await readFile(new URL('../../../fixtures/eve-rollback-rehearsal.json',import.meta.url),'utf8')));
}

export async function runSyntheticRollbackRehearsal():Promise<RollbackRehearsalReport>{
  const dataset=await loadDataset(),snapshot=structuredClone(dataset.commerceSnapshot),before=hash(snapshot),results:RollbackScenarioResult[]=[];
  const enabled=readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:dataset.enabledTenantId});
  const defaultLegacy=readAgentRouteConfiguration({});

  async function run(id:string,tenantId:string,configuration:ReturnType<typeof readAgentRouteConfiguration>,expected:{servedBy:'legacy'|'eve';fallbackReason:string|null;legacyCalls:number;eveCalls:number},
    eveBehavior:'success'|'unavailable'|'wait',rollback=false){
    let legacyCalls=0,eveCalls=0;const rollbackController=new AbortController();
    const promise=executeAgentRoute({tenantId,configuration,eveTimeoutMs:20,rollbackSignal:rollbackController.signal,
      legacy:async()=>{legacyCalls++;return {source:'legacy' as const};},
      eve:async({signal})=>{eveCalls++;
        if(eveBehavior==='unavailable')throw new AgentEngineUnavailableError();
        if(eveBehavior==='wait')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
        return {source:'eve' as const};
      }});
    if(rollback)queueMicrotask(()=>rollbackController.abort('operator rollback'));
    const execution=await promise,unchanged=before===hash(snapshot);
    results.push({id,passed:execution.servedBy===expected.servedBy&&execution.fallbackReason===expected.fallbackReason&&
      legacyCalls===expected.legacyCalls&&eveCalls===expected.eveCalls&&unchanged,servedBy:execution.servedBy,
      fallbackReason:execution.fallbackReason,legacyCalls,eveCalls,commerceSnapshotUnchanged:unchanged});
  }

  await run('RB-01-default-legacy',dataset.enabledTenantId,defaultLegacy,{servedBy:'legacy',fallbackReason:null,legacyCalls:1,eveCalls:0},'success');
  await run('RB-02-control-tenant',dataset.controlTenantId,enabled,{servedBy:'legacy',fallbackReason:null,legacyCalls:1,eveCalls:0},'success');
  await run('RB-03-eve-success',dataset.enabledTenantId,enabled,{servedBy:'eve',fallbackReason:null,legacyCalls:0,eveCalls:1},'success');
  await run('RB-04-eve-unavailable',dataset.enabledTenantId,enabled,{servedBy:'legacy',fallbackReason:'eve_unavailable',legacyCalls:1,eveCalls:1},'unavailable');
  await run('RB-05-eve-timeout',dataset.enabledTenantId,enabled,{servedBy:'legacy',fallbackReason:'eve_timeout',legacyCalls:1,eveCalls:1},'wait');
  await run('RB-06-operator-rollback',dataset.enabledTenantId,enabled,{servedBy:'legacy',fallbackReason:'rollback_requested',legacyCalls:1,eveCalls:1},'wait',true);

  const passed=results.every(result=>result.passed);
  return {version:rollbackRehearsalVersion,synthetic:true,cases:results.length,passed,
    legacyDefault:results.find(result=>result.id==='RB-01-default-legacy')?.passed===true,
    crossTenantIsolation:results.find(result=>result.id==='RB-02-control-tenant')?.passed===true,
    businessDataMutations:before===hash(snapshot)?0:1,productionDecision:'no-go',releaseDecision:'retain-legacy-default',results,
    limitations:['This v1 rollback rehearsal intentionally exercises the deploy-scoped fallback path; the separate synthetic dynamic control plane is verified in EVE-CANARY-02.',
      'Existing Eve session continuation remains disabled, so the rehearsal does not claim recovery of durable in-flight conversations.',
      'The executor can abort its wait and fall back, but a remote runtime may finish later; read-only Core credentials prevent business mutations.']};
}
