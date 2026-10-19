import { identityPool,importQueueReady,outboxQueueReady,pool,serviceHeartbeatStatus } from '@commerce/db';
import { deploymentConfiguration } from '@commerce/operations';

export type ReadinessCheck='configuration'|'applicationDatabase'|'identityDatabase'|'worker'|'importQueue'|'outboxQueue';
export type ReadinessReport={status:'ok'|'unavailable';checks:Record<ReadinessCheck,'ok'|'unavailable'>};

async function safe(check:()=>Promise<boolean>){
  try{return await check()?'ok' as const:'unavailable' as const;}
  catch{return 'unavailable' as const;}
}

async function restrictedRole(database:'application'|'identity'){
  const connection=database==='application'?pool():identityPool();
  const expected=database==='application'?'commerce_app':'commerce_identity';
  const row=(await connection.query<{role_name:string;superuser:boolean;bypass_rls:boolean}>(
    `SELECT current_user AS role_name,r.rolsuper AS superuser,r.rolbypassrls AS bypass_rls
     FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`,
  )).rows[0];
  return row?.role_name===expected&&!row.superuser&&!row.bypass_rls;
}

export async function runtimeReadiness():Promise<ReadinessReport>{
  const configuration=deploymentConfiguration('web').status==='ok'?'ok' as const:'unavailable' as const;
  const [applicationDatabase,identityDatabase,worker,importQueue,outboxQueue]=await Promise.all([
    safe(()=>restrictedRole('application')),
    safe(()=>restrictedRole('identity')),
    safe(async()=>((await serviceHeartbeatStatus('worker')).available)),
    safe(importQueueReady),
    safe(outboxQueueReady),
  ]);
  const checks={configuration,applicationDatabase,identityDatabase,worker,importQueue,outboxQueue};
  return {status:Object.values(checks).every(value=>value==='ok')?'ok':'unavailable',checks};
}
