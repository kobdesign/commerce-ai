import { generateKeyPairSync } from 'node:crypto';
import { afterAll,beforeEach,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { readAgentRouteConfiguration } from '@commerce/agent-routing';
import { consumeCommerceAgentSessionGrant,createCommerceAgentSession } from '@commerce/agent-session';
import { verifyCommerceSessionGrant } from '@commerce/agent-session-auth';
import {
  agentRouteControlWorkspace,
  approveAgentRoutePolicy,
  closePools,
  proposeAgentRoutePolicy,
  resolveContext,
  revokeAgentRoutePolicy,
  withTenant,
} from '@commerce/db';
import { demo } from '@commerce/domain';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const route=readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false'});
const sessionConfiguration={environment:'development' as const,keyId:'dynamic-route-test',privateKey,route,dynamicRouting:true};
const expiresAt=()=>new Date(Date.now()+60*60_000).toISOString();
const proposal=(version=0)=>({version,environment:'development' as const,expiresAt:expiresAt(),reason:'ขอเปิดเส้นทาง Eve สำหรับข้อมูลสังเคราะห์ในการทดสอบเท่านั้น',confirmed:true as const});
const approval=(version:number)=>({version,reason:'ตรวจขอบเขต tenant และข้อมูลสังเคราะห์ครบแล้ว อนุมัติให้ทดสอบ',confirmed:true as const});

beforeEach(async()=>{
  await admin.query('DELETE FROM app.agent_route_policy_events');
  await admin.query('DELETE FROM app.agent_route_policies');
});
afterAll(async()=>{await closePools();await admin.end();});

describe('Dynamic tenant agent route control plane',()=>{
  it('requires an owner proposal and independent auditor approval before issuing an Eve grant',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);
    const pending=await proposeAgentRoutePolicy(owner,proposal());
    expect(pending).toMatchObject({tenantId:demo.tenants.chino,status:'pending',version:1,environment:'development',dataScope:'synthetic'});

    const before=await createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},sessionConfiguration);
    expect(before).toEqual({engine:'legacy',reason:'dynamic_policy_pending',token:null,expiresAt:null});
    await expect(approveAgentRoutePolicy(owner,approval(1))).rejects.toMatchObject({status:403,code:'FORBIDDEN'});

    const active=await approveAgentRoutePolicy(auditor,approval(1));
    expect(active).toMatchObject({status:'active',version:2,approvedBy:demo.users.consultant});
    const granted=await createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},sessionConfiguration);
    expect(granted).toMatchObject({engine:'eve',reason:'dynamic_tenant_enabled'});
    if(!granted.token)throw new Error('Expected a dynamic Eve session grant.');
    expect(verifyCommerceSessionGrant(granted.token,{keyId:'dynamic-route-test',publicKey,environment:'development'})).toMatchObject({tenantId:demo.tenants.chino});

    const workspace=await agentRouteControlWorkspace(auditor);
    expect(workspace.events.map(event=>event.action)).toEqual(['approved','proposed']);
    expect(await withTenant(owner,tx=>tx.query("SELECT action FROM app.audit_events WHERE entity_id=$1 AND action LIKE 'agent.route.%' ORDER BY created_at",[active.id])))
      .toEqual([{action:'agent.route.proposed'},{action:'agent.route.approved'}]);
  });

  it('revokes immediately for new grants and invalidates active grants already issued',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino),auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);
    await proposeAgentRoutePolicy(owner,proposal());
    const active=await approveAgentRoutePolicy(auditor,approval(1));
    const prior=await createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},sessionConfiguration);
    const revoked=await revokeAgentRoutePolicy(owner,{version:active.version,reason:'หยุดออก session grant ใหม่ทันทีเพื่อทดสอบ emergency stop',confirmed:true});
    expect(revoked).toMatchObject({status:'revoked',version:3,revokedBy:demo.users.owner});
    await expect(createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},sessionConfiguration))
      .resolves.toEqual({engine:'legacy',reason:'dynamic_policy_revoked',token:null,expiresAt:null});
    if(!prior.token)throw new Error('Expected the pre-revocation grant.');
    expect(verifyCommerceSessionGrant(prior.token,{keyId:'dynamic-route-test',publicKey,environment:'development'}).expiresAt).toBeGreaterThan(Math.floor(Date.now()/1000));
    await expect(consumeCommerceAgentSessionGrant(prior.token,{keyId:'dynamic-route-test',publicKey,environment:'development'}))
      .rejects.toMatchObject({status:409,code:'AGENT_SESSION_GRANT_UNAVAILABLE'});
    expect((await agentRouteControlWorkspace(owner)).events.map(event=>event.action)).toEqual(['revoked','approved','proposed']);
  });

  it('serializes approvals with optimistic versioning and keeps the event ledger append-only',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino),auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);
    await proposeAgentRoutePolicy(owner,proposal());
    const results=await Promise.allSettled([approveAgentRoutePolicy(auditor,approval(1)),approveAgentRoutePolicy(auditor,approval(1))]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const rejected=results.find(result=>result.status==='rejected');
    expect(rejected?.status==='rejected'&&rejected.reason).toMatchObject({status:409,code:'STALE_AGENT_ROUTE_POLICY'});
    await expect(withTenant(owner,tx=>tx.query("UPDATE app.agent_route_policy_events SET reason='changed' WHERE tenant_id=$1",[owner.tenantId])))
      .rejects.toMatchObject({code:'42501'});
    await expect(withTenant(owner,tx=>tx.query('DELETE FROM app.agent_route_policy_events WHERE tenant_id=$1',[owner.tenantId])))
      .rejects.toMatchObject({code:'42501'});
  });

  it('enforces tenant, role, environment and expiry boundaries',async()=>{
    const owner=await resolveContext(demo.users.owner,demo.tenants.chino),otherOwner=await resolveContext(demo.users.other,demo.tenants.goods);
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino);
    await expect(proposeAgentRoutePolicy(marketing,proposal())).rejects.toMatchObject({status:403});
    await expect(proposeAgentRoutePolicy(owner,{...proposal(),environment:'staging'})).rejects.toMatchObject({status:400,code:'AGENT_ROUTE_ENVIRONMENT_MISMATCH'});
    await proposeAgentRoutePolicy(owner,proposal());
    const active=await approveAgentRoutePolicy(auditor,approval(1));
    expect((await agentRouteControlWorkspace(otherOwner)).policy).toBeNull();
    await admin.query("UPDATE app.agent_route_policies SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1",[owner.tenantId]);
    await expect(createCommerceAgentSession(owner,{shopIds:[demo.shops.tiktok]},sessionConfiguration))
      .resolves.toEqual({engine:'legacy',reason:'dynamic_policy_expired',token:null,expiresAt:null});
    await expect(proposeAgentRoutePolicy(owner,proposal(active.version))).resolves.toMatchObject({status:'pending',version:active.version+1});
  });
});
