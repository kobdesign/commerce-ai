import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import test from 'node:test';
import {issueCommerceCleanupGrant} from '@commerce/agent-session-auth';
import {commerceCleanupAuth} from '../agent/lib/commerce-cleanup-auth.ts';

const ids={tenant:'20000000-0000-4000-8000-000000000001',intent:'40000000-0000-4000-8000-000000000001',session:'wrun_cleanup_runtime_12345678'};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=new Date('2026-11-16T10:00:00.000Z');
const token=issueCommerceCleanupGrant({tenantId:ids.tenant,sessionId:ids.session,intentId:ids.intent,environment:'staging'},
  {keyId:'cleanup-1',privateKey,now}).token;
const env={COMMERCE_AGENT_ENV:'preview',COMMERCE_CLEANUP_PUBLIC_KEYS_JSON:JSON.stringify({'cleanup-1':publicKey})};
const auth=commerceCleanupAuth(env,()=>now);

test('authorizes only the exact Eve end route as a service principal',async()=>{
  const principal=await auth(new Request(`https://agent.example/eve/v1/session/${ids.session}/end`,{
    method:'POST',headers:{authorization:`Bearer ${token}`},
  }));
  assert.deepEqual(principal,{authenticator:'commerce-cleanup-eddsa',issuer:'commerce-core',principalId:'commerce-lifecycle-worker',
    principalType:'service',subject:'commerce-lifecycle-worker',attributes:{tenantId:ids.tenant,sessionId:ids.session,intentId:ids.intent,capability:'cleanup:end'}});
});

test('rejects another session, message, stream and revoked signing key',async()=>{
  for(const request of [
    new Request('https://agent.example/eve/v1/session/wrun_another_session/end',{method:'POST',headers:{authorization:`Bearer ${token}`}}),
    new Request(`https://agent.example/eve/v1/session/${ids.session}`,{method:'POST',headers:{authorization:`Bearer ${token}`}}),
    new Request(`https://agent.example/eve/v1/session/${ids.session}/stream`,{headers:{authorization:`Bearer ${token}`}}),
  ])await assert.rejects(Promise.resolve().then(()=>auth(request)),/outside the exact session scope/);
  await assert.rejects(Promise.resolve().then(()=>commerceCleanupAuth({...env,COMMERCE_CLEANUP_REVOKED_KEY_IDS:'cleanup-1'},()=>now)(
    new Request(`https://agent.example/eve/v1/session/${ids.session}/end`,{method:'POST',headers:{authorization:`Bearer ${token}`}}),
  )),/outside the exact session scope/);
});

test('skips unrelated bearer tokens for the next authenticator',async()=>{
  assert.equal(await auth(new Request('https://agent.example/eve/v1/session',{headers:{authorization:'Bearer unrelated'}})),null);
});
