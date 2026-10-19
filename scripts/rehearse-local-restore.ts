import { createHash,randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream,createWriteStream } from 'node:fs';
import { mkdir,stat,unlink,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Pool } from 'pg';

if(process.env.APP_MODE!=='local-demo')throw new Error('Restore rehearsal is restricted to APP_MODE=local-demo.');
const required=['ADMIN_DATABASE_URL','DATABASE_URL','IDENTITY_DATABASE_URL','QUEUE_DATABASE_URL'] as const;
for(const key of required)if(!process.env[key])throw new Error(`${key} is required.`);
const sourceAdmin=new URL(process.env.ADMIN_DATABASE_URL!);
if(!['127.0.0.1','localhost','::1'].includes(sourceAdmin.hostname))throw new Error('Restore rehearsal only accepts a loopback PostgreSQL host.');
const sourceDatabase=decodeURIComponent(sourceAdmin.pathname.slice(1));
if(!sourceDatabase||['postgres','template0','template1'].includes(sourceDatabase)||sourceDatabase.startsWith('commerce_restore_'))throw new Error('Unsafe source database name.');

const restoreDatabase=`commerce_restore_${randomBytes(6).toString('hex')}`;
const dumpPath=join(tmpdir(),`${restoreDatabase}.dump`);
const reportPath=join(process.cwd(),'docs','evidence','restore-rehearsal-latest.json');
const maintenanceUrl=new URL(sourceAdmin);maintenanceUrl.pathname='/postgres';
const restoredAdminUrl=new URL(sourceAdmin);restoredAdminUrl.pathname=`/${restoreDatabase}`;
const maintenance=new Pool({connectionString:maintenanceUrl.toString(),max:1,connectionTimeoutMillis:5000});
let databaseCreated=false;

const stableTables=[
  'app.tenants','app.memberships','app.shops','app.shop_grants','app.products','app.variants','app.cost_versions',
  'app.import_sources','app.import_drafts','app.import_batches','app.sales_lines','app.financial_events','app.shop_expenses',
  'app.settlement_import_batches','app.settlement_lines','app.evidence_objects','app.financial_review_tasks','app.audit_events',
] as const;

function identifier(value:string){return `"${value.replaceAll('"','""')}"`;}
function databaseUrl(original:string){const value=new URL(original);value.pathname=`/${restoreDatabase}`;return value.toString();}
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

async function processExit(child:ReturnType<typeof spawn>){
  let stderr='';child.stderr?.on('data',chunk=>{if(stderr.length<8000)stderr+=String(chunk).slice(0,8000-stderr.length);});
  return new Promise<void>((resolve,reject)=>{
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve():reject(new Error(`Command failed with exit ${code??'unknown'}: ${stderr.trim().slice(0,1000)}`)));
  });
}
async function dumpDatabase(){
  const child=spawn('docker',['compose','exec','-T','db','pg_dump','--username','postgres','--dbname',sourceDatabase,'--format','custom'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  if(!child.stdout)throw new Error('pg_dump stdout is unavailable.');
  await Promise.all([pipeline(child.stdout,createWriteStream(dumpPath,{mode:0o600})),processExit(child)]);
}
async function restoreDump(){
  const child=spawn('docker',['compose','exec','-T','db','pg_restore','--username','postgres','--dbname',restoreDatabase,'--exit-on-error'],{cwd:process.cwd(),stdio:['pipe','ignore','pipe']});
  if(!child.stdin)throw new Error('pg_restore stdin is unavailable.');
  await Promise.all([pipeline(createReadStream(dumpPath),child.stdin),processExit(child)]);
}

type Manifest={migrationDigest:string;tableCounts:Record<string,number>;rlsDigest:string;evidenceCount:number;evidenceDigest:string;corruptEvidence:number};
async function manifest(connectionString:string):Promise<Manifest>{
  const db=new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
  try{
    const migrations=(await db.query<{name:string;checksum:string}>('SELECT name,checksum FROM public.schema_migrations ORDER BY name')).rows;
    const tableCounts:Record<string,number>={};
    for(const table of stableTables){
      const [schema,name]=table.split('.');
      const result=await db.query<{count:number}>(`SELECT count(*)::int AS count FROM ${identifier(schema)}.${identifier(name)}`);
      tableCounts[table]=result.rows[0]?.count??-1;
    }
    const rls=(await db.query<{schema_name:string;table_name:string;enabled:boolean;forced:boolean}>(`SELECT n.nspname AS schema_name,c.relname AS table_name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='app' AND c.relkind='r' ORDER BY c.relname`)).rows;
    const evidence=(await db.query<{tenant_id:string;shop_id:string;id:string;source_hash:string;byte_size:number;storage_backend:string;retention_class:string;lifecycle_status:string;content:Buffer}>(`SELECT tenant_id,shop_id,id,source_hash,byte_size,storage_backend,retention_class,lifecycle_status,content FROM app.evidence_objects ORDER BY tenant_id,shop_id,id`)).rows;
    let corruptEvidence=0;
    const evidenceProjection=evidence.map(row=>{
      const actualHash=createHash('sha256').update(row.content).digest('hex');
      if(actualHash!==row.source_hash||row.content.byteLength!==row.byte_size)corruptEvidence++;
      return [row.tenant_id,row.shop_id,row.id,row.source_hash,row.byte_size,row.storage_backend,row.retention_class,row.lifecycle_status];
    });
    return {migrationDigest:digest(migrations),tableCounts,rlsDigest:digest(rls),evidenceCount:evidence.length,evidenceDigest:digest(evidenceProjection),corruptEvidence};
  }finally{await db.end();}
}

async function runtimeRoleCheck(url:string,expectedRole:string,requiredSchema:string,requiredTable:string){
  const db=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000});
  try{
    const row=(await db.query<{role_name:string;superuser:boolean;bypass_rls:boolean;schema_usage:boolean;table_select:boolean}>(`SELECT current_user AS role_name,r.rolsuper AS superuser,r.rolbypassrls AS bypass_rls,
      has_schema_privilege(current_user,$1,'USAGE') AS schema_usage,has_table_privilege(current_user,$2,'SELECT') AS table_select
      FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`,[requiredSchema,requiredTable])).rows[0];
    return row?.role_name===expectedRole&&!row.superuser&&!row.bypass_rls&&row.schema_usage&&row.table_select;
  }finally{await db.end();}
}

const startedAt=new Date(),started=performance.now();
let report:Record<string,unknown>|null=null;
try{
  const sourceManifest=await manifest(sourceAdmin.toString());
  const dumpStarted=performance.now();await dumpDatabase();const dumpMs=Math.round(performance.now()-dumpStarted);
  const dumpBytes=(await stat(dumpPath)).size;
  await maintenance.query(`CREATE DATABASE ${identifier(restoreDatabase)}`);databaseCreated=true;
  const restoreStarted=performance.now();await restoreDump();const restoreMs=Math.round(performance.now()-restoreStarted);
  const verifyStarted=performance.now();
  const restoredManifest=await manifest(restoredAdminUrl.toString());
  const roles={
    application:await runtimeRoleCheck(databaseUrl(process.env.DATABASE_URL!),'commerce_app','app','app.tenants'),
    identity:await runtimeRoleCheck(databaseUrl(process.env.IDENTITY_DATABASE_URL!),'commerce_identity','private','private.users'),
    queue:await runtimeRoleCheck(databaseUrl(process.env.QUEUE_DATABASE_URL!),'commerce_queue','jobs','jobs.job'),
  };
  const verifyMs=Math.round(performance.now()-verifyStarted);
  const manifestMatch=digest(sourceManifest)===digest(restoredManifest);
  const passed=manifestMatch&&restoredManifest.corruptEvidence===0&&Object.values(roles).every(Boolean);
  report={
    status:passed?'passed':'failed',startedAt:startedAt.toISOString(),completedAt:new Date().toISOString(),
    dumpBytes,dumpMs,restoreMs,verifyMs,observedRecoveryMs:restoreMs+verifyMs,
    source:{evidenceCount:sourceManifest.evidenceCount,tableCounts:sourceManifest.tableCounts},
    restored:{evidenceCount:restoredManifest.evidenceCount,corruptEvidence:restoredManifest.corruptEvidence,tableCounts:restoredManifest.tableCounts},
    checks:{manifestMatch,migrationsMatch:sourceManifest.migrationDigest===restoredManifest.migrationDigest,rlsMatch:sourceManifest.rlsDigest===restoredManifest.rlsDigest,runtimeRoles:roles},
    scope:'local rehearsal only',rpo:'not established',rto:'observed duration only; no production objective approved',totalMs:Math.round(performance.now()-started),
  };
  await mkdir(join(process.cwd(),'docs','evidence'),{recursive:true});
  await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
  console.log(JSON.stringify(report,null,2));
  if(!passed)process.exitCode=1;
}finally{
  try{
    if(databaseCreated)await maintenance.query(`DROP DATABASE IF EXISTS ${identifier(restoreDatabase)} WITH (FORCE)`);
  }finally{
    await maintenance.end().catch(()=>undefined);
    await unlink(dumpPath).catch(()=>undefined);
  }
  if(!report&&process.exitCode===undefined)process.exitCode=1;
}
