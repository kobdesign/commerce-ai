import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readAgentRouteConfiguration} from '@commerce/agent-routing';
import {
  abandonCommerceAgentSession,
  bindCommerceAgentSession,
  consumeCommerceAgentSessionGrant,
  createCommerceAgentSession,
  createCommerceAgentSessionEndIntent,
  endCommerceAgentSession,
  recordCommerceAgentSessionEveReceipt,
} from '@commerce/agent-session';
import {verifyCommerceSessionGrant} from '@commerce/agent-session-auth';
import {closePools,resolveContext,withTenant} from '@commerce/db';

const ids={tenant:randomUUID(),user:randomUUID(),shop:randomUUID()};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const keyId='session-lifecycle-test';
const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL,max:1});

function configuration(){return {
  environment:'development' as const,keyId,privateKey,now:new Date(),
  route:readAgentRouteConfiguration({
    COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:ids.tenant,
  }),
};}
function verifier(){return {environment:'development' as const,keyId,publicKey,now:new Date()};}

beforeAll(async()=>{
  await admin.query(`INSERT INTO private.users(id,email,name,password_hash) VALUES($1,$2,'Lifecycle Test User','test-only')`,[ids.user,`${ids.user}@example.test`]);
  await admin.query(`INSERT INTO app.tenants(id,name) VALUES($1,'Lifecycle Test Tenant')`,[ids.tenant]);
  await admin.query(`INSERT INTO app.memberships(tenant_id,user_id,role,all_shops) VALUES($1,$2,'owner',true)`,[ids.tenant,ids.user]);
  await admin.query(`INSERT INTO app.shops(tenant_id,id,name,channel) VALUES($1,$2,'Synthetic Shop','tiktok')`,[ids.tenant,ids.shop]);
});
afterAll(async()=>{await Promise.all([admin.end(),queue.end(),closePools()]);});

async function createGrant(){
  const owner=await resolveContext(ids.user,ids.tenant),config=configuration();
  const initial=await createCommerceAgentSession(owner,{shopIds:[ids.shop]},config);
  if(!initial.token)throw new Error('Expected a create grant.');
  const claims=verifyCommerceSessionGrant(initial.token,verifier());
  await consumeCommerceAgentSessionGrant(initial.token,verifier());
  return {owner,config,token:initial.token,claims};
}
async function createBound(label:string){
  const grant=await createGrant();
  const sessionId=`wrun_${label}_${randomUUID().replaceAll('-','')}`;
  const bound=await bindCommerceAgentSession(grant.owner,{sessionId,grantToken:grant.token,confirmed:true},grant.config);
  return {...grant,sessionId,bound};
}

describe('Commerce/Eve session lifecycle persistence',()=>{
  it('returns the same binding when an ambiguous client retries the exact handshake',async()=>{
    const session=await createBound('retry');
    const retried=await bindCommerceAgentSession(session.owner,{sessionId:session.sessionId,grantToken:session.token,confirmed:true},configuration());
    expect(retried).toEqual(session.bound);
    const audit=await withTenant(session.owner,tx=>tx.query<{count:number}>(
      `SELECT count(*)::integer AS count FROM app.audit_events WHERE action='agent.session.bound' AND entity_id=$1`,[session.claims.grantId],
    ));
    expect(audit).toEqual([{count:1}]);
  });

  it('records a failed bind as abandoned and never permits continuation',async()=>{
    const grant=await createGrant();
    const sessionId=`wrun_abandoned_${randomUUID().replaceAll('-','')}`;
    const input={sessionId,grantToken:grant.token,confirmed:true as const,reason:'Synthetic Eve create succeeded but Core binding was rejected.'};
    await expect(abandonCommerceAgentSession(grant.owner,input,grant.config)).resolves.toEqual({sessionId,status:'abandoned'});
    await expect(abandonCommerceAgentSession(grant.owner,input,configuration())).resolves.toEqual({sessionId,status:'abandoned'});
    await expect(createCommerceAgentSession(grant.owner,{sessionId},configuration()))
      .rejects.toMatchObject({status:409,code:'AGENT_SESSION_UNAVAILABLE'});
    expect(await withTenant(grant.owner,tx=>tx.query('SELECT status FROM app.agent_sessions WHERE session_id=$1',[sessionId])))
      .toEqual([{status:'abandoned'}]);
  });

  it('marks Core ended only after the lifecycle callback and makes it idempotent',async()=>{
    const session=await createBound('end');
    const pending=await createCommerceAgentSession(session.owner,{sessionId:session.sessionId},configuration());
    if(!pending.token)throw new Error('Expected a continuation grant.');
    const input={reason:'User completed the synthetic Eve session lifecycle.',confirmed:true as const};
    await expect(endCommerceAgentSession(session.owner,session.sessionId,input))
      .rejects.toMatchObject({status:409,code:'AGENT_SESSION_END_EVIDENCE_REQUIRED'});
    const intent=await createCommerceAgentSessionEndIntent(session.owner,session.sessionId,{
      grantToken:pending.token,idempotencyKey:randomUUID(),reason:input.reason,confirmed:true,
    },configuration());
    await consumeCommerceAgentSessionGrant(pending.token,verifier());
    await recordCommerceAgentSessionEveReceipt(session.owner,intent.intentId,{deliveryId:'delivery_direct_123',confirmed:true});
    await expect(endCommerceAgentSession(session.owner,session.sessionId,input)).resolves.toEqual({sessionId:session.sessionId,status:'ended'});
    await expect(endCommerceAgentSession(session.owner,session.sessionId,input)).resolves.toEqual({sessionId:session.sessionId,status:'ended'});
    await expect(consumeCommerceAgentSessionGrant(pending.token,verifier())).rejects.toMatchObject({status:409});
    expect(await withTenant(session.owner,tx=>tx.query('SELECT status FROM app.agent_sessions WHERE session_id=$1',[session.sessionId])))
      .toEqual([{status:'ended'}]);
  });

  it('ends expired sessions, detects missing binds and deletes terminal metadata after 30 days',async()=>{
    const expired=await createBound('expiry');
    await admin.query("UPDATE app.agent_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND session_id=$2",[ids.tenant,expired.sessionId]);
    const orphan=await createGrant();
    await admin.query("UPDATE app.agent_session_grants SET consumed_at=clock_timestamp()-interval '16 minutes' WHERE tenant_id=$1 AND grant_id=$2",[ids.tenant,orphan.claims.grantId]);
    const first=(await queue.query<{sessions_ended:number;abandoned_recorded:number;sessions_deleted:number}>(
      'SELECT * FROM app.maintain_agent_sessions($1)',[500],
    )).rows[0];
    expect(first).toMatchObject({sessions_ended:expect.any(Number),abandoned_recorded:expect.any(Number),sessions_deleted:expect.any(Number)});
    expect(await withTenant(expired.owner,tx=>tx.query('SELECT status FROM app.agent_sessions WHERE session_id=$1',[expired.sessionId])))
      .toEqual([{status:'ended'}]);
    expect(await withTenant(orphan.owner,tx=>tx.query(
      "SELECT event_type FROM app.agent_session_grant_events WHERE grant_id=$1 AND event_type='abandoned'",[orphan.claims.grantId],
    ))).toEqual([{event_type:'abandoned'}]);
    await admin.query("UPDATE app.agent_sessions SET revoked_at=clock_timestamp()-interval '31 days' WHERE tenant_id=$1 AND session_id=$2",[ids.tenant,expired.sessionId]);
    await queue.query('SELECT * FROM app.maintain_agent_sessions($1)',[500]);
    expect(await withTenant(expired.owner,tx=>tx.query('SELECT session_id FROM app.agent_sessions WHERE session_id=$1',[expired.sessionId]))).toEqual([]);
  });
});
