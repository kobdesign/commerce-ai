import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {verifyCommerceCleanupGrant} from '@commerce/agent-session-auth';
import {
  CommerceCleanupDispatchError,
  commerceCleanupDispatcherConfiguration,
  dispatchCommerceSessionCleanup,
} from '@commerce/agent-session/cleanup-client';

const ids={tenantId:randomUUID(),intentId:randomUUID(),sessionId:'wrun_cleanup_client_12345678'};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=new Date('2026-11-16T10:00:00.000Z');
const configuration={eveBaseUrl:'https://eve.example.test',environment:'staging' as const,keyId:'cleanup-current',privateKey,now};

describe('Commerce cleanup dispatcher',()=>{
  it('sends an exact-session short-lived identity and accepts a bounded receipt',async()=>{
    const fetchImpl=vi.fn<typeof fetch>(async(input,init)=>{
      expect(String(input)).toBe(`https://eve.example.test/eve/v1/session/${ids.sessionId}/end`);
      const bearer=new Headers(init?.headers).get('authorization');
      expect(bearer).toMatch(/^Bearer ccl1_/);
      const claims=verifyCommerceCleanupGrant(bearer!.slice('Bearer '.length),{
        environment:'staging',publicKeys:{'cleanup-current':publicKey},now,
      });
      expect(claims).toMatchObject(ids);
      expect(init?.body).toBe(JSON.stringify({reason:'Commerce Core emergency revocation cleanup.'}));
      return Response.json({sessionId:ids.sessionId,deliveryId:'delivery_cleanup_123'},{status:202});
    });
    await expect(dispatchCommerceSessionCleanup(ids,configuration,fetchImpl)).resolves.toEqual({
      intentId:ids.intentId,sessionId:ids.sessionId,deliveryId:'delivery_cleanup_123',
    });
  });

  it('fails closed on rejection, malformed receipt or unavailable network',async()=>{
    await expect(dispatchCommerceSessionCleanup(ids,configuration,vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:403}))))
      .rejects.toMatchObject({code:'EVE_CLEANUP_REJECTED',status:403} satisfies Partial<CommerceCleanupDispatchError>);
    await expect(dispatchCommerceSessionCleanup(ids,configuration,vi.fn<typeof fetch>().mockResolvedValue(Response.json({sessionId:'wrong',deliveryId:'delivery_cleanup_123'},{status:202}))))
      .rejects.toMatchObject({code:'EVE_CLEANUP_INVALID_RECEIPT'} satisfies Partial<CommerceCleanupDispatchError>);
    await expect(dispatchCommerceSessionCleanup(ids,configuration,vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))))
      .rejects.toMatchObject({code:'EVE_CLEANUP_UNAVAILABLE',status:null} satisfies Partial<CommerceCleanupDispatchError>);
  });

  it('is disabled by default and rejects incomplete enabled configuration',()=>{
    expect(commerceCleanupDispatcherConfiguration({APP_MODE:'staging-demo'})).toBeNull();
    expect(()=>commerceCleanupDispatcherConfiguration({APP_MODE:'staging-demo',COMMERCE_AGENT_CLEANUP_ENABLED:'true'})).toThrow(/incomplete/);
  });
});
