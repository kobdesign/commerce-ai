import { afterAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo } from '@commerce/domain';
import { commitDraft,importCommitStatus,requestDraftCommit,saveDraft } from '@commerce/imports';

const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL});
afterAll(async()=>{await closePools();await queue.end();});

async function draft(){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),sku=`JOB-${randomUUID()}`;
  await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'สินค้าทดสอบคิวนำเข้า',category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{},variants:[{sku,attributes:{},priceMinor:30000,costMinor:12000}]});
  const input={shopId:demo.shops.tiktok,filename:`job-${randomUUID()}.csv`,delimiter:',' as const,csv:`order_id,sku,quantity,date,net_receipt\nORDER-${randomUUID()},${sku},1,2026-09-17,250.00\n`,mapping:{orderId:'order_id',sourceLineId:'',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:''}};
  return {ctx,input,saved:await saveDraft(ctx,input)};
}

describe('Durable import commit jobs',()=>{
  it('queues once, exposes status through tenant scope and completes idempotently',async()=>{
    const {ctx,input,saved}=await draft();
    const first=await requestDraftCommit(ctx,{shopId:input.shopId,draftId:saved.id});
    const second=await requestDraftCommit(ctx,{shopId:input.shopId,draftId:saved.id});
    expect(second).toMatchObject({id:first.id,status:'queued',attemptCount:0});

    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);
    expect(await importCommitStatus(auditor,{shopId:input.shopId,draftId:saved.id})).toMatchObject({id:first.id,status:'queued'});
    await expect(requestDraftCommit(auditor,{shopId:input.shopId,draftId:saved.id})).rejects.toMatchObject({status:403});

    await withTenant(ctx,tx=>tx.query("UPDATE app.import_commit_jobs SET status='running' WHERE id=$1",[first.id]));
    expect(await importCommitStatus(ctx,{shopId:input.shopId,draftId:saved.id})).toMatchObject({status:'queued'});

    const claimed=await queue.query(`UPDATE app.import_commit_jobs SET status='running',attempt_count=1,worker_name='test-worker',started_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2 RETURNING id`,[ctx.tenantId,first.id]);
    expect(claimed.rowCount).toBe(1);
    const result=await commitDraft(ctx,{shopId:input.shopId,draftId:saved.id});
    await queue.query(`UPDATE app.import_commit_jobs SET status='succeeded',result=$3::jsonb,completed_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2`,[ctx.tenantId,first.id,JSON.stringify(result)]);
    expect(await importCommitStatus(ctx,{shopId:input.shopId,draftId:saved.id})).toMatchObject({status:'succeeded',result:{id:result.id,lines:1}});
    expect((await requestDraftCommit(ctx,{shopId:input.shopId,draftId:saved.id})).status).toBe('succeeded');
  });

  it('allows an authorized user to requeue a failed job without creating a second job',async()=>{
    const {ctx,input,saved}=await draft(),job=await requestDraftCommit(ctx,{shopId:input.shopId,draftId:saved.id});
    await queue.query(`UPDATE app.import_commit_jobs SET status='failed',attempt_count=3,error_code='TEMPORARY_FAILURE',error_message='ลองครบแล้ว',completed_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2`,[ctx.tenantId,job.id]);
    const retried=await requestDraftCommit(ctx,{shopId:input.shopId,draftId:saved.id});
    expect(retried).toMatchObject({id:job.id,status:'queued',attemptCount:0,errorCode:null,errorMessage:null});
    const rows=await queue.query('SELECT id FROM app.import_commit_jobs WHERE tenant_id=$1 AND draft_id=$2',[ctx.tenantId,saved.id]);
    expect(rows.rowCount).toBe(1);
  });
});
