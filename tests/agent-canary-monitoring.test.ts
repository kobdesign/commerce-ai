import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe,expect,test,vi } from 'vitest';
import { canaryAlert,CanaryTransitionTracker,deliverSignedAlert,evaluateCanaryWindow,parseCanaryMonitoringPolicy,parseCanarySignal } from '@commerce/operations';

const tenantId='11111111-1111-4111-8111-111111111111',otherTenantId='22222222-2222-4222-8222-222222222222';
const common={schemaVersion:1 as const,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',observedAt:'2026-11-15T11:59:00.000Z',tenantId,
  executionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',contentCaptured:false as const};
async function policy(){return parseCanaryMonitoringPolicy(JSON.parse(await readFile(new URL('../config/eve-canary-monitoring.json',import.meta.url),'utf8')));}

describe('Eve canary metadata monitoring',()=>{
  test('accepts only the allowlisted metadata contract',()=>{
    expect(parseCanarySignal({...common,kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'})).toMatchObject({kind:'route',contentCaptured:false});
    expect(()=>parseCanarySignal({...common,kind:'route',engine:'eve',reason:'dynamic_tenant_enabled',prompt:'private'})).toThrow('non-allowlisted');
    expect(()=>parseCanarySignal({...common,kind:'route',engine:'eve',reason:'customer@example.test'})).toThrow('Invalid route');
    expect(()=>parseCanarySignal({...common,kind:'cost',status:'reported',amountUsd:null})).toThrow('Invalid cost');
    expect(parseCanarySignal({...common,kind:'grant',outcome:'replay'})).toMatchObject({kind:'grant',outcome:'replay',contentCaptured:false});
    expect(()=>parseCanarySignal({...common,kind:'grant',outcome:'unknown'})).toThrow('Invalid grant');
  });

  test('raises metadata-only grant abuse and expiry thresholds without capturing a token',async()=>{
    const signals=[
      {...common,kind:'grant',outcome:'issued'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',kind:'grant',outcome:'replay'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',kind:'grant',outcome:'replay'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',kind:'grant',outcome:'rate_limited'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',kind:'grant',outcome:'expired'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf',kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaba',kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'},
    ];
    const result=evaluateCanaryWindow({tenantId,signals,policy:await policy(),now:new Date('2026-11-15T12:00:00.000Z')});
    expect(result.summary).toMatchObject({grantsIssued:1,grantReplays:2,grantRateLimited:1,grantsExpired:1});
    expect(result.breaches).toEqual(['grant_replay','grant_rate_limited','grant_expired']);
    expect(JSON.stringify(result)).not.toContain('token');
  });

  test('evaluates only the requested tenant and exposes route, session, fallback, error and provider cost metadata',async()=>{
    const signals=[
      {...common,kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',kind:'session',outcome:'started'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',kind:'fallback',reason:'eve_timeout'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae',kind:'error',stage:'runtime',code:'timeout'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaf',kind:'cost',status:'reported',amountUsd:0.2},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaba',tenantId:otherTenantId,kind:'error',stage:'runtime',code:'execution_failed'},
    ];
    const result=evaluateCanaryWindow({tenantId,signals,policy:await policy(),now:new Date('2026-11-15T12:00:00.000Z')});
    expect(result.status).toBe('breached');
    expect(result.summary).toMatchObject({routeDecisions:2,eveRoutes:2,sessionsStarted:1,fallbacks:1,errors:1,reportedCostUsd:0.2,
      fallbackRatePercent:50,errorRatePercent:50});
    expect(result.breaches).toEqual(['fallback_rate','error_rate','reported_cost']);
    expect(result.policy).toMatchObject({classification:'engineering-rehearsal-only',approvalStatus:'not-approved'});
  });

  test('requires consecutive breaches and recovery windows',async()=>{
    const config=await policy(),tracker=new CanaryTransitionTracker(config.requiredConsecutiveBreaches,config.requiredConsecutiveRecoveries);
    const evaluate=(signals:unknown[])=>evaluateCanaryWindow({tenantId,signals,policy:config,now:new Date('2026-11-15T12:00:00.000Z')});
    const healthy=evaluate([
      {...common,kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'},
      {...common,eventId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',kind:'route',engine:'eve',reason:'dynamic_tenant_enabled'},
    ]),breached=evaluate([]);
    expect(tracker.observe(healthy)).toBeNull();expect(tracker.observe(breached)).toBeNull();expect(tracker.observe(breached)).toBe('breached');
    expect(tracker.observe(healthy)).toBeNull();expect(tracker.observe(healthy)).toBe('recovered');
  });

  test('delivers the canary alert using the shared exact-body signature contract',async()=>{
    const config=await policy(),evaluation=evaluateCanaryWindow({tenantId,signals:[],policy:config,now:new Date('2026-11-15T12:00:00.000Z')});
    const alert=canaryAlert('synthetic-local','breached',evaluation),secret='s'.repeat(32);let captured:RequestInit|undefined;
    const fetcher=vi.fn(async(_input:string|URL|Request,init?:RequestInit)=>{captured=init;return new Response(null,{status:204});});
    await expect(deliverSignedAlert(alert,'https://alerts.example.test/canary',secret,{fetcher,attempts:1})).resolves.toEqual({attempts:1});
    const body=String(captured?.body),headers=captured?.headers as Record<string,string>;
    expect(headers['x-commerce-signature']).toBe(`sha256=${createHmac('sha256',secret).update(`${alert.observedAt}.${body}`).digest('hex')}`);
    expect(body).toContain('"contentCaptured":false');expect(body).not.toContain(secret);
  });
});
