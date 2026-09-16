import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { resolveContext,withTenant,closePools } from '@commerce/db';
import { catalogEvidence } from '@commerce/ai';
import { audit } from '@commerce/domain';
if(!process.env.QUEUE_DATABASE_URL)throw new Error('QUEUE_DATABASE_URL required');
const boss=new PgBoss({connectionString:process.env.QUEUE_DATABASE_URL,schema:'jobs',createSchema:false});
boss.on('error',()=>console.error('Queue error; inspect database connectivity.'));
await boss.start();await boss.createQueue('catalog-check',{retryLimit:1,expireInSeconds:60});
const payload=z.object({userId:z.string().uuid(),tenantId:z.string().uuid(),shopId:z.string().uuid()}).strict();
await boss.work('catalog-check',async jobs=>{
  for(const job of jobs){
    const data=payload.parse(job.data);
    const ctx=await resolveContext(data.userId,data.tenantId);
    const evidence=await catalogEvidence(ctx,data.shopId);
    await withTenant(ctx,tx=>audit(tx,ctx,'catalog.checked',data.shopId,{jobId:job.id,listedSkuCount:evidence.listedSkuCount}));
  }
});
console.log('Worker listening: catalog-check. All business reads reauthorize tenant and shop.');
async function stop(){await boss.stop();await closePools();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
