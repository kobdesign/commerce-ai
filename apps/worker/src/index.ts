import { hostname } from 'node:os';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { AppError } from '@commerce/contracts';
import { resolveContext,withTenant,closePools } from '@commerce/db';
import { catalogEvidence } from '@commerce/ai';
import { audit } from '@commerce/domain';
import { commitDraft } from '@commerce/imports';

if(!process.env.QUEUE_DATABASE_URL)throw new Error('QUEUE_DATABASE_URL required');
const queueConnection=process.env.QUEUE_DATABASE_URL;
const workerName=`${hostname().slice(0,80)}:${process.pid}`;
const queuePool=new Pool({connectionString:queueConnection,max:2,connectionTimeoutMillis:5000});
const boss=new PgBoss({connectionString:queueConnection,schema:'jobs',createSchema:false});
boss.on('error',()=>console.error('Queue error; inspect database connectivity.'));

await boss.start();
await boss.createQueue('catalog-check',{retryLimit:1,expireInSeconds:60});
const catalogPayload=z.object({userId:z.string().uuid(),tenantId:z.string().uuid(),shopId:z.string().uuid()}).strict();
await boss.work('catalog-check',async jobs=>{
  for(const job of jobs){
    const data=catalogPayload.parse(job.data);
    const ctx=await resolveContext(data.userId,data.tenantId);
    const evidence=await catalogEvidence(ctx,data.shopId);
    await withTenant(ctx,tx=>audit(tx,ctx,'catalog.checked',data.shopId,{jobId:job.id,listedSkuCount:evidence.listedSkuCount}));
  }
});

const importJob=z.object({
  tenantId:z.string().uuid(),id:z.string().uuid(),shopId:z.string().uuid(),draftId:z.string().uuid(),
  requestedBy:z.string().uuid(),attemptCount:z.number().int().min(1).max(3),
});
type ImportJob=z.infer<typeof importJob>;

async function claimImports():Promise<ImportJob[]>{
  await queuePool.query(`UPDATE app.import_commit_jobs SET status='failed',error_code='WORKER_TIMEOUT',error_message='งานหยุดก่อนเสร็จและลองใหม่ครบ 3 ครั้งแล้ว',completed_at=clock_timestamp()
    WHERE status='running' AND attempt_count>=3 AND started_at<clock_timestamp()-interval '5 minutes'`);
  const result=await queuePool.query(`WITH candidates AS (
      SELECT tenant_id,id FROM app.import_commit_jobs
      WHERE attempt_count<3 AND ((status='queued' AND next_attempt_at<=clock_timestamp()) OR (status='running' AND started_at<clock_timestamp()-interval '5 minutes'))
      ORDER BY next_attempt_at,requested_at FOR UPDATE SKIP LOCKED LIMIT 2
    ) UPDATE app.import_commit_jobs j SET status='running',attempt_count=j.attempt_count+1,worker_name=$1,started_at=clock_timestamp(),completed_at=NULL,error_code=NULL,error_message=NULL
    FROM candidates c WHERE j.tenant_id=c.tenant_id AND j.id=c.id
    RETURNING j.tenant_id AS "tenantId",j.id,j.shop_id AS "shopId",j.draft_id AS "draftId",j.requested_by AS "requestedBy",j.attempt_count AS "attemptCount"`,[workerName]);
  return z.array(importJob).parse(result.rows);
}

async function finishImport(job:ImportJob,result:{id:string;duplicate:boolean;lines:number}){
  await queuePool.query(`UPDATE app.import_commit_jobs SET status='succeeded',result=$3::jsonb,completed_at=clock_timestamp(),error_code=NULL,error_message=NULL
    WHERE tenant_id=$1 AND id=$2 AND status='running' AND worker_name=$4`,[job.tenantId,job.id,JSON.stringify(result),workerName]);
}

async function failImport(job:ImportJob,error:unknown){
  const expected=error instanceof AppError||error instanceof z.ZodError;
  const retry=!expected&&job.attemptCount<3;
  const code=expected?(error instanceof AppError?error.code:'IMPORT_CORRUPT'):'TEMPORARY_FAILURE';
  const message=expected?(error instanceof Error?error.message:'ข้อมูลร่างไม่สมบูรณ์'):(retry?'ระบบขัดข้องชั่วคราว กำลังลองใหม่':'ไม่สามารถนำเข้าได้หลังลองใหม่ 3 ครั้ง');
  await queuePool.query(`UPDATE app.import_commit_jobs SET status=$3,error_code=$4,error_message=$5,
      next_attempt_at=CASE WHEN $3='queued' THEN clock_timestamp()+make_interval(secs=>power(2,$6)::int*5) ELSE next_attempt_at END,
      completed_at=CASE WHEN $3='failed' THEN clock_timestamp() ELSE NULL END
    WHERE tenant_id=$1 AND id=$2 AND status='running' AND worker_name=$7`,[job.tenantId,job.id,retry?'queued':'failed',code,message,job.attemptCount,workerName]);
  if(!expected)console.error(`Import job ${job.id} attempt ${job.attemptCount} failed unexpectedly.`);
}

async function processImport(job:ImportJob){
  try{
    const ctx=await resolveContext(job.requestedBy,job.tenantId);
    const result=await commitDraft(ctx,{shopId:job.shopId,draftId:job.draftId});
    await finishImport(job,result);
  }catch(error){await failImport(job,error);}
}

let stopping=false;
async function importLoop(){
  while(!stopping){
    try{
      const jobs=await claimImports();
      if(jobs.length)await Promise.all(jobs.map(processImport));
      else await new Promise(resolve=>setTimeout(resolve,1500));
    }catch{console.error('Import queue poll failed; retrying.');await new Promise(resolve=>setTimeout(resolve,3000));}
  }
}
const importLoopPromise=importLoop();
console.log('Worker listening: catalog-check and import commits. Business reads reauthorize tenant and shop.');

async function stop(){
  if(stopping)return;stopping=true;
  await importLoopPromise;await boss.stop();await queuePool.end();await closePools();
}
process.on('SIGINT',()=>void stop());
process.on('SIGTERM',()=>void stop());
