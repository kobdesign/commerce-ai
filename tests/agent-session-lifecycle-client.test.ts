import {describe,expect,it,vi} from 'vitest';
import {CommerceEveLifecycleError,createCommerceEveSessionClient} from '@commerce/agent-session/client';

const tenantId='11111111-1111-4111-8111-111111111111';
const shopId='22222222-2222-4222-8222-222222222222';
const sessionId='wrun_lifecycle_12345678';
const intentId='33333333-3333-4333-8333-333333333333';
const idempotencyKey='44444444-4444-4444-8444-444444444444';
const token='csess_test-token-that-is-never-logged';
const expiresAt='2026-11-16T14:00:00.000Z';
const response=(status:number,body:unknown)=>new Response(body===null?null:JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const stream=(lines:unknown[])=>new Response(`${lines.map(line=>JSON.stringify(line)).join('\n')}\n`,{status:200,headers:{'content-type':'application/x-ndjson'}});
const client=(fetchImpl:typeof fetch)=>createCommerceEveSessionClient({
  coreBaseUrl:'https://core.example.test',eveBaseUrl:'https://eve.example.test',tenantId,
  origin:'https://core.example.test',fetch:fetchImpl,idempotencyKey:()=>idempotencyKey,
});

describe('Commerce/Eve session lifecycle client',()=>{
  it('creates a prewarmed Eve session and binds it before returning it',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'create',sessionId:null,expiresAt}))
      .mockResolvedValueOnce(response(202,{sessionId}))
      .mockResolvedValueOnce(response(200,{sessionId,status:'active',expiresAt}));
    await expect(client(fetchImpl).create([shopId])).resolves.toEqual({sessionId,expiresAt});
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('POST');
    expect('body' in (fetchImpl.mock.calls[1]?.[1]??{})).toBe(false);
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(`https://core.example.test/api/tenants/${tenantId}/agent-session/bind`);
  });

  it('sends the trusted Vercel OIDC token only to Eve',async()=>{
    const oidcToken='eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJwcmV2aWV3In0.signature';
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'create',sessionId:null,expiresAt}))
      .mockResolvedValueOnce(response(202,{sessionId}))
      .mockResolvedValueOnce(response(200,{sessionId,status:'active',expiresAt}));
    const protectedClient=createCommerceEveSessionClient({
      coreBaseUrl:'https://core.example.test',eveBaseUrl:'https://eve.example.test',tenantId,
      origin:'https://core.example.test',fetch:fetchImpl,vercelOidcToken:oidcToken,
    });
    await protectedClient.create([shopId]);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('x-vercel-trusted-oidc-idp-token')).toBe(false);
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('x-vercel-trusted-oidc-idp-token')).toBe(oidcToken);
    expect(new Headers(fetchImpl.mock.calls[2]?.[1]?.headers).has('x-vercel-trusted-oidc-idp-token')).toBe(false);
  });

  it('retries an ambiguous bind with the exact same grant and session',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'create',sessionId:null,expiresAt}))
      .mockResolvedValueOnce(response(202,{sessionId}))
      .mockResolvedValueOnce(response(500,{code:'INTERNAL'}))
      .mockResolvedValueOnce(response(200,{sessionId,status:'active',expiresAt}));
    await expect(client(fetchImpl).create([shopId])).resolves.toEqual({sessionId,expiresAt});
    expect(fetchImpl.mock.calls[2]?.[1]?.body).toBe(fetchImpl.mock.calls[3]?.[1]?.body);
  });

  it('records an abandoned session when bind is definitively rejected',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'create',sessionId:null,expiresAt}))
      .mockResolvedValueOnce(response(202,{sessionId}))
      .mockResolvedValueOnce(response(409,{code:'AGENT_SESSION_BIND_UNAVAILABLE'}))
      .mockResolvedValueOnce(response(200,{sessionId,status:'abandoned'}));
    await expect(client(fetchImpl).create([shopId])).rejects.toMatchObject({code:'CORE_BIND_FAILED',status:409});
    expect(fetchImpl.mock.calls[3]?.[0]).toBe(`https://core.example.test/api/tenants/${tenantId}/agent-session/abandon`);
  });

  it('uses separate one-time continuation grants for a message and its stream',async()=>{
    const messageToken='csess_message-token-that-is-never-logged',streamToken='csess_stream-token-that-is-never-logged';
    const deliveryId='delivery_message_123',turnId='turn_message_123';
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token:messageToken,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(response(202,{sessionId,deliveryId}))
      .mockResolvedValueOnce(response(200,{engine:'eve',token:streamToken,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(stream([
        {$eve:'heartbeat'},
        {progress:{type:'content.delta',scope:{turnId},data:{partId:'part_1',delta:'กำลังตรวจ'}}},
        {at:'2026-11-27T00:00:00.000Z',facts:[
          {type:'child.opened',data:{sessionId:'wrun_child_123',name:'inventory-analysis',stream:'/child'}},
          {type:'call.requested',scope:{turnId},data:{callId:'call_1',capability:{kind:'tool',name:'read_inventory'},input:{}}},
          {type:'usage.recorded',scope:{turnId},data:{kind:'model',usage:{inputTokens:120,outputTokens:35,costUsd:0.001}}},
        ]},
        {at:'2026-11-27T00:00:01.000Z',facts:[
          {type:'content.completed',scope:{turnId},data:{partId:'part_1',kind:'text',phase:'reply',value:'ควรโปรโมต SKU-A เพราะสต๊อกเพียงพอ'}},
          {type:'turn.settled',scope:{turnId},data:{turnId,outcome:'completed',reply:['part_1']}},
          {type:'delivery.settled',data:{deliveryId,outcome:'handled',turnId}},
        ]},
      ]));
    await expect(client(fetchImpl).send(sessionId,'สัปดาห์หน้าควรโปรโมตสินค้าอะไร',0)).resolves.toEqual({
      sessionId,deliveryId,status:'completed',answer:'ควรโปรโมต SKU-A เพราะสต๊อกเพียงพอ',
      delegatedAgents:['inventory-analysis'],toolNames:['read_inventory'],usage:{inputTokens:120,outputTokens:35,costUsd:0.001},nextStreamIndex:2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(`Bearer ${messageToken}`);
    expect(new Headers(fetchImpl.mock.calls[3]?.[1]?.headers).get('authorization')).toBe(`Bearer ${streamToken}`);
    expect(fetchImpl.mock.calls[3]?.[0]).toBe(`https://eve.example.test/eve/v1/session/${sessionId}/stream?startIndex=0`);
  });

  it('does not accept an unrelated or failed delivery as a completed answer',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(response(202,{sessionId,deliveryId:'delivery_target_123'}))
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(stream([{at:'2026-11-27T00:00:00.000Z',facts:[{type:'delivery.settled',data:{deliveryId:'delivery_target_123',outcome:'failed'}}]}]));
    await expect(client(fetchImpl).send(sessionId,'ช่วยวิเคราะห์สินค้า',0)).rejects.toMatchObject({code:'EVE_RESPONSE_INVALID'});
  });

  it('persists intent before Eve, records its receipt and then reconciles Core',async()=>{
    const reason='User requested a fresh synthetic session.';
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(response(200,{intentId,status:'pending'}))
      .mockResolvedValueOnce(response(202,{sessionId,deliveryId:'delivery_end_123'}))
      .mockResolvedValueOnce(response(200,{intentId,status:'receipt_received'}))
      .mockResolvedValueOnce(response(200,{sessionId,status:'ended'}));
    await expect(client(fetchImpl).end(sessionId,reason)).resolves.toEqual({sessionId,status:'ended'});
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(`https://core.example.test/api/tenants/${tenantId}/agent-session/sessions/${sessionId}/end-intents`);
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(`https://eve.example.test/eve/v1/session/${sessionId}/end`);
    expect(fetchImpl.mock.calls[3]?.[0]).toBe(`https://core.example.test/api/tenants/${tenantId}/agent-session/sessions/${sessionId}/end-intents/${intentId}/receipt`);
    expect(fetchImpl.mock.calls[4]?.[0]).toBe(`https://core.example.test/api/tenants/${tenantId}/agent-session/sessions/${sessionId}/end`);
  });

  it('does not mark Core ended when Eve rejects the end control',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(response(200,{intentId,status:'pending'}))
      .mockResolvedValueOnce(response(409,{code:'session_not_active'}));
    await expect(client(fetchImpl).end(sessionId,'User requested a fresh synthetic session.'))
      .rejects.toEqual(expect.objectContaining<Partial<CommerceEveLifecycleError>>({code:'EVE_END_FAILED',status:409}));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('leaves a receipt-backed intent for the worker when direct Core reconciliation stays unavailable',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(response(200,{intentId,status:'pending'}))
      .mockResolvedValueOnce(response(202,{sessionId,deliveryId:'delivery_end_456'}))
      .mockResolvedValueOnce(response(200,{intentId,status:'receipt_received'}))
      .mockResolvedValueOnce(response(503,{code:'TEMPORARY'}))
      .mockResolvedValueOnce(response(503,{code:'TEMPORARY'}));
    await expect(client(fetchImpl).end(sessionId,'User requested a fresh synthetic session.'))
      .rejects.toEqual(expect.objectContaining<Partial<CommerceEveLifecycleError>>({code:'CORE_END_RECONCILIATION_PENDING',status:503}));
    expect(fetchImpl.mock.calls[3]?.[0]).toContain('/receipt');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('retries ambiguous intent and receipt writes with the exact same payload',async()=>{
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200,{engine:'eve',token,capability:'continue',sessionId,expiresAt}))
      .mockResolvedValueOnce(response(503,{code:'TEMPORARY'}))
      .mockResolvedValueOnce(response(200,{intentId,status:'pending'}))
      .mockResolvedValueOnce(response(202,{sessionId,deliveryId:'delivery_retry_123'}))
      .mockResolvedValueOnce(response(503,{code:'TEMPORARY'}))
      .mockResolvedValueOnce(response(200,{intentId,status:'receipt_received'}))
      .mockResolvedValueOnce(response(200,{sessionId,status:'ended'}));
    await expect(client(fetchImpl).end(sessionId,'User requested a fresh synthetic session.'))
      .resolves.toEqual({sessionId,status:'ended'});
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(fetchImpl.mock.calls[2]?.[1]?.body);
    expect(fetchImpl.mock.calls[4]?.[1]?.body).toBe(fetchImpl.mock.calls[5]?.[1]?.body);
  });
});
