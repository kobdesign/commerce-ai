import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AppError, type Context, type Role } from '@commerce/contracts';

const globalDb=globalThis as unknown as {commercePool?:Pool;identityPool?:Pool};
export function pool(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run local setup.');
  return globalDb.commercePool ??=new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000});
}
export function identityPool(){
  if(!['local-demo','staging-demo'].includes(process.env.APP_MODE??'')) throw new Error('Demo identity is disabled. Configure an audited production identity adapter before deploying.');
  if(!process.env.IDENTITY_DATABASE_URL) throw new Error('IDENTITY_DATABASE_URL is required.');
  return globalDb.identityPool ??=new Pool({connectionString:process.env.IDENTITY_DATABASE_URL,max:3,connectionTimeoutMillis:5000});
}
export type Tx={client:PoolClient;orm:NodePgDatabase;query:<T extends QueryResultRow=QueryResultRow>(sql:string,params?:unknown[])=>Promise<T[]>};
export async function withActor<T>(userId:string,tenantId:string|null,fn:(tx:Tx)=>Promise<T>):Promise<T>{
  const client=await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.actor_id',$1,true),set_config('app.tenant_id',$2,true)",[userId,tenantId??'']);
    await client.query("SET LOCAL statement_timeout='8s'");
    const tx:Tx={client,orm:drizzle(client),query:async <R extends QueryResultRow>(sql:string,params?:unknown[]) => (await client.query<R>(sql,params)).rows};
    const value=await fn(tx);
    await client.query('COMMIT');return value;
  } catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export async function resolveContext(userId:string,tenantId:string):Promise<Context>{
  return withActor(userId,tenantId,async tx=>{
    const rows=await tx.query<{role:Role|null}>('SELECT app.member_role($1) AS role',[tenantId]);
    if(!rows[0]?.role) throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เข้าถึงบริษัทนี้');
    return {userId,tenantId,role:rows[0].role};
  });
}
export async function withTenant<T>(ctx:Context,fn:(tx:Tx,role:Role)=>Promise<T>):Promise<T>{
  return withActor(ctx.userId,ctx.tenantId,async tx=>{
    const [{role}]=await tx.query<{role:Role|null}>('SELECT app.member_role($1) AS role',[ctx.tenantId]);
    if(!role) throw new AppError(403,'FORBIDDEN','สิทธิ์ของคุณถูกเปลี่ยน กรุณาเลือกบริษัทใหม่');
    return fn(tx,role);
  });
}
export async function closePools(){await Promise.all([globalDb.commercePool?.end(),globalDb.identityPool?.end()]);delete globalDb.commercePool;delete globalDb.identityPool;}
