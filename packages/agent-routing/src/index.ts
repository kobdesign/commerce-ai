import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const agentRoutePolicyVersion='commerce-agent-route-v1' as const;
export type AgentEngine='legacy'|'eve';
export type AgentRouteReason='global_disabled'|'kill_switch'|'tenant_not_enabled'|'tenant_enabled'|
  'dynamic_policy_missing'|'dynamic_policy_pending'|'dynamic_policy_revoked'|'dynamic_policy_expired'|
  'dynamic_environment_mismatch'|'dynamic_tenant_enabled';
export type AgentFallbackReason='eve_unavailable'|'eve_timeout'|'eve_failed'|'rollback_requested';

const uuid=z.string().uuid();
const strictBoolean=z.enum(['true','false']);

export interface AgentRouteConfiguration{
  version:typeof agentRoutePolicyVersion;
  eveEnabled:boolean;
  killSwitch:boolean;
  tenantIds:readonly string[];
}

export interface AgentRouteDecision{
  version:typeof agentRoutePolicyVersion;
  tenantId:string;
  engine:AgentEngine;
  reason:AgentRouteReason;
}

export interface DynamicAgentRoutePolicy{
  status:'pending'|'active'|'revoked';
  environment:'development'|'staging';
  expiresAt:Date|string;
  version:number;
}

/** Resolve a tenant policy already read under the Commerce Core transaction. */
export function resolveDynamicAgentRoute(
  tenantId:string,
  environment:'development'|'staging',
  policy:DynamicAgentRoutePolicy|null,
  now:Date=new Date(),
):AgentRouteDecision{
  uuid.parse(tenantId);
  if(!policy)return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'dynamic_policy_missing'};
  if(policy.status==='pending')return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'dynamic_policy_pending'};
  if(policy.status==='revoked')return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'dynamic_policy_revoked'};
  if(policy.environment!==environment)return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'dynamic_environment_mismatch'};
  const expiresAt=policy.expiresAt instanceof Date?policy.expiresAt:new Date(policy.expiresAt);
  if(Number.isNaN(expiresAt.getTime())||expiresAt.getTime()<=now.getTime())return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'dynamic_policy_expired'};
  return {version:agentRoutePolicyVersion,tenantId,engine:'eve',reason:'dynamic_tenant_enabled'};
}

function readBoolean(name:string,value:string|undefined,defaultValue:boolean){
  if(value===undefined||value.trim()==='')return defaultValue;
  const parsed=strictBoolean.safeParse(value.trim());
  if(!parsed.success)throw new Error(`${name} must be true or false.`);
  return parsed.data==='true';
}

export function readAgentRouteConfiguration(env:Readonly<Record<string,string|undefined>>):AgentRouteConfiguration{
  const eveEnabled=readBoolean('COMMERCE_AGENT_EVE_ENABLED',env.COMMERCE_AGENT_EVE_ENABLED,false);
  const killSwitch=readBoolean('COMMERCE_AGENT_EVE_KILL_SWITCH',env.COMMERCE_AGENT_EVE_KILL_SWITCH,true);
  const raw=env.COMMERCE_AGENT_EVE_TENANT_IDS?.trim()??'';
  if(raw.includes('*'))throw new Error('COMMERCE_AGENT_EVE_TENANT_IDS does not allow wildcard routing.');
  const tenantIds=raw===''?[]:raw.split(',').map(value=>value.trim()).filter(Boolean);
  if(tenantIds.length>100)throw new Error('COMMERCE_AGENT_EVE_TENANT_IDS supports at most 100 tenant IDs.');
  const parsed=z.array(uuid).safeParse(tenantIds);
  if(!parsed.success)throw new Error('COMMERCE_AGENT_EVE_TENANT_IDS must contain comma-separated UUIDs.');
  if(new Set(parsed.data).size!==parsed.data.length)throw new Error('COMMERCE_AGENT_EVE_TENANT_IDS must not contain duplicates.');
  return Object.freeze({version:agentRoutePolicyVersion,eveEnabled,killSwitch,tenantIds:Object.freeze([...parsed.data])});
}

export function resolveAgentRoute(tenantId:string,configuration:AgentRouteConfiguration):AgentRouteDecision{
  uuid.parse(tenantId);
  if(!configuration.eveEnabled)return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'global_disabled'};
  if(configuration.killSwitch)return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'kill_switch'};
  if(!configuration.tenantIds.includes(tenantId))return {version:agentRoutePolicyVersion,tenantId,engine:'legacy',reason:'tenant_not_enabled'};
  return {version:agentRoutePolicyVersion,tenantId,engine:'eve',reason:'tenant_enabled'};
}

export class AgentEngineUnavailableError extends Error{
  constructor(message='Eve runtime is unavailable.'){super(message);this.name='AgentEngineUnavailableError';}
}

export interface AgentInvocationContext{signal:AbortSignal;executionId:string;tenantId:string;}
export interface ExecuteAgentRouteInput<Result>{
  tenantId:string;
  configuration:AgentRouteConfiguration;
  legacy:(context:AgentInvocationContext)=>Promise<Result>;
  eve:(context:AgentInvocationContext)=>Promise<Result>;
  eveTimeoutMs?:number;
  rollbackSignal?:AbortSignal;
  executionId?:string;
}
export interface AgentRouteExecution<Result>{
  executionId:string;
  tenantId:string;
  selectedEngine:AgentEngine;
  servedBy:'legacy'|'eve';
  routeReason:AgentRouteReason;
  fallbackReason:AgentFallbackReason|null;
  eveAttempted:boolean;
  result:Result;
}

function fallbackReason(error:unknown,rollbackRequested:boolean,timedOut:boolean):AgentFallbackReason{
  if(rollbackRequested)return 'rollback_requested';
  if(timedOut)return 'eve_timeout';
  if(error instanceof AgentEngineUnavailableError)return 'eve_unavailable';
  return 'eve_failed';
}

export async function executeAgentRoute<Result>(input:ExecuteAgentRouteInput<Result>):Promise<AgentRouteExecution<Result>>{
  const route=resolveAgentRoute(input.tenantId,input.configuration),executionId=input.executionId??randomUUID();
  const legacy=async(reason:AgentFallbackReason|null,eveAttempted:boolean)=>({executionId,tenantId:input.tenantId,selectedEngine:route.engine,
    servedBy:'legacy' as const,routeReason:route.reason,fallbackReason:reason,eveAttempted,
    result:await input.legacy({signal:new AbortController().signal,executionId,tenantId:input.tenantId})});
  if(route.engine==='legacy')return legacy(null,false);
  if(input.rollbackSignal?.aborted)return legacy('rollback_requested',false);

  const timeoutMs=input.eveTimeoutMs??10_000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60_000)throw new Error('eveTimeoutMs must be between 1 and 60000.');
  const controller=new AbortController();let timedOut=false,rollbackRequested=input.rollbackSignal?.aborted??false;
  const onRollback=()=>{rollbackRequested=true;controller.abort('rollback_requested');};
  input.rollbackSignal?.addEventListener('abort',onRollback,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort('eve_timeout');},timeoutMs);
  try{
    const cancelled=new Promise<never>((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Eve invocation aborted.')),{once:true}));
    const result=await Promise.race([input.eve({signal:controller.signal,executionId,tenantId:input.tenantId}),cancelled]);
    if(controller.signal.aborted)return legacy(fallbackReason(null,rollbackRequested,timedOut),true);
    return {executionId,tenantId:input.tenantId,selectedEngine:'eve',servedBy:'eve',routeReason:route.reason,
      fallbackReason:null,eveAttempted:true,result};
  }catch(error){return legacy(fallbackReason(error,rollbackRequested,timedOut),true);}
  finally{clearTimeout(timer);input.rollbackSignal?.removeEventListener('abort',onRollback);}
}
