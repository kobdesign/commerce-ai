import assert from 'node:assert/strict';
import test from 'node:test';
import { isLiveAiRequest } from '../agent/lib/poc-route-policy.ts';
import { agentUsageLimits, readPocRuntimePolicy } from '../agent/lib/runtime-policy.ts';

const now=new Date('2026-11-15T10:00:00.000Z');
function enabledEnv(overrides:Record<string,string|undefined>={}){
  return {
    COMMERCE_AGENT_ENV:'preview',VERCEL_ENV:'preview',COMMERCE_AGENT_LIVE_AI:'true',
    COMMERCE_AGENT_CANARY_MODE:'approved-staging',COMMERCE_AGENT_CANARY_APPROVAL_ID:'APR-001',
    COMMERCE_CORE_URL:'https://commerce.example',COMMERCE_CORE_ENVIRONMENT:'staging',
    COMMERCE_SESSION_KEY_ID:'key-1',COMMERCE_SESSION_PUBLIC_KEY:'A'.repeat(60),
    COMMERCE_AGENT_MODEL_ALLOWLIST:'openai/gpt-5.4-mini',
    COMMERCE_AGENT_CANARY_ALLOWED_ROLES:'owner,marketing',COMMERCE_AGENT_CANARY_EXPIRES_AT:'2026-11-15T12:00:00.000Z',
    COMMERCE_AGENT_MAX_NEW_INPUT_TOKENS:'10000',COMMERCE_AGENT_MAX_OUTPUT_TOKENS:'2000',COMMERCE_AGENT_MAX_COST_USD:'0.1',
    ...overrides,
  };
}

test('keeps local and preview runtimes disabled when explicitly configured',()=>{
  for(const env of [
    {COMMERCE_AGENT_ENV:'local',COMMERCE_AGENT_LIVE_AI:'false'},
    {COMMERCE_AGENT_ENV:'preview',COMMERCE_AGENT_LIVE_AI:'false',VERCEL_ENV:'preview'},
  ])assert.deepEqual(readPocRuntimePolicy(env),{environment:env.COMMERCE_AGENT_ENV,expiresAt:null,liveAiEnabled:false,mode:'disabled',modelId:null,usageLimits:null});
});

test('rejects production, implicit settings and live AI outside Vercel Preview',()=>{
  assert.throws(()=>readPocRuntimePolicy({COMMERCE_AGENT_ENV:'preview',COMMERCE_AGENT_LIVE_AI:'false',VERCEL_ENV:'production'}),/production environment/);
  assert.throws(()=>readPocRuntimePolicy({COMMERCE_AGENT_ENV:'local'}),/explicitly set/);
  assert.throws(()=>readPocRuntimePolicy(enabledEnv({COMMERCE_AGENT_ENV:'local',VERCEL_ENV:undefined,COMMERCE_CORE_ENVIRONMENT:'development'})),/Vercel Preview/);
});

test('rejects database, direct provider, marketplace and tenant service credentials',()=>{
  assert.throws(()=>readPocRuntimePolicy({COMMERCE_AGENT_ENV:'preview',COMMERCE_AGENT_LIVE_AI:'false',DATABASE_URL:'db',OPENAI_API_KEY:'key',TIKTOK_SHOP_APP_SECRET:'secret',COMMERCE_AGENT_SESSION_PRIVATE_KEY:'private',COMMERCE_AGENT_CREDENTIAL:'secret'}),/DATABASE_URL, OPENAI_API_KEY, TIKTOK_SHOP_APP_SECRET, COMMERCE_AGENT_SESSION_PRIVATE_KEY, COMMERCE_AGENT_CREDENTIAL/);
});

test('requires complete Commerce endpoint and public verifier configuration',()=>{
  assert.throws(()=>readPocRuntimePolicy({COMMERCE_AGENT_ENV:'preview',COMMERCE_AGENT_LIVE_AI:'false',COMMERCE_CORE_URL:'https://commerce.example'}),/one complete set/);
  assert.throws(()=>readPocRuntimePolicy({COMMERCE_AGENT_ENV:'local',COMMERCE_AGENT_LIVE_AI:'false',COMMERCE_SESSION_KEY_ID:'key-1'}),/one complete set/);
});

test('accepts only an expiring, bounded and allowlisted staging canary',()=>{
  const result=readPocRuntimePolicy(enabledEnv(),now);
  assert.equal(result.liveAiEnabled,true);
  if(!result.liveAiEnabled)throw new Error('expected enabled policy');
  assert.deepEqual({mode:result.mode,modelId:result.modelId,allowedRoles:result.allowedRoles,usageLimits:result.usageLimits},
    {mode:'staging-canary',modelId:'openai/gpt-5.4-mini',allowedRoles:['owner','marketing'],usageLimits:{maxNewInputTokens:10000,maxOutputTokens:2000,maxCostUsd:0.1}});
  assert.throws(()=>readPocRuntimePolicy(enabledEnv({COMMERCE_AGENT_TENANT_ID:'20000000-0000-4000-8000-000000000001'}),now),/signed Commerce grant/);
  assert.throws(()=>readPocRuntimePolicy(enabledEnv({COMMERCE_AGENT_MODEL_ALLOWLIST:'openai/other'}),now),/must contain only/);
  assert.throws(()=>readPocRuntimePolicy(enabledEnv({COMMERCE_AGENT_MAX_COST_USD:'0.251'}),now),/between/);
  assert.throws(()=>readPocRuntimePolicy(enabledEnv({COMMERCE_AGENT_CANARY_EXPIRES_AT:'2026-11-15T15:00:00.000Z'}),now),/four hours/);
  assert.throws(()=>readPocRuntimePolicy(enabledEnv({COMMERCE_AGENT_CANARY_EXPIRES_AT:'2026-11-15T09:00:00.000Z'}),now),/future/);
});

test('applies the lower of agent hard limits and approved canary limits',()=>{
  assert.deepEqual(agentUsageLimits(enabledEnv(),{maxNewInputTokens:8000,maxOutputTokens:3000,maxCostUsd:0.08},now),
    {maxNewInputTokens:8000,maxOutputTokens:2000,maxCostUsd:0.08});
});

test('classifies only initial message and continuation writes as live AI requests',async()=>{
  assert.equal(await isLiveAiRequest(new Request('https://agent.example/eve/v1/session',{method:'POST'})),false);
  assert.equal(await isLiveAiRequest(new Request('https://agent.example/eve/v1/session',{body:'{}',method:'POST'})),true);
  assert.equal(await isLiveAiRequest(new Request('https://agent.example/eve/v1/session/wrun_example',{method:'POST'})),true);
  assert.equal(await isLiveAiRequest(new Request('https://agent.example/eve/v1/session/wrun_example/compact',{method:'POST'})),true);
});
