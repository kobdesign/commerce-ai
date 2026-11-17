import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readAgentRouteConfiguration} from '@commerce/agent-routing';
import {
  bindCommerceAgentSession,
  commerceAgentSessionReconciliationMetrics,
  consumeCommerceAgentSessionGrant,
  createCommerceAgentSession,
  createCommerceAgentSessionEndIntent,
  recordCommerceAgentSessionEveReceipt,
  revokeCommerceAgentSession,
} from '@commerce/agent-session';
import {verifyCommerceSessionGrant} from '@commerce/agent-session-auth';
import {closePools,resolveContext,withTenant} from '@commerce/db';

const ids={tenant:randomUUID(),user:randomUUID(),shop:randomUUID()};
const pair=generateKeyPairSync('ed25519');
const privateKey=pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64url');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const keyId='session-reconciliation-test';
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
  await admin.query(`INSERT INTO private.users(id,email,name,password_hash) VALUES($1,$2,'Reconciliation Test User','test-only')`,[ids.user,`${ids.user}@example.test`]);
  await admin.query(`INSERT INTO app.tenants(id,name) VALUES($1,'Reconciliation Test Tenant')`,[ids.tenant]);
  await admin.query(`INSERT INTO app.memberships(tenant_id,user_id,role,all_shops) VALUES($1,$2,'owner',true)`,[ids.tenant,ids.user]);
  await admin.query(`INSERT INTO app.shops(tenant_id,id,name,channel) VALUES($1,$2,'Synthetic Shop','tiktok')`,[ids.tenant,ids.shop]);
});
afterAll(async()=>{await Promise.all([admin.end(),queue.end(),closePools()]);});

async function createBound(label:string){
  const owner=await resolveContext(ids.user,ids.tenant),config=configuration();
  const initial=await createCommerceAgentSession(owner,{shopIds:[ids.shop]},config);
  if(!initial.token)throw new Error('Expected a create grant.');
  await consumeCommerceAgentSessionGrant(initial.token,verifier());
  const sessionId=`wrun_${label}_${randomUUID().replaceAll('-','')}`;
  await bindCommerceAgentSession(owner,{sessionId,grantToken:initial.token,confirmed:true},config);
  return {owner,sessionId};
}

async function endGrant(sessionId:string){
  const owner=await resolveContext(ids.user,ids.tenant);
  const issued=await createCommerceAgentSession(owner,{sessionId},configuration());
  if(!issued.token)throw new Error('Expected a continuation grant.');
  const claims=verifyCommerceSessionGrant(issued.token,verifier());
  return {owner,token:issued.token,claims};
}

async function processReconciliations(){
  return (await queue.query<{
    sessions_finalized:number;intents_retried:number;intents_failed:number;intents_timed_out:number;
  }>('SELECT * FROM app.process_agent_session_reconciliations($1)',[500])).rows[0];
}

describe('durable Commerce/Eve lifecycle reconciliation',()=>{
  it('finalizes a receipt-backed end intent after the direct callback is lost',async()=>{
    const session=await createBound('worker_finalizes');
    const grant=await endGrant(session.sessionId);
    const idempotencyKey=randomUUID();
    const input={grantToken:grant.token,idempotencyKey,reason:'Synthetic Eve accepted the durable end request.',confirmed:true as const};
    const intent=await createCommerceAgentSessionEndIntent(grant.owner,session.sessionId,input,configuration());
    await expect(createCommerceAgentSessionEndIntent(grant.owner,session.sessionId,input,configuration())).resolves.toEqual(intent);
    await consumeCommerceAgentSessionGrant(grant.token,verifier());
    await expect(recordCommerceAgentSessionEveReceipt(grant.owner,intent.intentId,{deliveryId:'delivery_worker_123',confirmed:true}))
      .resolves.toEqual({intentId:intent.intentId,status:'receipt_received'});

    await processReconciliations();
    expect(await withTenant(grant.owner,tx=>tx.query(
      `SELECT s.status,r.status AS reconciliation_status
       FROM app.agent_sessions s JOIN app.agent_session_reconciliations r USING(tenant_id,session_id)
       WHERE s.session_id=$1 AND r.id=$2`,[session.sessionId,intent.intentId],
    ))).toEqual([{status:'ended',reconciliation_status:'succeeded'}]);
    const audits=await withTenant(grant.owner,tx=>tx.query<{count:number}>(
      `SELECT count(*)::integer AS count FROM app.audit_events
       WHERE action='agent.session.ended' AND details->>'source'='durable-reconciliation' AND details->>'sessionId'=$1`,
      [session.sessionId],
    ));
    expect(audits).toEqual([{count:1}]);
    await processReconciliations();
    expect(await withTenant(grant.owner,tx=>tx.query<{count:number}>(
      `SELECT count(*)::integer AS count FROM app.audit_events
       WHERE action='agent.session.ended' AND details->>'source'='durable-reconciliation' AND details->>'sessionId'=$1`,
      [session.sessionId],
    ))).toEqual([{count:1}]);
  });

  it('rejects changed intent or receipt payloads under the same identity',async()=>{
    const session=await createBound('conflict');
    const grant=await endGrant(session.sessionId);
    const idempotencyKey=randomUUID();
    const base={grantToken:grant.token,idempotencyKey,reason:'Synthetic exact intent retry remains stable.',confirmed:true as const};
    const intent=await createCommerceAgentSessionEndIntent(grant.owner,session.sessionId,base,configuration());
    await expect(createCommerceAgentSessionEndIntent(grant.owner,session.sessionId,{...base,reason:'A different synthetic reason must conflict.'},configuration()))
      .rejects.toMatchObject({status:409,code:'AGENT_SESSION_INTENT_CONFLICT'});
    await recordCommerceAgentSessionEveReceipt(grant.owner,intent.intentId,{deliveryId:'delivery_exact_123',confirmed:true});
    await expect(recordCommerceAgentSessionEveReceipt(grant.owner,intent.intentId,{deliveryId:'delivery_other_123',confirmed:true}))
      .rejects.toMatchObject({status:409,code:'AGENT_SESSION_RECEIPT_CONFLICT'});
  });

  it('uses bounded retries and exposes a terminal Core mismatch',async()=>{
    const session=await createBound('mismatch');
    const grant=await endGrant(session.sessionId);
    const intent=await createCommerceAgentSessionEndIntent(grant.owner,session.sessionId,{
      grantToken:grant.token,idempotencyKey:randomUUID(),reason:'Synthetic receipt arrives without grant consumption.',confirmed:true,
    },configuration());
    await recordCommerceAgentSessionEveReceipt(grant.owner,intent.intentId,{deliveryId:'delivery_mismatch_123',confirmed:true});
    for(let attempt=0;attempt<5;attempt+=1){
      await admin.query(`UPDATE app.agent_session_reconciliations SET next_attempt_at=clock_timestamp()-interval '1 second'
        WHERE tenant_id=$1 AND id=$2`,[ids.tenant,intent.intentId]);
      await processReconciliations();
    }
    expect(await withTenant(grant.owner,tx=>tx.query(
      `SELECT status,attempt_count AS "attemptCount",last_error_code AS "lastErrorCode"
       FROM app.agent_session_reconciliations WHERE id=$1`,[intent.intentId],
    ))).toEqual([{status:'failed',attemptCount:5,lastErrorCode:'CORE_SESSION_MISMATCH'}]);
  });

  it('claims and confirms emergency Eve cleanup with queue-only receipt evidence',async()=>{
    const session=await createBound('cleanup_confirmed');
    await revokeCommerceAgentSession(session.owner,session.sessionId,{
      reason:'Synthetic emergency cleanup is confirmed by Eve.',confirmed:true,
    });
    const intent=(await withTenant(session.owner,tx=>tx.query<{id:string}>(
      `SELECT id FROM app.agent_session_reconciliations WHERE session_id=$1 AND action='revoke_cleanup'`,[session.sessionId],
    )))[0]!;
    const claimed=await queue.query<{tenantId:string;intentId:string;sessionId:string;attemptCount:number}>(
      `SELECT tenant_id AS "tenantId",intent_id AS "intentId",session_id AS "sessionId",attempt_count AS "attemptCount"
       FROM app.claim_agent_session_cleanup_reconciliations($1)`,[100],
    );
    expect(claimed.rows).toContainEqual({tenantId:ids.tenant,intentId:intent.id,sessionId:session.sessionId,attemptCount:1});
    await queue.query('SELECT * FROM app.complete_agent_session_cleanup_reconciliation($1,$2,$3)',[
      ids.tenant,intent.id,'delivery_cleanup_confirmed_123',
    ]);
    expect(await withTenant(session.owner,tx=>tx.query(
      `SELECT status,eve_delivery_id AS "deliveryId",last_error_code AS "lastErrorCode"
       FROM app.agent_session_reconciliations WHERE id=$1`,[intent.id],
    ))).toEqual([{status:'succeeded',deliveryId:'delivery_cleanup_confirmed_123',lastErrorCode:null}]);
  });

  it('bounds cleanup dispatch retries and exposes a terminal failure',async()=>{
    const session=await createBound('cleanup_failed');
    await revokeCommerceAgentSession(session.owner,session.sessionId,{
      reason:'Synthetic cleanup dispatch remains unavailable.',confirmed:true,
    });
    const intent=(await withTenant(session.owner,tx=>tx.query<{id:string}>(
      `SELECT id FROM app.agent_session_reconciliations WHERE session_id=$1 AND action='revoke_cleanup'`,[session.sessionId],
    )))[0]!;
    for(let attempt=1;attempt<=5;attempt+=1){
      await admin.query(`UPDATE app.agent_session_reconciliations SET next_attempt_at=clock_timestamp()-interval '1 second'
        WHERE tenant_id=$1 AND id=$2`,[ids.tenant,intent.id]);
      const claimed=await queue.query<{intentId:string}>(
        `SELECT intent_id AS "intentId" FROM app.claim_agent_session_cleanup_reconciliations($1)`,[100],
      );
      expect(claimed.rows.some(row=>row.intentId===intent.id)).toBe(true);
      await queue.query('SELECT * FROM app.fail_agent_session_cleanup_reconciliation($1,$2,$3)',[
        ids.tenant,intent.id,'EVE_CLEANUP_UNAVAILABLE',
      ]);
    }
    expect(await withTenant(session.owner,tx=>tx.query(
      `SELECT status,attempt_count AS "attemptCount",last_error_code AS "lastErrorCode"
       FROM app.agent_session_reconciliations WHERE id=$1`,[intent.id],
    ))).toEqual([{status:'failed',attemptCount:5,lastErrorCode:'EVE_CLEANUP_UNAVAILABLE'}]);
  });

  it('keeps emergency Core revocation immediate and reports missing Eve cleanup evidence',async()=>{
    const session=await createBound('revoke_cleanup');
    await revokeCommerceAgentSession(session.owner,session.sessionId,{
      reason:'Synthetic operator emergency revocation.',confirmed:true,
    });
    const before=await commerceAgentSessionReconciliationMetrics(session.owner);
    expect(before.contentCaptured).toBe(false);
    expect(before.metrics.pendingRevokeCleanup).toBeGreaterThanOrEqual(1);
    await admin.query(`UPDATE app.agent_session_reconciliations SET requested_at=clock_timestamp()-interval '16 minutes'
      WHERE tenant_id=$1 AND session_id=$2 AND action='revoke_cleanup'`,[ids.tenant,session.sessionId]);
    await processReconciliations();
    const rows=await withTenant(session.owner,tx=>tx.query(
      `SELECT status,last_error_code AS "lastErrorCode" FROM app.agent_session_reconciliations
       WHERE session_id=$1 AND action='revoke_cleanup'`,[session.sessionId],
    ));
    expect(rows).toEqual([{status:'failed',lastErrorCode:'EVE_RECEIPT_MISSING'}]);
    const after=await commerceAgentSessionReconciliationMetrics(session.owner);
    expect(after.metrics.failed).toBeGreaterThanOrEqual(1);
  });
});
