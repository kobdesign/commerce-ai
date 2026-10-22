import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { demo } from '@commerce/domain';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { marketplaceConnections,saveTikTokSellerAuthorization,tiktokShopConfiguration } from '@commerce/connectors';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const configuration=tiktokShopConfiguration({APP_MODE:'staging-demo',APP_ORIGIN:'https://staging.example.test',TIKTOK_SHOP_ENVIRONMENT:'development',TIKTOK_SHOP_APP_KEY:'key',TIKTOK_SHOP_APP_SECRET:'secret',
  TIKTOK_SHOP_SELLER_AUTH_URL:'https://services.tiktokshop.com/open/authorize?service_id=service-123',TIKTOK_SHOP_OAUTH_STATE_SECRET:'s'.repeat(32),TIKTOK_SHOP_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')});

describe('Marketplace connection storage',()=>{
  it('stores encrypted TikTok credentials outside the tenant-readable schema',async()=>{
    const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),marker=`open-${Date.now()}`;
    const saved=await saveTikTokSellerAuthorization(ctx,demo.shops.tiktok,{accessToken:`access-${marker}`,refreshToken:`refresh-${marker}`,openId:marker,scopes:['seller.order.info'],accessTokenExpiresAt:new Date(Date.now()+3600_000),refreshTokenExpiresAt:new Date(Date.now()+7200_000)},configuration);
    expect(saved.status).toBe('authorized');
    const [connection]=await marketplaceConnections(ctx,demo.shops.tiktok);expect(connection).toMatchObject({id:saved.id,status:'authorized',providerOpenId:marker,grantedScopes:['seller.order.info']});
    const secret=(await admin.query<{access_token_ciphertext:string;refresh_token_ciphertext:string}>('SELECT access_token_ciphertext,refresh_token_ciphertext FROM private.marketplace_connection_credentials WHERE tenant_id=$1 AND connection_id=$2',[ctx.tenantId,saved.id])).rows[0];
    expect(JSON.stringify(secret)).not.toContain(marker);expect(JSON.stringify(connection)).not.toContain('access-');expect(JSON.stringify(connection)).not.toContain('refresh-');
    await expect(withTenant(ctx,tx=>tx.query('SELECT * FROM private.marketplace_connection_credentials'))).rejects.toMatchObject({code:'42501'});
  });

  it('prevents non-owner authorization and cross-channel connection',async()=>{
    const token={accessToken:'access',refreshToken:'refresh',openId:'open',scopes:[],accessTokenExpiresAt:null,refreshTokenExpiresAt:null};
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);
    await expect(saveTikTokSellerAuthorization(auditor,demo.shops.tiktok,token,configuration)).rejects.toMatchObject({status:403});
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
    await expect(saveTikTokSellerAuthorization(owner,demo.shops.shopee,token,configuration)).rejects.toMatchObject({code:'MARKETPLACE_AUTHORIZATION_INVALID'});
  });
});
