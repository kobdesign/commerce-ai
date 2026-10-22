import { describe,expect,it,vi } from 'vitest';
import { createTikTokAuthorizationState,decryptTikTokToken,encryptTikTokToken,exchangeTikTokSellerCode,tiktokSellerAuthorizationUrl,tiktokShopConfiguration,verifyTikTokAuthorizationState } from '@commerce/connectors';

const key=Buffer.alloc(32,7);
const env={APP_MODE:'staging-demo',APP_ORIGIN:'https://staging.example.test',TIKTOK_SHOP_ENVIRONMENT:'development',TIKTOK_SHOP_APP_KEY:'app-key',
  TIKTOK_SHOP_APP_SECRET:'app-secret',TIKTOK_SHOP_SELLER_AUTH_URL:'https://services.tiktokshop.com/open/authorize?service_id=service-123',
  TIKTOK_SHOP_OAUTH_STATE_SECRET:'s'.repeat(32),TIKTOK_SHOP_TOKEN_ENCRYPTION_KEY:key.toString('base64')};

describe('TikTok Shop connector boundary',()=>{
  it('reports every missing deployment secret without exposing values',()=>{
    const result=tiktokShopConfiguration({APP_MODE:'staging-demo',APP_ORIGIN:'https://staging.example.test'});
    expect(result.ready).toBe(false);expect(result.blockers).toEqual(['app-key','app-secret','seller-authorization-url','oauth-state-secret','token-encryption-key']);
    expect(JSON.stringify(result)).not.toContain('access_token');
  });

  it('requires Development Shop on staging and a copied seller link with service_id',()=>{
    expect(tiktokShopConfiguration({...env,TIKTOK_SHOP_ENVIRONMENT:'production'}).blockers).toContain('staging-development-shop-only');
    expect(tiktokShopConfiguration({...env,TIKTOK_SHOP_SELLER_AUTH_URL:'https://services.tiktokshop.com/open/authorize'}).blockers).toContain('seller-authorization-url');
  });

  it('signs a short-lived state and rejects tampering or expiry',()=>{
    const state=createTikTokAuthorizationState({tenantId:'10000000-0000-4000-8000-000000000001',shopId:'30000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000001'},env.TIKTOK_SHOP_OAUTH_STATE_SECRET,1_000);
    expect(verifyTikTokAuthorizationState(state,env.TIKTOK_SHOP_OAUTH_STATE_SECRET,2_000)).toMatchObject({tenantId:'10000000-0000-4000-8000-000000000001'});
    expect(()=>verifyTikTokAuthorizationState(`${state}x`,env.TIKTOK_SHOP_OAUTH_STATE_SECRET,2_000)).toThrow('TIKTOK_OAUTH_STATE_INVALID');
    expect(()=>verifyTikTokAuthorizationState(state,env.TIKTOK_SHOP_OAUTH_STATE_SECRET,1_000+10*60_000+1)).toThrow('TIKTOK_OAUTH_STATE_EXPIRED');
  });

  it('adds state to the exact Seller authorization URL copied from Partner Center',()=>{
    const configuration=tiktokShopConfiguration(env),url=new URL(tiktokSellerAuthorizationUrl(configuration,'signed-state'));
    expect(url.searchParams.get('service_id')).toBe('service-123');expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('accepts only seller tokens and never sends the secret in a request body',async()=>{
    const request=vi.fn(async(input:URL|RequestInfo)=>{const url=new URL(input.toString());expect(url.searchParams.get('grant_type')).toBe('authorized_code');
      return new Response(JSON.stringify({code:0,data:{access_token:'access',refresh_token:'refresh',open_id:'seller-open-id',user_type:0,access_token_expire_in:3600,refresh_token_expire_in:7200,granted_scopes:['seller.order.info']}}),{status:200,headers:{'content-type':'application/json'}});});
    const token=await exchangeTikTokSellerCode(tiktokShopConfiguration(env),'one-time-code',request as typeof fetch);
    expect(token).toMatchObject({accessToken:'access',refreshToken:'refresh',openId:'seller-open-id',scopes:['seller.order.info']});expect(request).toHaveBeenCalledOnce();
  });

  it('encrypts provider tokens with authenticated encryption',()=>{
    const encrypted=encryptTikTokToken('secret-token',key);expect(encrypted).not.toContain('secret-token');expect(decryptTikTokToken(encrypted,key)).toBe('secret-token');
    expect(()=>decryptTikTokToken(encrypted.slice(0,-2)+'aa',key)).toThrow('TIKTOK_TOKEN_CIPHERTEXT_INVALID');
  });
});
