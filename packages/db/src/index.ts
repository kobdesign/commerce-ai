import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  agentRouteApprovalInput,
  agentRouteProposalInput,
  agentRouteRevocationInput,
  AppError,
  platformAgentRouteActivationInput,
  platformAgentRouteRevocationInput,
  type AgentRouteEnvironment,
  type Context,
  type Role,
} from '@commerce/contracts';

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
export type ServiceHeartbeatStatus={available:boolean;lastSeenAt:Date|null};
export async function touchServiceHeartbeat(service:'worker',instanceId:string){
  await pool().query('SELECT app.touch_service_heartbeat($1,$2)',[service,instanceId]);
}
export async function stopServiceHeartbeat(service:'worker',instanceId:string){
  await pool().query('SELECT app.stop_service_heartbeat($1,$2)',[service,instanceId]);
}
export async function serviceHeartbeatStatus(service:'worker'):Promise<ServiceHeartbeatStatus>{
  const row=(await pool().query<{available:boolean;last_seen_at:Date|null}>('SELECT available,last_seen_at FROM app.service_heartbeat_status($1)',[service])).rows[0];
  return {available:row?.available===true,lastSeenAt:row?.last_seen_at??null};
}
export async function importQueueReady(){
  const row=(await pool().query<{ready:boolean}>('SELECT app.import_queue_ready() AS ready')).rows[0];
  return row?.ready===true;
}
export async function outboxQueueReady(){
  const row=(await pool().query<{ready:boolean}>('SELECT app.outbox_queue_ready() AS ready')).rows[0];
  return row?.ready===true;
}
export const operationalControlNames=['web_mutations','import_commits'] as const;
export type OperationalControlName=typeof operationalControlNames[number];
export async function operationalControlEnabled(control:OperationalControlName){
  const row=(await pool().query<{enabled:boolean}>('SELECT app.operational_control_enabled($1) AS enabled',[control])).rows[0];
  return row?.enabled===true;
}
export async function assertOperationalControl(control:OperationalControlName){
  if(!await operationalControlEnabled(control))throw new AppError(503,'OPERATION_PAUSED','ระบบหยุดรับการเปลี่ยนแปลงชั่วคราว กรุณาลองใหม่ภายหลัง');
}
export type AgentServiceAuthorizationInput={
  credentialHash:string;shopIds:string[];requiredScope:'catalog:read'|'sales:read'|'inventory:read';
  environment:'development'|'staging'|'production';audience:'commerce-agent-api';requestId:string;requestTimestamp:string;
  method:'POST';path:string;bodyHash:string;requestHash:string;
};
export type AgentServiceAuthorization={
  tenantId:string;principalId:string;shopIds:string[];scopes:Array<'catalog:read'|'sales:read'|'inventory:read'>;
  environment:'development'|'staging'|'production';audience:'commerce-agent-api';authenticatedAt:Date;expiresAt:Date;replayed:boolean;
};
export async function authorizeAgentServiceRequest(input:AgentServiceAuthorizationInput):Promise<AgentServiceAuthorization>{
  const result=await pool().query<AgentServiceAuthorization>(`SELECT tenant_id AS "tenantId",principal_id AS "principalId",shop_ids AS "shopIds",scopes,
    environment,audience,authenticated_at AS "authenticatedAt",expires_at AS "expiresAt",replayed
    FROM app.authorize_agent_service_request($1,$2::uuid[],$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[
    input.credentialHash,input.shopIds,input.requiredScope,input.environment,input.audience,input.requestId,input.requestTimestamp,
    input.method,input.path,input.bodyHash,input.requestHash,
  ]);
  if(!result.rows[0])throw new Error('AGENT_AUTHORIZATION_EMPTY');
  return result.rows[0];
}
export type AgentServiceResultInput={tenantId:string;requestId:string;principalId:string;operation:'products.query'|'sales.query'|'inventory.query';bodyHash:string};
export async function readAgentServiceRequestResult(input:AgentServiceResultInput){
  const result=await pool().query<{payload:unknown|null}>(
    'SELECT app.read_agent_service_request_result($1,$2,$3,$4,$5) AS payload',
    [input.tenantId,input.requestId,input.principalId,input.operation,input.bodyHash],
  );
  return result.rows[0]?.payload??null;
}
export async function storeAgentServiceRequestResult(input:AgentServiceResultInput&{payload:unknown}){
  const result=await pool().query<{payload:unknown}>(
    'SELECT app.store_agent_service_request_result($1,$2,$3,$4,$5,$6::jsonb) AS payload',
    [input.tenantId,input.requestId,input.principalId,input.operation,input.bodyHash,JSON.stringify(input.payload)],
  );
  if(!result.rows[0])throw new Error('AGENT_RESULT_EMPTY');
  return result.rows[0].payload;
}
export type AgentSessionReadAuthorizationInput={
  tenantId:string;grantId:string;subject:string;claimShopIds:string[];role:Role;environment:'development'|'staging';
  issuedAt:number;expiresAt:number;sessionId:string;shopIds:string[];requiredScope:'catalog:read'|'sales:read'|'inventory:read';
  requestId:string;requestTimestamp:string;method:'POST';path:string;bodyHash:string;
};
export async function authorizeAgentSessionReadRequest(input:AgentSessionReadAuthorizationInput):Promise<AgentServiceAuthorization>{
  const result=await pool().query<AgentServiceAuthorization>(`SELECT tenant_id AS "tenantId",principal_id AS "principalId",shop_ids AS "shopIds",scopes,
    environment,audience,authenticated_at AS "authenticatedAt",expires_at AS "expiresAt",replayed
    FROM app.authorize_agent_session_read_request($1,$2,$3,$4::uuid[],$5,$6,to_timestamp($7),to_timestamp($8),$9,$10::uuid[],$11,$12,$13,$14,$15,$16)`,[
    input.tenantId,input.grantId,input.subject,input.claimShopIds,input.role,input.environment,input.issuedAt,input.expiresAt,input.sessionId,
    input.shopIds,input.requiredScope,input.requestId,input.requestTimestamp,input.method,input.path,input.bodyHash,
  ]);
  if(!result.rows[0])throw new Error('AGENT_SESSION_READ_UNAVAILABLE');
  return result.rows[0];
}
export type AgentSessionResultInput={tenantId:string;requestId:string;subjectId:string;operation:'products.query'|'sales.query'|'inventory.query';bodyHash:string};
export async function readAgentSessionRequestResult(input:AgentSessionResultInput){
  const result=await pool().query<{payload:unknown|null}>(
    'SELECT app.read_agent_session_request_result($1,$2,$3,$4,$5) AS payload',
    [input.tenantId,input.requestId,input.subjectId,input.operation,input.bodyHash],
  );
  return result.rows[0]?.payload??null;
}
export async function storeAgentSessionRequestResult(input:AgentSessionResultInput&{payload:unknown}){
  const result=await pool().query<{payload:unknown}>(
    'SELECT app.store_agent_session_request_result($1,$2,$3,$4,$5,$6::jsonb) AS payload',
    [input.tenantId,input.requestId,input.subjectId,input.operation,input.bodyHash,JSON.stringify(input.payload)],
  );
  if(!result.rows[0])throw new Error('AGENT_RESULT_EMPTY');
  return result.rows[0].payload;
}
type AgentReadBaseInput={tenantId:string;requestId:string;shopIds:string[];limit:number;offset:number};
export type AgentProductReadInput=AgentReadBaseInput&{search:string;category?:string;status:'active'|'archived'|'all';variantIds?:string[]};
export type AgentSalesReadInput=AgentReadBaseInput&{from:string;to:string;variantIds?:string[];granularity:'variant'|'variant_channel'|'variant_day';orderStates:Array<'open'|'completed'|'cancelled'>};
export type AgentInventoryReadInput=AgentReadBaseInput&{search:string;variantIds?:string[];availability:'all'|'available'|'low'|'out'|'reserved';includeChannelAllocation:boolean};

async function readAgentPayload(sql:string,params:unknown[]){
  const result=await pool().query<{payload:unknown}>(sql,params);
  if(!result.rows[0])throw new Error('AGENT_READ_EMPTY');
  return result.rows[0].payload;
}
export function readAgentProducts(input:AgentProductReadInput){
  return readAgentPayload('SELECT app.read_agent_products($1,$2,$3::uuid[],$4,$5,$6,$7::uuid[],$8,$9) AS payload',[
    input.tenantId,input.requestId,input.shopIds,input.search,input.category??null,input.status,input.variantIds??null,input.limit,input.offset,
  ]);
}
export function readAgentSales(input:AgentSalesReadInput){
  return readAgentPayload('SELECT app.read_agent_sales($1,$2,$3::uuid[],$4::date,$5::date,$6::uuid[],$7,$8::text[],$9,$10) AS payload',[
    input.tenantId,input.requestId,input.shopIds,input.from,input.to,input.variantIds??null,input.granularity,input.orderStates,input.limit,input.offset,
  ]);
}
export function readAgentInventory(input:AgentInventoryReadInput){
  return readAgentPayload('SELECT app.read_agent_inventory($1,$2,$3::uuid[],$4,$5::uuid[],$6,$7,$8,$9) AS payload',[
    input.tenantId,input.requestId,input.shopIds,input.search,input.variantIds??null,input.availability,input.includeChannelAllocation,input.limit,input.offset,
  ]);
}

export type AgentSessionGrantClaims={
  tenantId:string;grantId:string;subject:string;shopIds:string[];
  role:Role;environment:'development'|'staging';issuedAt:number;expiresAt:number;
  capability:'create'|'continue';sessionId:string|null;
};
export async function consumeAgentSessionGrant(claims:AgentSessionGrantClaims){
  if(claims.capability==='create'){
    const result=await pool().query<{grantId:string;consumedAt:Date}>(
      `SELECT grant_id AS "grantId",consumed_at AS "consumedAt"
       FROM app.consume_agent_session_grant($1,$2,$3,$4::uuid[],$5,$6,to_timestamp($7),to_timestamp($8))`,
      [claims.tenantId,claims.grantId,claims.subject,claims.shopIds,claims.role,claims.environment,claims.issuedAt,claims.expiresAt],
    );
    if(!result.rows[0])throw new Error('AGENT_SESSION_GRANT_UNAVAILABLE');
    return result.rows[0];
  }
  const result=await pool().query<{grantId:string;consumedAt:Date}>(
    `SELECT grant_id AS "grantId",consumed_at AS "consumedAt"
     FROM app.consume_agent_session_grant_v2($1,$2,$3,$4::uuid[],$5,$6,to_timestamp($7),to_timestamp($8),$9,$10)`,
    [claims.tenantId,claims.grantId,claims.subject,claims.shopIds,claims.role,claims.environment,
      claims.issuedAt,claims.expiresAt,claims.capability,claims.sessionId],
  );
  if(!result.rows[0])throw new Error('AGENT_SESSION_GRANT_UNAVAILABLE');
  return result.rows[0];
}

export type AgentSessionContinuation={sessionId:string;shopIds:string[];role:Role;policyVersion:number|null;expiresAt:Date};
export async function readAgentSessionForContinuation(ctx:Context,sessionId:string,environment:'development'|'staging'){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<AgentSessionContinuation>(
      `SELECT session_id AS "sessionId",shop_ids AS "shopIds",role,policy_version AS "policyVersion",expires_at AS "expiresAt"
       FROM app.read_agent_session_for_continuation($1,$2)`,[sessionId,environment],
    );
    if(!rows[0])throw new Error('AGENT_SESSION_UNAVAILABLE');
    return rows[0];
  });
}

export async function bindAgentSession(ctx:Context,input:{grantId:string;sessionId:string;expiresAt:Date}){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<{sessionId:string;expiresAt:Date}>(
      `SELECT session_id AS "sessionId",expires_at AS "expiresAt" FROM app.bind_agent_session($1,$2,$3)`,
      [input.grantId,input.sessionId,input.expiresAt],
    );
    if(!rows[0])throw new Error('AGENT_SESSION_BIND_UNAVAILABLE');
    return rows[0];
  });
}

export async function abandonAgentSession(ctx:Context,input:{grantId:string;sessionId:string;reason:string}){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<{sessionId:string;status:'abandoned'}>(
      `SELECT session_id AS "sessionId",status FROM app.abandon_agent_session($1,$2,$3)`,
      [input.grantId,input.sessionId,input.reason],
    );
    if(!rows[0])throw new Error('AGENT_SESSION_ABANDON_UNAVAILABLE');
    return rows[0];
  });
}

export async function endAgentSession(ctx:Context,sessionId:string,reason:string){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<{sessionId:string;status:'ended'}>(
      `SELECT session_id AS "sessionId",status FROM app.end_agent_session($1,$2)`,[sessionId,reason],
    );
    if(!rows[0])throw new Error('AGENT_SESSION_END_UNAVAILABLE');
    return rows[0];
  });
}

export type AgentSessionReconciliationStatus='pending'|'receipt_received'|'succeeded'|'failed';
export async function createAgentSessionEndIntent(ctx:Context,input:{
  id:string;sessionId:string;grantId:string;idempotencyKey:string;reason:string;
}){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<{intentId:string;status:AgentSessionReconciliationStatus}>(
      `SELECT intent_id AS "intentId",status
       FROM app.create_agent_session_end_intent($1,$2,$3,$4,$5)`,
      [input.id,input.sessionId,input.grantId,input.idempotencyKey,input.reason],
    );
    if(!rows[0])throw new Error('AGENT_SESSION_INTENT_UNAVAILABLE');
    return rows[0];
  });
}

export async function recordAgentSessionEveReceipt(ctx:Context,intentId:string,deliveryId:string){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<{intentId:string;status:AgentSessionReconciliationStatus}>(
      `SELECT intent_id AS "intentId",status FROM app.record_agent_session_eve_receipt($1,$2)`,
      [intentId,deliveryId],
    );
    if(!rows[0])throw new Error('AGENT_SESSION_RECEIPT_UNAVAILABLE');
    return rows[0];
  });
}

export type AgentSessionReconciliationMetrics={
  pendingEnd:number;pendingRevokeCleanup:number;failed:number;oldestPendingSeconds:number;
};
export async function readAgentSessionReconciliationMetrics(ctx:Context){
  return withTenant(ctx,async tx=>{
    const rows=await tx.query<AgentSessionReconciliationMetrics>(
      `SELECT pending_end::integer AS "pendingEnd",pending_revoke_cleanup::integer AS "pendingRevokeCleanup",
        failed::integer,oldest_pending_seconds::integer AS "oldestPendingSeconds"
       FROM app.agent_session_reconciliation_metrics()`,
    );
    if(!rows[0])throw new Error('AGENT_SESSION_RECONCILIATION_METRICS_UNAVAILABLE');
    return rows[0];
  });
}

export async function revokeAgentSession(ctx:Context,sessionId:string,reason:string){
  return withTenant(ctx,async tx=>{
    await tx.query('SELECT app.revoke_agent_session($1,$2)',[sessionId,reason]);
    return {sessionId,status:'revoked' as const};
  });
}

export async function revokeAgentSessionGrant(ctx:Context,grantId:string,reason:string){
  return withTenant(ctx,async tx=>{
    await tx.query('SELECT app.revoke_agent_session_grant($1,$2)',[grantId,reason]);
    return {grantId,status:'revoked' as const};
  });
}

export const agentSessionGrantMetricNames=['issued','consumed','replay','revoked','expired','rate_limited','abandoned'] as const;
export type AgentSessionGrantMetricName=typeof agentSessionGrantMetricNames[number];
export async function readAgentSessionGrantMetrics(ctx:Context,windowMinutes:number){
  if(!Number.isInteger(windowMinutes)||windowMinutes<1||windowMinutes>10_080)throw new AppError(400,'INVALID_WINDOW','ช่วงเวลาต้องอยู่ระหว่าง 1 นาทีถึง 7 วัน');
  return withTenant(ctx,async tx=>tx.query<{eventType:AgentSessionGrantMetricName;eventCount:number}>(
    `SELECT event_type AS "eventType",event_count::integer AS "eventCount" FROM app.agent_session_grant_metrics($1)`,[windowMinutes],
  ));
}

export type AgentRoutePolicyRecord={
  id:string;tenantId:string;engine:'eve';environment:AgentRouteEnvironment;dataScope:'synthetic';
  status:'pending'|'active'|'revoked';version:number;requestedBy:string;requestedAt:Date;
  approvedBy:string|null;approvedAt:Date|null;expiresAt:Date;revokedBy:string|null;revokedAt:Date|null;
  reason:string;createdAt:Date;updatedAt:Date;
};
export type AgentRoutePolicyEvent={
  id:string;policyId:string;policyVersion:number;actorId:string;actorRole:'owner'|'auditor'|'platform_owner';
  action:'proposed'|'approved'|'activated'|'revoked';reason:string;snapshot:Record<string,unknown>;createdAt:Date;
};

export type PlatformAgentTenantRecord={
  tenantId:string;tenantName:string;shopCount:number;policyId:string|null;environment:AgentRouteEnvironment|null;
  dataScope:'synthetic'|null;status:'pending'|'active'|'revoked'|null;version:number|null;expiresAt:Date|null;
  reason:string|null;updatedAt:Date|null;eventCount:number;lastAction:'proposed'|'approved'|'activated'|'revoked'|null;lastEventAt:Date|null;
};

const routePolicySelect=`id,tenant_id AS "tenantId",engine,environment,data_scope AS "dataScope",status,version,
  requested_by AS "requestedBy",requested_at AS "requestedAt",approved_by AS "approvedBy",approved_at AS "approvedAt",
  expires_at AS "expiresAt",revoked_by AS "revokedBy",revoked_at AS "revokedAt",reason,
  created_at AS "createdAt",updated_at AS "updatedAt"`;

function currentAgentRouteEnvironment():AgentRouteEnvironment{
  if(process.env.AI_ENABLED!=='false')throw new AppError(503,'AGENT_ROUTE_CONTROL_DISABLED','Dynamic routing control requires AI_ENABLED=false.');
  if(process.env.APP_MODE==='local-demo')return 'development';
  if(process.env.APP_MODE==='staging-demo')return 'staging';
  throw new AppError(503,'AGENT_ROUTE_CONTROL_DISABLED','Dynamic routing control is available only for synthetic local or staging evaluation.');
}

function mapAgentRouteError(error:unknown):never{
  if(error instanceof AppError)throw error;
  const message=error instanceof Error?error.message:'';
  if(message.includes('AGENT_ROUTE_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เปลี่ยนเส้นทาง AI');
  if(message.includes('AGENT_ROUTE_STALE'))throw new AppError(409,'STALE_AGENT_ROUTE_POLICY','นโยบายถูกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
  if(message.includes('AGENT_ROUTE_ACTIVE'))throw new AppError(409,'AGENT_ROUTE_POLICY_ACTIVE','ต้องเพิกถอนนโยบายที่ใช้งานอยู่ก่อนสร้างคำขอใหม่');
  if(message.includes('AGENT_ROUTE_NOT_APPROVABLE'))throw new AppError(409,'AGENT_ROUTE_NOT_APPROVABLE','คำขอนี้อนุมัติไม่ได้หรือใกล้หมดอายุ');
  if(message.includes('AGENT_ROUTE_ALREADY_REVOKED'))throw new AppError(409,'AGENT_ROUTE_ALREADY_REVOKED','นโยบายนี้ถูกเพิกถอนแล้ว');
  if(message.includes('AGENT_ROUTE_INVALID'))throw new AppError(400,'INVALID_AGENT_ROUTE_POLICY','ข้อมูลนโยบายเส้นทาง AI ไม่ถูกต้อง');
  throw error;
}

function mapPlatformAgentRouteError(error:unknown):never{
  const message=error instanceof Error?error.message:'';
  if(message.includes('PLATFORM_OWNER_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','เฉพาะผู้ดูแลแพลตฟอร์มที่จัดการการเปิดใช้ AI รายบริษัทได้');
  mapAgentRouteError(error);
}

export async function isPlatformOwner(userId:string){
  return withActor(userId,null,async tx=>(await tx.query<{allowed:boolean}>('SELECT app.is_platform_owner() AS allowed'))[0]?.allowed===true);
}

export async function platformAgentControlWorkspace(userId:string){
  try{return await withActor(userId,null,async tx=>({
    canManage:true as const,
    tenants:await tx.query<PlatformAgentTenantRecord>(`SELECT tenant_id AS "tenantId",tenant_name AS "tenantName",
      shop_count::integer AS "shopCount",policy_id AS "policyId",environment,data_scope AS "dataScope",status,version,
      expires_at AS "expiresAt",reason,updated_at AS "updatedAt",event_count::integer AS "eventCount",
      last_action AS "lastAction",last_event_at AS "lastEventAt" FROM app.platform_agent_route_workspace()`),
  }));}catch(error){mapPlatformAgentRouteError(error);}
}

export async function activatePlatformAgentRoute(userId:string,input:unknown){
  const parsed=platformAgentRouteActivationInput.parse(input),environment=currentAgentRouteEnvironment();
  if(parsed.environment!==environment)throw new AppError(400,'AGENT_ROUTE_ENVIRONMENT_MISMATCH','นโยบายต้องใช้ environment เดียวกับ Commerce Core');
  try{return await withActor(userId,null,async tx=>(await tx.query<AgentRoutePolicyRecord>(
    `SELECT ${routePolicySelect} FROM app.platform_activate_agent_route_policy($1,$2,$3,$4,$5)`,
    [parsed.tenantId,parsed.version,parsed.environment,parsed.expiresAt,parsed.reason],
  ))[0]);}catch(error){mapPlatformAgentRouteError(error);}
}

export async function revokePlatformAgentRoute(userId:string,input:unknown){
  const parsed=platformAgentRouteRevocationInput.parse(input);currentAgentRouteEnvironment();
  try{return await withActor(userId,null,async tx=>(await tx.query<AgentRoutePolicyRecord>(
    `SELECT ${routePolicySelect} FROM app.platform_revoke_agent_route_policy($1,$2,$3)`,
    [parsed.tenantId,parsed.version,parsed.reason],
  ))[0]);}catch(error){mapPlatformAgentRouteError(error);}
}

export async function agentRouteRuntimePolicy(ctx:Context){
  return withTenant(ctx,async tx=>(await tx.query<{
    status:'pending'|'active'|'revoked';environment:AgentRouteEnvironment;expiresAt:Date;version:number;
  }>(`SELECT status,environment,expires_at AS "expiresAt",version FROM app.agent_route_policies WHERE tenant_id=$1`,[ctx.tenantId]))[0]??null);
}

export async function agentRouteControlWorkspace(ctx:Context){
  currentAgentRouteEnvironment();
  if(!['owner','auditor'].includes(ctx.role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของและผู้ตรวจสอบที่ดูประวัติเส้นทาง AI ได้');
  return withTenant(ctx,async tx=>{
    const policies=await tx.query<AgentRoutePolicyRecord>(`SELECT ${routePolicySelect} FROM app.agent_route_policies WHERE tenant_id=$1`,[ctx.tenantId]);
    const events=await tx.query<AgentRoutePolicyEvent>(`SELECT id,policy_id AS "policyId",policy_version AS "policyVersion",actor_id AS "actorId",
      actor_role AS "actorRole",action,reason,snapshot,created_at AS "createdAt"
      FROM app.agent_route_policy_events WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[ctx.tenantId]);
    return {policy:policies[0]??null,events,canPropose:ctx.role==='owner',canApprove:ctx.role==='auditor',canRevoke:true,planningOnly:true as const};
  });
}

export async function proposeAgentRoutePolicy(ctx:Context,input:unknown){
  const parsed=agentRouteProposalInput.parse(input),environment=currentAgentRouteEnvironment();
  if(parsed.environment!==environment)throw new AppError(400,'AGENT_ROUTE_ENVIRONMENT_MISMATCH','นโยบายต้องใช้ environment เดียวกับ Commerce Core');
  try{return await withTenant(ctx,async tx=>(await tx.query<AgentRoutePolicyRecord>(
    `SELECT ${routePolicySelect} FROM app.propose_agent_route_policy($1,$2,$3,$4)`,
    [parsed.version,parsed.environment,parsed.expiresAt,parsed.reason],
  ))[0]);}catch(error){mapAgentRouteError(error);}
}

export async function approveAgentRoutePolicy(ctx:Context,input:unknown){
  const parsed=agentRouteApprovalInput.parse(input);currentAgentRouteEnvironment();
  try{return await withTenant(ctx,async tx=>(await tx.query<AgentRoutePolicyRecord>(
    `SELECT ${routePolicySelect} FROM app.approve_agent_route_policy($1,$2)`,[parsed.version,parsed.reason],
  ))[0]);}catch(error){mapAgentRouteError(error);}
}

export async function revokeAgentRoutePolicy(ctx:Context,input:unknown){
  const parsed=agentRouteRevocationInput.parse(input);currentAgentRouteEnvironment();
  try{return await withTenant(ctx,async tx=>{
    const policy=(await tx.query<AgentRoutePolicyRecord>(
      `SELECT ${routePolicySelect} FROM app.revoke_agent_route_policy($1,$2)`,[parsed.version,parsed.reason],
    ))[0];
    await tx.query('SELECT app.revoke_active_agent_session_grants($1)',[parsed.reason]);
    await tx.query('SELECT app.revoke_active_agent_sessions($1)',[parsed.reason]);
    return policy;
  });}catch(error){mapAgentRouteError(error);}
}
export async function closePools(){await Promise.all([globalDb.commercePool?.end(),globalDb.identityPool?.end()]);delete globalDb.commercePool;delete globalDb.identityPool;}
