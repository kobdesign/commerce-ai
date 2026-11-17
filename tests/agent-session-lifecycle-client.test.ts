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
