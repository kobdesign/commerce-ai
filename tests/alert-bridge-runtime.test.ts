import { createHmac } from 'node:crypto';
import { describe,expect,test,vi } from 'vitest';
import { alertBridgeConfig } from '../apps/alert-bridge/src/config';
import { DurableAlertReplayStore,type AtomicRedisClient } from '../apps/alert-bridge/src/replay-store';
import { receiveSignedAlert } from '../apps/alert-bridge/src/receiver';

const now=new Date('2026-11-17T12:00:00.000Z'),secret='alert-bridge-test-secret-value-32-bytes';
const eventId='11111111-1111-4111-8111-111111111111',observedAt=now.toISOString();
const payload={schemaVersion:'1',eventId,source:'commerce-runtime-monitor',environment:'staging',status:'unavailable',observedAt,
  checks:{health:{status:'unavailable',httpStatus:503,reason:'http'},readiness:{status:'unavailable',httpStatus:503,reason:'http'}}};

function request(body=JSON.stringify(payload),headers:Record<string,string>={}){
  const signature=`sha256=${createHmac('sha256',secret).update(`${observedAt}.${body}`).digest('hex')}`;
  return new Request('https://bridge.example.test/api/v1/alerts',{method:'POST',body,headers:{'content-type':'application/json',
    'x-commerce-event-id':eventId,'x-commerce-event-timestamp':observedAt,'x-commerce-signature':signature,...headers}});
}
function config(){return alertBridgeConfig({ALERT_BRIDGE_ENVIRONMENT:'staging',ALERT_BRIDGE_ALLOWED_SOURCES:'commerce-runtime-monitor',ALERT_BRIDGE_SIGNING_SECRET:secret});}

describe('alert bridge configuration',()=>{
  test('fails closed for missing secrets, empty sources and unknown sources',()=>{
    expect(()=>alertBridgeConfig({ALERT_BRIDGE_ENVIRONMENT:'staging',ALERT_BRIDGE_ALLOWED_SOURCES:'commerce-runtime-monitor'})).toThrow(/SIGNING_SECRET/);
    expect(()=>alertBridgeConfig({ALERT_BRIDGE_ENVIRONMENT:'staging',ALERT_BRIDGE_ALLOWED_SOURCES:'',ALERT_BRIDGE_SIGNING_SECRET:secret})).toThrow(/ALLOWED_SOURCES/);
    expect(()=>alertBridgeConfig({ALERT_BRIDGE_ENVIRONMENT:'staging',ALERT_BRIDGE_ALLOWED_SOURCES:'unknown',ALERT_BRIDGE_SIGNING_SECRET:secret})).toThrow(/ALLOWED_SOURCES/);
  });
});

describe('durable replay store',()=>{
  test('uses one atomic SET NX PXAT and maps a missing write to duplicate',async()=>{
    const set=vi.fn<AtomicRedisClient['set']>().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const store=new DurableAlertReplayStore({set,ping:vi.fn().mockResolvedValue('PONG')});
    await expect(store.consume(eventId,new Date(Date.now()+60_000))).resolves.toBe('accepted');
    await expect(store.consume(eventId,new Date(Date.now()+60_000))).resolves.toBe('duplicate');
    expect(set).toHaveBeenCalledWith(`commerce:alert-replay:v1:${eventId}`,'1',expect.objectContaining({nx:true,pxat:expect.any(Number)}));
  });
});

describe('signed receiver',()=>{
  test('returns only the verified safe envelope and rejects replay',async()=>{
    const replayStore={consume:vi.fn().mockResolvedValueOnce('accepted').mockResolvedValueOnce('duplicate')};
    const first=await receiveSignedAlert(request(),{config:config(),replayStore,now:()=>now});
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toEqual({status:'verified',eventId,source:'commerce-runtime-monitor',environment:'staging',alertStatus:'unavailable',
      observedAt,tenantId:null,contentCaptured:false,incidentDelivery:'pending-provider-adapter'});
    const replay=await receiveSignedAlert(request(),{config:config(),replayStore,now:()=>now});
    expect(replay.status).toBe(409);await expect(replay.json()).resolves.toEqual({status:'rejected',code:'REPLAYED_EVENT'});
  });

  test('rejects an oversized declared request before reading or consuming it',async()=>{
    const replayStore={consume:vi.fn()};
    const response=await receiveSignedAlert(request(JSON.stringify(payload),{'content-length':'20000'}),{config:config(),replayStore,now:()=>now});
    expect(response.status).toBe(413);expect(replayStore.consume).not.toHaveBeenCalled();
  });

  test('maps invalid signatures and replay-store outages without exposing internals',async()=>{
    const invalid=await receiveSignedAlert(request(JSON.stringify(payload),{'x-commerce-signature':`sha256=${'0'.repeat(64)}`}),
      {config:config(),replayStore:{consume:vi.fn()},now:()=>now});
    expect(invalid.status).toBe(401);await expect(invalid.json()).resolves.toEqual({status:'rejected',code:'INVALID_SIGNATURE'});
    const outage=await receiveSignedAlert(request(),{config:config(),replayStore:{consume:vi.fn().mockRejectedValue(new Error('private redis detail'))},now:()=>now});
    expect(outage.status).toBe(503);await expect(outage.json()).resolves.toEqual({status:'unavailable',code:'REPLAY_STORE_UNAVAILABLE'});
  });
});
