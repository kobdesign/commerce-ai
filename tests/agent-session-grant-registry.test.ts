import {generateKeyPairSync} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,describe,expect,it} from 'vitest';
import {readAgentRouteConfiguration} from '@commerce/agent-routing';
import {
  consumeCommerceAgentSessionGrant,
  createCommerceAgentSession,
  revokeCommerceAgentSessionGrant,
} from '@commerce/agent-session';
import {verifyCommerceSessionGrant} from '@commerce/agent-session-auth';
import {closePools,consumeAgentSessionGrant,readAgentSessionGrantMetrics,resolveContext,withTenant} from '@commerce/db';
import {demo} from '@commerce/domain';

const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const keyId='grant-registry-test';
const route=readAgentRouteConfiguration({COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_EVE_TENANT_IDS:demo.tenants.goods});
const configuration=()=>({environment:'development' as const,keyId,privateKey,route,now:new Date()});
const verifier=()=>({environment:'development' as const,keyId,publicKey,now:new Date()});

afterAll(closePools);

async function grant(){
  const owner=await resolveContext(demo.users.other,demo.tenants.goods);
  const issued=await createCommerceAgentSession(owner,{shopIds:[demo.shops.goods]},configuration());
  if(!issued.token)throw new Error('Expected an Eve session grant.');
  return {owner,token:issued.token,claims:verifyCommerceSessionGrant(issued.token,verifier())};
}

describe('Commerce agent session grant registry',()=>{
  it('consumes a grant once and rejects sequential replay',async()=>{
    const issued=await grant();
    await expect(consumeCommerceAgentSessionGrant(issued.token,verifier())).resolves.toMatchObject({status:'consumed',grantId:issued.claims.grantId});
    await expect(consumeCommerceAgentSessionGrant(issued.token,verifier())).rejects.toMatchObject({status:409,code:'AGENT_SESSION_GRANT_UNAVAILABLE'});
  });

  it('allows only one winner under concurrent consumption',async()=>{
    const issued=await grant();
    const results=await Promise.allSettled([
      consumeCommerceAgentSessionGrant(issued.token,verifier()),
      consumeCommerceAgentSessionGrant(issued.token,verifier()),
    ]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
  });

  it('revokes an active grant before consumption and records tenant-scoped state',async()=>{
    const issued=await grant();
    await expect(revokeCommerceAgentSessionGrant(issued.owner,issued.claims.grantId,{reason:'ยกเลิก grant ก่อนเริ่ม session เพื่อทดสอบ emergency revoke',confirmed:true}))
      .resolves.toEqual({grantId:issued.claims.grantId,status:'revoked'});
    await expect(consumeCommerceAgentSessionGrant(issued.token,verifier())).rejects.toMatchObject({status:409});
    expect(await withTenant(issued.owner,tx=>tx.query('SELECT status FROM app.agent_session_grants WHERE grant_id=$1',[issued.claims.grantId])))
      .toEqual([{status:'revoked'}]);
    await expect(withTenant(issued.owner,tx=>tx.query("UPDATE app.agent_session_grants SET status='active' WHERE grant_id=$1",[issued.claims.grantId])))
      .rejects.toMatchObject({code:'42501'});
    const foreign=await resolveContext(demo.users.owner,demo.tenants.chino);
    expect(await withTenant(foreign,tx=>tx.query('SELECT status FROM app.agent_session_grants WHERE grant_id=$1',[issued.claims.grantId]))).toEqual([]);
  });

  it('rejects a cross-tenant claim projection even with a real registered grant id',async()=>{
    const issued=await grant();
    await expect(consumeAgentSessionGrant({...issued.claims,tenantId:demo.tenants.chino})).rejects.toThrow(/AGENT_SESSION_GRANT_UNAVAILABLE/);
  });

  it('records bounded replay telemetry and rate-limits the sixth attempt in one minute',async()=>{
    const issued=await grant();
    await consumeCommerceAgentSessionGrant(issued.token,verifier());
    for(let attempt=0;attempt<5;attempt++)await expect(consumeCommerceAgentSessionGrant(issued.token,verifier())).rejects.toMatchObject({status:409});
    const events=await withTenant(issued.owner,tx=>tx.query<{eventType:string;events:number}>(
      `SELECT event_type AS "eventType",count(*)::integer AS events FROM app.agent_session_grant_events
       WHERE grant_id=$1 AND event_type IN ('replay','rate_limited') GROUP BY event_type ORDER BY event_type`,[issued.claims.grantId],
    ));
    expect(events).toEqual([{eventType:'rate_limited',events:1},{eventType:'replay',events:4}]);
    await expect(readAgentSessionGrantMetrics(issued.owner,60)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({eventType:'replay'}),expect.objectContaining({eventType:'rate_limited'}),
    ]));
  });

  it('records expiry and removes grants older than the fixed seven-day active retention',async()=>{
    const owner=await resolveContext(demo.users.other,demo.tenants.goods);
    const issued=await createCommerceAgentSession(owner,{shopIds:[demo.shops.goods]},{...configuration(),now:new Date(Date.now()-8*24*60*60*1000)});
    if(!issued.token)throw new Error('Expected an expired Eve session grant fixture.');
    const claims=verifyCommerceSessionGrant(issued.token,{...verifier(),now:new Date(Date.now()-8*24*60*60*1000)});
    const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL,max:1});
    try{
      const maintenance=(await queue.query<{expired_recorded:number;grants_deleted:number}>('SELECT * FROM app.maintain_agent_session_grants($1)',[500])).rows[0];
      expect(maintenance).toMatchObject({expired_recorded:expect.any(Number),grants_deleted:expect.any(Number)});
    }finally{await queue.end();}
    expect(await withTenant(owner,tx=>tx.query('SELECT grant_id FROM app.agent_session_grants WHERE grant_id=$1',[claims.grantId]))).toEqual([]);
    expect(await withTenant(owner,tx=>tx.query("SELECT event_type FROM app.agent_session_grant_events WHERE grant_id=$1 AND event_type='expired'",[claims.grantId])))
      .toEqual([{event_type:'expired'}]);
  });
});
