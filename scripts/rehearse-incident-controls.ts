import { chmod,mkdir,rename,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname,resolve } from 'node:path';
import { Pool } from 'pg';
import { AppError } from '@commerce/contracts';
import { assertOperationalControl,closePools,operationalControlEnabled,pool } from '@commerce/db';

const reportPath=resolve(process.env.INCIDENT_REHEARSAL_REPORT_PATH??'docs/evidence/incident-rehearsal-latest.json');
const startedAt=new Date(),runId=randomUUID(),actor='incident-rehearsal-local';
const adminUrl=process.env.ADMIN_DATABASE_URL,databaseUrl=process.env.DATABASE_URL;
if(process.env.APP_MODE!=='local-demo')throw new Error('Incident rehearsal is local-only. Staging requires an approved incident window and explicit staging procedure.');
function localDatabase(raw:string|undefined,name:string){
  if(!raw)throw new Error(`${name} is required.`);const url=new URL(raw);
  if(!['127.0.0.1','localhost','::1'].includes(url.hostname))throw new Error(`${name} must point to a local database for this rehearsal.`);
  return raw;
}
const admin=new Pool({connectionString:localDatabase(adminUrl,'ADMIN_DATABASE_URL'),max:1});
localDatabase(databaseUrl,'DATABASE_URL');
const checks={startedEnabled:false,controlsDisabled:false,mutationGateBlocked:false,readPathAvailable:false,auditEvents:false,controlsRestored:false};
let status:'passed'|'failed'='failed',failure:string|undefined;
async function update(enabled:boolean,phase:string){
  await admin.query('BEGIN');
  try{
    const result=await admin.query(`UPDATE app.operational_controls SET enabled=$1,reason=$2,changed_by=$3,changed_at=clock_timestamp() WHERE control_name IN ('web_mutations','import_commits')`,[enabled,`REHEARSAL ${runId} ${phase}`,actor]);
    if(result.rowCount!==2)throw new Error('Expected two operational controls.');
    await admin.query('COMMIT');
  }catch(error){await admin.query('ROLLBACK');throw error;}
}
try{
  const initial=(await admin.query<{control_name:string;enabled:boolean}>('SELECT control_name,enabled FROM app.operational_controls ORDER BY control_name')).rows;
  checks.startedEnabled=initial.length===2&&initial.every(item=>item.enabled);
  if(!checks.startedEnabled)throw new Error('Rehearsal requires both controls enabled before starting.');
  await update(false,'freeze');
  checks.controlsDisabled=!await operationalControlEnabled('web_mutations')&&!await operationalControlEnabled('import_commits');
  try{await assertOperationalControl('web_mutations');}catch(error){checks.mutationGateBlocked=error instanceof AppError&&error.status===503&&error.code==='OPERATION_PAUSED';}
  const read=await pool().query<{role_name:string;tenant_count:string}>('SELECT current_user AS role_name,(SELECT count(*)::text FROM app.tenants) AS tenant_count');
  checks.readPathAvailable=read.rows[0]?.role_name==='commerce_app'&&Number(read.rows[0].tenant_count)>=0;
  await update(true,'recover');
  checks.controlsRestored=await operationalControlEnabled('web_mutations')&&await operationalControlEnabled('import_commits');
  const events=await admin.query<{count:string}>('SELECT count(*)::text AS count FROM app.operational_control_events WHERE changed_by=$1 AND reason LIKE $2',[actor,`%${runId}%`]);
  checks.auditEvents=Number(events.rows[0]?.count)===4;
  if(!Object.values(checks).every(Boolean))throw new Error('One or more rehearsal checks failed.');
  status='passed';
}catch(error){failure=error instanceof Error?error.message:'Unknown rehearsal failure';}
finally{
  try{
    const current=(await admin.query<{enabled:boolean}>('SELECT enabled FROM app.operational_controls')).rows;
    if(current.length===2&&current.some(item=>!item.enabled))await update(true,'emergency-cleanup');
    const finalControls=(await admin.query<{enabled:boolean}>('SELECT enabled FROM app.operational_controls')).rows;
    checks.controlsRestored=finalControls.length===2&&finalControls.every(item=>item.enabled);
  }catch{checks.controlsRestored=false;}
  await Promise.allSettled([admin.end(),closePools()]);
}
if(!checks.controlsRestored){status='failed';failure??='Operational controls could not be restored.';}
const report={status,runId,startedAt:startedAt.toISOString(),completedAt:new Date().toISOString(),scope:'local rehearsal only',checks,...(failure?{failure}:{}),staging:{status:'not-run',reason:'MONITOR_BASE_URL, alert destination and approved incident owner are not configured in this workspace'}};
await mkdir(dirname(reportPath),{recursive:true});const temporary=`${reportPath}.${process.pid}.tmp`;
await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(temporary,reportPath);await chmod(reportPath,0o600);
console.log(JSON.stringify(report,null,2));if(status!=='passed'||!checks.controlsRestored)process.exitCode=1;
