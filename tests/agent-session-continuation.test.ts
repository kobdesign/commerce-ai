import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readAgentRouteConfiguration} from '@commerce/agent-routing';
import {
  bindCommerceAgentSession,
  consumeCommerceAgentSessionGrant,
  createCommerceAgentSession,
  revokeCommerceAgentSession,
} from '@commerce/agent-session';
import {verifyCommerceSessionGrant} from '@commerce/agent-session-auth';
import {closePools,resolveContext,withTenant} from '@commerce/db';
import {demo} from '@commerce/domain';

const ids={tenant:randomUUID(),user:randomUUID(),shop:randomUUID()};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const keyId='session-continuation-test';
const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});

function configuration(){return {
  environment:'development' as const,keyId,privateKey,now:new Date(),
  route:readAgentRouteConfiguration({
    COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:ids.tenant,
  }),
};}
function verifier(){return {environment:'development' as const,keyId,publicKey,now:new Date()};}

beforeAll(async()=>{
  await admin.query(`INSERT INTO private.users(id,email,name,password_hash) VALUES($1,$2,'Continuation Test User','test-only')`,[ids.user,`${ids.user}@example.test`]);
  await admin.query(`INSERT INTO app.tenants(id,name) VALUES($1,'Continuation Test Tenant')`,[ids.tenant]);
  await admin.query(`INSERT INTO app.memberships(tenant_id,user_id,role,all_shops) VALUES($1,$2,'owner',true)`,[ids.tenant,ids.user]);
  await admin.query(`INSERT INTO app.shops(tenant_id,id,name,channel) VALUES($1,$2,'Synthetic Shop','tiktok')`,[ids.tenant,ids.shop]);
});
afterAll(async()=>{await Promise.all([admin.end(),closePools()]);});

async function createBoundSession(suffix:string){
  const owner=await resolveContext(ids.user,ids.tenant),config=configuration();
  const initial=await createCommerceAgentSession(owner,{shopIds:[ids.shop]},config);
  if(!initial.token)throw new Error('Expected an initial session grant.');
  const initialClaims=verifyCommerceSessionGrant(initial.token,verifier());
  await consumeCommerceAgentSessionGrant(initial.token,verifier());
  const sessionId=`wrun_${suffix}_${randomUUID().replaceAll('-','')}`;
  const bound=await bindCommerceAgentSession(owner,{sessionId,grantToken:initial.token,confirmed:true},config);
  return {owner,sessionId,bound,initialClaims,initialToken:initial.token};
}

describe('Core-owned Eve session continuation registry',()=>{
  it('binds a consumed create grant once and mints one-time grants scoped to the exact session',async()=>{
    const session=await createBoundSession('happy');
    expect(session.bound).toMatchObject({sessionId:session.sessionId,status:'active'});
    const followUp=await createCommerceAgentSession(session.owner,{sessionId:session.sessionId},configuration());
    if(!followUp.token)throw new Error('Expected a continuation grant.');
    const claims=verifyCommerceSessionGrant(followUp.token,verifier());
    expect(claims).toMatchObject({capability:'continue',sessionId:session.sessionId,tenantId:ids.tenant,subject:ids.user,shopIds:[ids.shop]});
    await expect(consumeCommerceAgentSessionGrant(followUp.token,verifier())).resolves.toMatchObject({status:'consumed'});
    await expect(consumeCommerceAgentSessionGrant(followUp.token,verifier())).rejects.toMatchObject({status:409});
    await expect(bindCommerceAgentSession(session.owner,{sessionId:`wrun_rebind_${randomUUID().replaceAll('-','')}`,grantToken:session.initialToken,confirmed:true},configuration()))
      .rejects.toMatchObject({status:409});
  });

  it('keeps session metadata tenant-scoped and rejects a caller from another tenant',async()=>{
    const session=await createBoundSession('isolation');
    const foreign=await resolveContext(demo.users.owner,demo.tenants.chino);
    await expect(createCommerceAgentSession(foreign,{sessionId:session.sessionId},{...configuration(),
      route:readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:demo.tenants.chino})}))
      .rejects.toMatchObject({status:409,code:'AGENT_SESSION_UNAVAILABLE'});
    expect(await withTenant(foreign,tx=>tx.query('SELECT session_id FROM app.agent_sessions WHERE session_id=$1',[session.sessionId]))).toEqual([]);
  });

  it('rejects an already-issued continuation grant when the current membership is removed',async()=>{
    const session=await createBoundSession('acl');
    const followUp=await createCommerceAgentSession(session.owner,{sessionId:session.sessionId},configuration());
    if(!followUp.token)throw new Error('Expected a continuation grant.');
    await admin.query('UPDATE app.memberships SET active=false WHERE tenant_id=$1 AND user_id=$2',[ids.tenant,ids.user]);
    try{
      await expect(consumeCommerceAgentSessionGrant(followUp.token,verifier())).rejects.toMatchObject({status:409,code:'AGENT_SESSION_GRANT_UNAVAILABLE'});
    }finally{
      await admin.query('UPDATE app.memberships SET active=true WHERE tenant_id=$1 AND user_id=$2',[ids.tenant,ids.user]);
    }
  });

  it('blocks both revoked and expired sessions before a continuation reaches Eve',async()=>{
    const revoked=await createBoundSession('revoked');
    const issuedBeforeRevoke=await createCommerceAgentSession(revoked.owner,{sessionId:revoked.sessionId},configuration());
    if(!issuedBeforeRevoke.token)throw new Error('Expected a continuation grant.');
    await expect(revokeCommerceAgentSession(revoked.owner,revoked.sessionId,{reason:'ยกเลิก session เพื่อทดสอบ emergency access revocation',confirmed:true}))
      .resolves.toEqual({sessionId:revoked.sessionId,status:'revoked'});
    await expect(consumeCommerceAgentSessionGrant(issuedBeforeRevoke.token,verifier())).rejects.toMatchObject({status:409});
    await expect(createCommerceAgentSession(revoked.owner,{sessionId:revoked.sessionId},configuration())).rejects.toMatchObject({status:409,code:'AGENT_SESSION_UNAVAILABLE'});

    const expired=await createBoundSession('expired');
    const issuedBeforeExpiry=await createCommerceAgentSession(expired.owner,{sessionId:expired.sessionId},configuration());
    if(!issuedBeforeExpiry.token)throw new Error('Expected a continuation grant.');
    await admin.query("UPDATE app.agent_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND session_id=$2",[ids.tenant,expired.sessionId]);
    await expect(consumeCommerceAgentSessionGrant(issuedBeforeExpiry.token,verifier())).rejects.toMatchObject({status:409});
    await expect(createCommerceAgentSession(expired.owner,{sessionId:expired.sessionId},configuration())).rejects.toMatchObject({status:409,code:'AGENT_SESSION_UNAVAILABLE'});
  });
});
