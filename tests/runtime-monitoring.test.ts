import { createHmac } from 'node:crypto';
import { describe,expect,test,vi } from 'vitest';
import { deliverRuntimeAlert,observeRuntime,runtimeAlert,RuntimeTransitionTracker } from '@commerce/operations';

const now=()=>new Date('2026-09-27T10:00:00.000Z');
describe('runtime monitoring and alert delivery',()=>{
  test('requires health and readiness while exposing only known readiness checks',async()=>{
    const fetcher=vi.fn(async(input:string|URL|Request)=>{
      const path=new URL(String(input)).pathname;
      return path==='/api/health'
        ?Response.json({status:'ok',internal:'not-forwarded'})
        :Response.json({status:'ok',checks:{configuration:'ok',applicationDatabase:'ok',identityDatabase:'ok',worker:'ok',importQueue:'ok',secretDetail:'leak'}});
    });
    const observation=await observeRuntime('https://staging.example.test',{fetcher,now});
    expect(observation).toEqual({status:'healthy',observedAt:'2026-09-27T10:00:00.000Z',health:{status:'ok',httpStatus:200,reason:'none'},readiness:{status:'ok',httpStatus:200,reason:'none',checks:{configuration:'ok',applicationDatabase:'ok',identityDatabase:'ok',worker:'ok',importQueue:'ok'}}});
    expect(JSON.stringify(observation)).not.toContain('secretDetail');
  });

  test('treats a malformed or failed dependency response as unavailable',async()=>{
    const fetcher=vi.fn(async(input:string|URL|Request)=>new URL(String(input)).pathname==='/api/health'?new Response('not-json',{status:200}):Response.json({status:'unavailable',checks:{worker:'unavailable'}},{status:503}));
    const observation=await observeRuntime('https://staging.example.test',{fetcher,now});
    expect(observation.status).toBe('unavailable');
    expect(observation.health).toMatchObject({status:'unavailable',reason:'invalid-response'});
    expect(observation.readiness).toMatchObject({status:'unavailable',httpStatus:503,checks:{worker:'unavailable'}});
  });

  test('alerts only after consecutive failures and once after recovery',()=>{
    const tracker=new RuntimeTransitionTracker(2,2);
    const observation=(status:'healthy'|'unavailable')=>({status,observedAt:now().toISOString(),health:{status:status==='healthy'?'ok' as const:'unavailable' as const,httpStatus:status==='healthy'?200:503,reason:status==='healthy'?'none' as const:'http' as const},readiness:{status:status==='healthy'?'ok' as const:'unavailable' as const,httpStatus:status==='healthy'?200:503,reason:status==='healthy'?'none' as const:'http' as const}});
    expect(tracker.observe(observation('healthy'))).toBeNull();
    expect(tracker.observe(observation('unavailable'))).toBeNull();
    expect(tracker.observe(observation('unavailable'))).toBe('unavailable');
    expect(tracker.observe(observation('unavailable'))).toBeNull();
    expect(tracker.observe(observation('healthy'))).toBeNull();
    expect(tracker.observe(observation('healthy'))).toBe('recovered');
    expect(tracker.observe(observation('healthy'))).toBeNull();
  });

  test('signs the exact body and retries webhook delivery without exposing the secret',async()=>{
    const observation=await observeRuntime('https://staging.example.test',{fetcher:async()=>Response.json({status:'ok',checks:{worker:'ok'}}),now});
    const alert=runtimeAlert('staging','unavailable',observation),secret='s'.repeat(32);let attempts=0;let captured:RequestInit|undefined;
    const fetcher=vi.fn(async(_input:string|URL|Request,init?:RequestInit)=>{attempts++;captured=init;return new Response(null,{status:attempts===1?500:204});});
    await expect(deliverRuntimeAlert(alert,'https://alerts.example.test/runtime',secret,{fetcher,attempts:3,backoffMs:0})).resolves.toEqual({attempts:2});
    const body=String(captured?.body),timestamp=alert.observedAt;
    expect((captured?.headers as Record<string,string>)['x-commerce-signature']).toBe(`sha256=${createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')}`);
    expect(JSON.stringify(captured)).not.toContain(secret);
  });
});
