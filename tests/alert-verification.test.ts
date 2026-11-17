import { describe,expect,test } from 'vitest';
import { AlertVerificationError,canaryAlert,evaluateCanaryWindow,InMemoryAlertReplayStore,parseCanaryMonitoringPolicy,signAlert,verifySignedAlert } from '@commerce/operations';
import policyJson from '../config/eve-canary-monitoring.json';

const now=new Date('2026-11-17T12:00:00.000Z'),tenantId='11111111-1111-4111-8111-111111111111',secret='a'.repeat(32);
const scope={expectedEnvironment:'staging',allowedSources:['commerce-agent-canary-monitor'] as const};
function fixture(){
  const policy=parseCanaryMonitoringPolicy(policyJson),evaluation=evaluateCanaryWindow({tenantId,signals:[],policy,now});
  const alert=canaryAlert('staging','breached',evaluation);alert.observedAt=now.toISOString();
  const rawBody=JSON.stringify(alert),headers={'x-commerce-event-id':alert.eventId,'x-commerce-event-timestamp':alert.observedAt,
    'x-commerce-signature':signAlert(rawBody,alert.observedAt,secret)};
  return {alert,rawBody,headers};
}
async function code(action:()=>Promise<unknown>){try{await action();return null;}catch(error){return error instanceof AlertVerificationError?error.code:'unexpected';}}

describe('signed alert verification bridge contract',()=>{
  test('accepts an allowlisted metadata-only alert once and projects a safe envelope',async()=>{
    const {alert,rawBody,headers}=fixture(),store=new InMemoryAlertReplayStore(()=>now);
    await expect(verifySignedAlert({rawBody,headers,secret,replayStore:store,now,...scope})).resolves.toEqual({schemaVersion:'1',eventId:alert.eventId,
      source:'commerce-agent-canary-monitor',environment:'staging',status:'breached',observedAt:now.toISOString(),tenantId,contentCaptured:false});
    await expect(code(()=>verifySignedAlert({rawBody,headers,secret,replayStore:store,now,...scope}))).resolves.toBe('REPLAYED_EVENT');
  });

  test('rejects tampering, stale and future delivery before replay consumption',async()=>{
    const {rawBody,headers}=fixture();
    await expect(code(()=>verifySignedAlert({rawBody:`${rawBody} `,headers,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope}))).resolves.toBe('INVALID_SIGNATURE');
    await expect(code(()=>verifySignedAlert({rawBody,headers,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now:new Date(now.getTime()+300_001),...scope}))).resolves.toBe('STALE_REQUEST');
    await expect(code(()=>verifySignedAlert({rawBody,headers,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now:new Date(now.getTime()-60_001),...scope}))).resolves.toBe('FUTURE_REQUEST');
  });

  test('rejects signed payloads with extra content, mismatched headers or an unsafe secret',async()=>{
    const {alert,headers}=fixture(),withPrompt=JSON.stringify({...alert,prompt:'private customer text'}),signedHeaders={...headers,
      'x-commerce-signature':signAlert(withPrompt,alert.observedAt,secret)};
    await expect(code(()=>verifySignedAlert({rawBody:withPrompt,headers:signedHeaders,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope}))).resolves.toBe('INVALID_ALERT');
    await expect(code(()=>verifySignedAlert({rawBody:JSON.stringify(alert),headers:{...headers,'x-commerce-event-id':'22222222-2222-4222-8222-222222222222'},secret,
      replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope}))).resolves.toBe('HEADER_MISMATCH');
    await expect(code(()=>verifySignedAlert({rawBody:JSON.stringify(alert),headers,secret:'short',replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope}))).resolves.toBe('INVALID_SECRET');
  });

  test('rejects signed content hidden inside an otherwise valid nested object',async()=>{
    const {alert,headers}=fixture(),body=JSON.stringify({...alert,summary:{...alert.summary,customerEmail:'private@example.test'}}),signed={...headers,
      'x-commerce-signature':signAlert(body,alert.observedAt,secret)};
    await expect(code(()=>verifySignedAlert({rawBody:body,headers:signed,secret,replayStore:new InMemoryAlertReplayStore(()=>now),now,...scope}))).resolves.toBe('INVALID_ALERT');
  });

  test('binds a valid signed event to the configured environment and source',async()=>{
    const {rawBody,headers}=fixture(),store=()=>new InMemoryAlertReplayStore(()=>now);
    await expect(code(()=>verifySignedAlert({rawBody,headers,secret,replayStore:store(),now,...scope,expectedEnvironment:'production'}))).resolves.toBe('SCOPE_MISMATCH');
    await expect(code(()=>verifySignedAlert({rawBody,headers,secret,replayStore:store(),now,...scope,allowedSources:['commerce-runtime-monitor']}))).resolves.toBe('SCOPE_MISMATCH');
  });
});
