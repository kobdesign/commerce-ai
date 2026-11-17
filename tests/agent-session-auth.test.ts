import { generateKeyPairSync } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import {
  CommerceSessionGrantError,
  issueCommerceSessionGrant,
  verifyCommerceSessionGrant,
} from '@commerce/agent-session-auth';
import { readAgentRouteConfiguration } from '@commerce/agent-routing';
import { commerceAgentSessionConfiguration,createCommerceAgentSession } from '@commerce/agent-session';
import { closePools,resolveContext } from '@commerce/db';
import { demo } from '@commerce/domain';

const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=new Date('2026-11-13T12:00:00.000Z');
const configuration={keyId:'poc-key-1',privateKey,now,
  route:readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:demo.tenants.chino})};
const input={subject:demo.users.owner,tenantId:demo.tenants.chino,shopIds:[demo.shops.tiktok],role:'owner' as const,environment:'development' as const};

afterAll(closePools);

describe('Commerce Core signed agent session grants',()=>{
  it('round-trips an Ed25519-signed tenant and shop scope',()=>{
    const issued=issueCommerceSessionGrant(input,configuration);
    expect(verifyCommerceSessionGrant(issued.token,{keyId:'poc-key-1',publicKey,environment:'development',now})).toEqual(issued.claims);
    expect(issued.claims.expiresAt-issued.claims.issuedAt).toBe(300);
  });

  it('rejects payload tampering, the wrong environment and expiry',()=>{
    const issued=issueCommerceSessionGrant(input,configuration);
    const [header,payload,signature]=issued.token.slice(5).split('.');
    const claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    claims.tenantId=demo.tenants.goods;
    const forged=`csg1_${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
    expect(()=>verifyCommerceSessionGrant(forged,{keyId:'poc-key-1',publicKey,environment:'development',now})).toThrow(CommerceSessionGrantError);
    expect(()=>verifyCommerceSessionGrant(issued.token,{keyId:'poc-key-1',publicKey,environment:'staging',now})).toThrow(/environment/);
    expect(()=>verifyCommerceSessionGrant(issued.token,{keyId:'poc-key-1',publicKey,environment:'development',now:new Date('2026-11-13T12:06:00.000Z'),clockSkewSeconds:0})).toThrow(/expired/);
  });

  it('allows only shops visible to the authenticated user and records the signed scope',async()=>{
    const limited=await resolveContext(demo.users.limited,demo.tenants.chino);
    const granted=await createCommerceAgentSession(limited,{shopIds:[demo.shops.tiktok]},{...configuration,environment:'development'});
    expect(granted.engine).toBe('eve');
    if(!granted.token)throw new Error('Expected an Eve session token.');
    const claims=verifyCommerceSessionGrant(granted.token,{keyId:'poc-key-1',publicKey,environment:'development',now});
    expect(claims).toMatchObject({subject:demo.users.limited,tenantId:demo.tenants.chino,shopIds:[demo.shops.tiktok],role:'operator'});
    await expect(createCommerceAgentSession(limited,{shopIds:[demo.shops.shopee]},{...configuration,environment:'development'}))
      .rejects.toMatchObject({status:403,code:'SHOP_FORBIDDEN'});
    await expect(createCommerceAgentSession(limited,{shopIds:[demo.shops.goods]},{...configuration,environment:'development'}))
      .rejects.toMatchObject({status:403,code:'SHOP_FORBIDDEN'});
  });

  it('does not accept caller-supplied tenant, role or subject claims',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
    await expect(createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok],tenantId:demo.tenants.goods},{...configuration,environment:'development'}))
      .rejects.toMatchObject({name:'ZodError'});
  });

  it('returns the legacy route without minting a token when the tenant flag is off or the kill switch is on',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
    const defaultLegacy=await createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},
      {...configuration,environment:'development',route:readAgentRouteConfiguration({})});
    expect(defaultLegacy).toEqual({engine:'legacy',reason:'global_disabled',token:null,expiresAt:null});
    const killed=await createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},
      {...configuration,environment:'development',route:readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'true',COMMERCE_AGENT_EVE_TENANT_IDS:demo.tenants.chino})});
    expect(killed).toEqual({engine:'legacy',reason:'kill_switch',token:null,expiresAt:null});
  });

  it('rejects dynamic routing configuration when the runtime is not explicitly non-live',()=>{
    expect(()=>commerceAgentSessionConfiguration({APP_MODE:'local-demo',AI_ENABLED:'true',COMMERCE_AGENT_DYNAMIC_ROUTING:'true'}))
      .toThrow(/AI_ENABLED=false/);
  });
});
