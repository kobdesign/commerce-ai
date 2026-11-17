import { describe,expect,it } from 'vitest';
import {
  AgentEngineUnavailableError,
  executeAgentRoute,
  readAgentRouteConfiguration,
  resolveAgentRoute,
  resolveDynamicAgentRoute,
} from '@commerce/agent-routing';

const enabledTenant='20000000-0000-4000-8000-000000000001';
const controlTenant='20000000-0000-4000-8000-000000000002';
const enabled=readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:enabledTenant});

describe('tenant-scoped agent routing',()=>{
  it('defaults to legacy and requires an explicit tenant allowlist plus released kill switch',()=>{
    expect(resolveAgentRoute(enabledTenant,readAgentRouteConfiguration({}))).toMatchObject({engine:'legacy',reason:'global_disabled'});
    expect(resolveAgentRoute(enabledTenant,readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_TENANT_IDS:enabledTenant})))
      .toMatchObject({engine:'legacy',reason:'kill_switch'});
    expect(resolveAgentRoute(controlTenant,enabled)).toMatchObject({engine:'legacy',reason:'tenant_not_enabled'});
    expect(resolveAgentRoute(enabledTenant,enabled)).toMatchObject({engine:'eve',reason:'tenant_enabled'});
  });

  it('rejects wildcard, duplicate, malformed and ambiguous flag configuration',()=>{
    expect(()=>readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'yes'})).toThrow(/true or false/);
    expect(()=>readAgentRouteConfiguration({COMMERCE_AGENT_EVE_TENANT_IDS:'*'})).toThrow(/wildcard/);
    expect(()=>readAgentRouteConfiguration({COMMERCE_AGENT_EVE_TENANT_IDS:'not-a-uuid'})).toThrow(/UUIDs/);
    expect(()=>readAgentRouteConfiguration({COMMERCE_AGENT_EVE_TENANT_IDS:`${enabledTenant},${enabledTenant}`})).toThrow(/duplicates/);
  });

  it('fails closed for missing, pending, expired and environment-mismatched dynamic policies',()=>{
    const now=new Date('2026-11-15T10:00:00.000Z');
    expect(resolveDynamicAgentRoute(enabledTenant,'development',null,now)).toMatchObject({engine:'legacy',reason:'dynamic_policy_missing'});
    expect(resolveDynamicAgentRoute(enabledTenant,'development',{status:'pending',environment:'development',expiresAt:'2026-11-15T11:00:00.000Z',version:1},now))
      .toMatchObject({engine:'legacy',reason:'dynamic_policy_pending'});
    expect(resolveDynamicAgentRoute(enabledTenant,'development',{status:'active',environment:'development',expiresAt:'2026-11-15T09:59:59.000Z',version:2},now))
      .toMatchObject({engine:'legacy',reason:'dynamic_policy_expired'});
    expect(resolveDynamicAgentRoute(enabledTenant,'development',{status:'active',environment:'staging',expiresAt:'2026-11-15T11:00:00.000Z',version:2},now))
      .toMatchObject({engine:'legacy',reason:'dynamic_environment_mismatch'});
    expect(resolveDynamicAgentRoute(enabledTenant,'development',{status:'active',environment:'development',expiresAt:'2026-11-15T11:00:00.000Z',version:2},now))
      .toMatchObject({engine:'eve',reason:'dynamic_tenant_enabled'});
  });

  it('serves the control tenant through legacy without calling Eve',async()=>{
    let eveCalls=0;
    const result=await executeAgentRoute({tenantId:controlTenant,configuration:enabled,
      legacy:async()=>({source:'legacy'}),eve:async()=>{eveCalls++;return {source:'eve'};}});
    expect(result).toMatchObject({selectedEngine:'legacy',servedBy:'legacy',fallbackReason:null,eveAttempted:false,result:{source:'legacy'}});
    expect(eveCalls).toBe(0);
  });

  it('falls back exactly once when Eve is unavailable',async()=>{
    let legacyCalls=0,eveCalls=0;
    const result=await executeAgentRoute({tenantId:enabledTenant,configuration:enabled,
      legacy:async()=>{legacyCalls++;return {source:'legacy'};},eve:async()=>{eveCalls++;throw new AgentEngineUnavailableError();}});
    expect(result).toMatchObject({selectedEngine:'eve',servedBy:'legacy',fallbackReason:'eve_unavailable',eveAttempted:true,result:{source:'legacy'}});
    expect({legacyCalls,eveCalls}).toEqual({legacyCalls:1,eveCalls:1});
  });

  it('aborts an in-flight Eve call on timeout and then serves legacy once',async()=>{
    let aborted=false,legacyCalls=0;
    const result=await executeAgentRoute({tenantId:enabledTenant,configuration:enabled,eveTimeoutMs:15,
      legacy:async()=>{legacyCalls++;return {source:'legacy'};},
      eve:({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true}))});
    expect(result).toMatchObject({servedBy:'legacy',fallbackReason:'eve_timeout',eveAttempted:true});
    expect(aborted).toBe(true);expect(legacyCalls).toBe(1);
  });

  it('honors a rollback signal during an in-flight Eve call',async()=>{
    const rollback=new AbortController();let legacyCalls=0;
    const resultPromise=executeAgentRoute({tenantId:enabledTenant,configuration:enabled,rollbackSignal:rollback.signal,eveTimeoutMs:1000,
      legacy:async()=>{legacyCalls++;return {source:'legacy'};},
      eve:({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
    queueMicrotask(()=>rollback.abort('operator rollback'));
    const result=await resultPromise;
    expect(result).toMatchObject({servedBy:'legacy',fallbackReason:'rollback_requested',eveAttempted:true});
    expect(legacyCalls).toBe(1);
  });
});
