import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,test } from 'vitest';
import { Pool } from 'pg';
import { importQueueReady,serviceHeartbeatStatus,stopServiceHeartbeat,touchServiceHeartbeat } from '../packages/db/src/index';
import { runtimeReadiness } from '../apps/web/lib/readiness';

const instance=`test:${randomUUID()}`;
const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
const draftId=randomUUID(),jobId=randomUUID();

afterAll(async()=>{
  await admin.query('DELETE FROM app.import_commit_jobs WHERE id=$1',[jobId]);
  await admin.query('DELETE FROM app.import_drafts WHERE id=$1',[draftId]);
  await Promise.all([stopServiceHeartbeat('worker',instance),admin.end()]);
});

describe('runtime readiness',()=>{
  test('requires restricted application and identity roles plus a fresh worker heartbeat',async()=>{
    await touchServiceHeartbeat('worker',instance);
    expect(await serviceHeartbeatStatus('worker')).toMatchObject({available:true});
    expect(await runtimeReadiness()).toEqual({
      status:'ok',
      checks:{configuration:'ok',applicationDatabase:'ok',identityDatabase:'ok',worker:'ok',importQueue:'ok',outboxQueue:'ok'},
    });
    await stopServiceHeartbeat('worker',instance);
    expect(await serviceHeartbeatStatus('worker')).toMatchObject({available:false});
    expect(await runtimeReadiness()).toMatchObject({status:'unavailable',checks:{worker:'unavailable'}});
  });

  test('reports a claimable import waiting over ten minutes without exposing queue details',async()=>{
    const source=(await admin.query<{tenant_id:string;shop_id:string;user_id:string}>(`SELECT shop.tenant_id,shop.id AS shop_id,member.user_id
      FROM app.shops shop JOIN app.memberships member ON member.tenant_id=shop.tenant_id
      WHERE member.role='owner' ORDER BY shop.tenant_id,shop.id LIMIT 1`)).rows[0];
    if(!source)throw new Error('Synthetic owner shop required.');
    await admin.query(`INSERT INTO app.import_drafts(tenant_id,id,shop_id,actor_id,filename,source_hash,fingerprint,mapping,preview)
      VALUES($1,$2,$3,$4,'readiness-test.csv',$5,$6,'{}','{}')`,[source.tenant_id,draftId,source.shop_id,source.user_id,'a'.repeat(64),`queue-readiness-${draftId}`]);
    await admin.query(`INSERT INTO app.import_commit_jobs(tenant_id,id,shop_id,draft_id,requested_by,requested_at,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '11 minutes')`,[source.tenant_id,jobId,source.shop_id,draftId,source.user_id]);
    await touchServiceHeartbeat('worker',instance);
    expect(await importQueueReady()).toBe(false);
    expect(await runtimeReadiness()).toMatchObject({status:'unavailable',checks:{worker:'ok',importQueue:'unavailable'}});
    await admin.query("UPDATE app.import_commit_jobs SET status='failed',completed_at=clock_timestamp(),error_code='TEST_COMPLETE',error_message='Synthetic readiness check complete' WHERE id=$1",[jobId]);
    expect(await importQueueReady()).toBe(true);
  });
});
