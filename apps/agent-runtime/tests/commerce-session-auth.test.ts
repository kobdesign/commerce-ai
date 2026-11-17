import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { issueCommerceSessionGrant } from '@commerce/agent-session-auth';
import { commerceSessionAuth } from '../agent/lib/commerce-session-auth.ts';

const ids={user:'10000000-0000-4000-8000-000000000001',tenant:'20000000-0000-4000-8000-000000000001',shop:'30000000-0000-4000-8000-000000000001'};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=new Date();
const issued=issueCommerceSessionGrant({subject:ids.user,tenantId:ids.tenant,shopIds:[ids.shop],role:'owner',environment:'development'},
  {keyId:'poc-key-1',privateKey,now});
const auth=commerceSessionAuth({COMMERCE_AGENT_ENV:'local',COMMERCE_SESSION_KEY_ID:'poc-key-1',COMMERCE_SESSION_PUBLIC_KEY:publicKey});

test('projects only signed Commerce tenant/shop claims into Eve session auth',async()=>{
  const principal=await auth(new Request('http://localhost:3000/eve/v1/session',{method:'POST',headers:{authorization:`Bearer ${issued.token}`}}));
  assert.deepEqual(principal,{authenticator:'jwt-ecdsa',issuer:'commerce-core',principalId:ids.user,principalType:'user',subject:ids.user,
    attributes:{tenantId:ids.tenant,shopIds:[ids.shop],role:'owner',grantId:issued.claims.grantId,capability:'create'}});
});

test('a create grant cannot continue or stream an existing Eve session',async()=>{
  for(const request of [
    new Request('http://localhost:3000/eve/v1/session/wrun_foreign',{method:'POST',headers:{authorization:`Bearer ${issued.token}`}}),
    new Request('http://localhost:3000/eve/v1/session/wrun_foreign/stream',{headers:{authorization:`Bearer ${issued.token}`}}),
  ])await assert.rejects(Promise.resolve().then(()=>auth(request)),/invalid or expired/);
});

test('skips unrelated bearer tokens so the next Eve authenticator may evaluate them',async()=>{
  assert.equal(await auth(new Request('http://localhost:3000/eve/v1/session',{headers:{authorization:'Bearer unrelated-oidc-token'}})),null);
});

test('fails closed for a tampered or unconfigured Commerce grant',async()=>{
  const tampered=`${issued.token.slice(0,-1)}${issued.token.endsWith('A')?'B':'A'}`;
  await assert.rejects(Promise.resolve().then(()=>auth(new Request('http://localhost:3000/eve/v1/session',{headers:{authorization:`Bearer ${tampered}`}}))),/invalid or expired/);
  const unconfigured=commerceSessionAuth({COMMERCE_AGENT_ENV:'local'});
  await assert.rejects(Promise.resolve().then(()=>unconfigured(new Request('http://localhost:3000/eve/v1/session',{headers:{authorization:`Bearer ${issued.token}`}}))),/not configured/);
});
