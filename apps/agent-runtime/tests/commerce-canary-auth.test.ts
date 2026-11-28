import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {issueCommerceSessionGrant} from '@commerce/agent-session-auth';
import {commerceCanaryAuth} from '../agent/lib/commerce-canary-auth.ts';

const ids={user:'10000000-0000-4000-8000-000000000001',tenant:'20000000-0000-4000-8000-000000000001',otherTenant:'20000000-0000-4000-8000-000000000002',shop:'30000000-0000-4000-8000-000000000001',otherShop:'30000000-0000-4000-8000-000000000002'};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=new Date('2026-11-15T10:00:00.000Z');
const consumeOk:typeof fetch=async(_input,init)=>{
  const bearer=new Headers(init?.headers).get('authorization');
  assert.match(bearer??'',/^Bearer csg1_/);
  const grant=tokenFromBearer(bearer!);
  return Response.json({status:'consumed',grantId:grant,consumedAt:now.toISOString()});
};
function tokenFromBearer(bearer:string){
  const encoded=bearer.slice('Bearer csg1_'.length).split('.')[1];
  return JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')).grantId as string;
}
function env(live='true') {return {
  COMMERCE_AGENT_ENV:'preview',VERCEL_ENV:'preview',COMMERCE_AGENT_LIVE_AI:live,
  COMMERCE_AGENT_CANARY_MODE:'approved-staging',COMMERCE_AGENT_CANARY_APPROVAL_ID:'APR-001',
  COMMERCE_CORE_URL:'https://commerce.example',COMMERCE_CORE_ENVIRONMENT:'staging',
  COMMERCE_SESSION_KEY_ID:'key-1',COMMERCE_SESSION_PUBLIC_KEY:publicKey,
  COMMERCE_AGENT_MODEL_ALLOWLIST:'openai/gpt-5.4-mini',
  COMMERCE_AGENT_CANARY_ALLOWED_ROLES:'owner,marketing',COMMERCE_AGENT_CANARY_EXPIRES_AT:'2026-11-15T12:00:00.000Z',
  COMMERCE_AGENT_MAX_NEW_INPUT_TOKENS:'10000',COMMERCE_AGENT_MAX_OUTPUT_TOKENS:'2000',COMMERCE_AGENT_MAX_COST_USD:'0.1',
};}
function token(input:Partial<{tenantId:string;shopIds:string[];role:'owner'|'finance'|'operator'|'marketing'|'auditor';capability:'create'|'continue';sessionId:string|null}>={}){
  return issueCommerceSessionGrant({subject:ids.user,tenantId:input.tenantId??ids.tenant,shopIds:input.shopIds??[ids.shop],role:input.role??'owner',environment:'staging',
    capability:input.capability??'create',sessionId:input.sessionId??null},
    {keyId:'key-1',privateKey,now}).token;
}
function request(bearer?:string,path='/eve/v1/session'){
  return new Request(`https://agent.example${path}`,{method:'POST',body:path==='/eve/v1/session'?JSON.stringify({message:'analyze'}):undefined,
    headers:bearer?{authorization:`Bearer ${bearer}`}:undefined});
}

test('authorizes one initial live turn with signed tenant/shop/role scope',async()=>{
  const principal=await commerceCanaryAuth(env(),()=>now,consumeOk)(request(token()));
  assert.equal(principal?.attributes?.tenantId,ids.tenant);
  assert.equal(principal?.attributes?.approvalId,'APR-001');
  assert.equal(principal?.attributes?.modelId,'openai/gpt-5.4-mini');
  assert.equal(principal?.attributes?.toolPolicyVersion,'commerce-canary-read-only-v1');
  assert.match(String(principal?.attributes?.commerceGrant),/^csg1_/);
});

test('requires atomic Commerce Core consumption and rejects a replay',async()=>{
  let calls=0;
  const once:typeof fetch=async(input,init)=>{
    calls+=1;
    if(calls>1)return new Response(null,{status:409});
    return consumeOk(input,init);
  };
  const grant=token();
  await commerceCanaryAuth(env(),()=>now,once)(request(grant));
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now,once)(request(grant))),/outside the approved canary scope/);
  assert.equal(calls,2);
});

test('disabled policy and missing Commerce grants fail closed without auth fallthrough',async()=>{
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env('false'),()=>now)(request(token()))),/disabled/);
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now)(request())),/signed Commerce session grant/);
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now)(request('vercel-oidc-token'))),/signed Commerce session grant/);
});

test('takes tenant and shops from the signed grant while retaining the global role boundary',async()=>{
  for(const grant of [token({tenantId:ids.otherTenant}),token({shopIds:[ids.otherShop]})]){
    await assert.doesNotReject(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now,consumeOk)(request(grant))));
  }
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now)(request(token({role:'finance'})))),/outside the approved canary scope/);
});

test('authorizes only session-bound follow-up grants and rejects URL or tenant mismatches before any model call',async()=>{
  const sessionId='wrun_example_session';
  const grant=token({capability:'continue',sessionId});
  const principal=await commerceCanaryAuth(env(),()=>now,consumeOk)(request(grant,`/eve/v1/session/${sessionId}`));
  assert.equal(principal?.attributes?.sessionId,sessionId);
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now)(request(grant,'/eve/v1/session/wrun_other_session'))),/outside the approved canary scope/);
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>now)(request(token(),`/eve/v1/session/${sessionId}`))),/outside the approved canary scope/);
  await assert.rejects(Promise.resolve().then(()=>commerceCanaryAuth(env(),()=>new Date('2026-11-15T13:00:00.000Z'))(request(token()))),/missing, invalid or expired/);
});

test('requires a fresh continuation grant for stream and control routes',async()=>{
  const sessionId='wrun_stream_session';
  const streamGrant=token({capability:'continue',sessionId});
  const stream=new Request(`https://agent.example/eve/v1/session/${sessionId}/stream`,{method:'GET',headers:{authorization:`Bearer ${streamGrant}`}});
  assert.equal((await commerceCanaryAuth(env(),()=>now,consumeOk)(stream))?.attributes?.sessionId,sessionId);
  const compactGrant=token({capability:'continue',sessionId});
  assert.equal((await commerceCanaryAuth(env(),()=>now,consumeOk)(request(compactGrant,`/eve/v1/session/${sessionId}/compact`)))?.attributes?.capability,'continue');
});

test('bodyless session foundation requests remain available to later authenticators',async()=>{
  const bodyless=new Request('https://agent.example/eve/v1/session',{method:'POST'});
  assert.equal(await commerceCanaryAuth(env(),()=>now)(bodyless),null);
});
