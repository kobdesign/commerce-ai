import { createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError,integrationInboxActionInput,servicePrincipalInput,servicePrincipalRevokeInput,servicePrincipalRotationInput,servicePrincipalEnvironments,uuid,type Context,type ServicePrincipalEnvironment,type ServicePrincipalScope } from '@commerce/contracts';
import { withTenant } from '@commerce/db';

const consumerRow=z.object({consumerName:z.string().min(3).max(100)});
const deliveryRow=z.object({
  tenantId:z.string().uuid(),eventId:z.string().uuid(),eventType:z.string(),aggregateType:z.string(),aggregateId:z.string().uuid(),
  aggregateVersion:z.number().int().positive(),payload:z.record(z.string(),z.unknown()),occurredAt:z.date(),attemptCount:z.number().int().positive(),
});
export type OutboxDelivery=z.infer<typeof deliveryRow>;

export async function activeOutboxConsumers(connection:Pool){
  const result=await connection.query('SELECT consumer_name AS "consumerName" FROM app.active_outbox_consumers()');
  return z.array(consumerRow).parse(result.rows).map(row=>row.consumerName);
}

export async function claimOutboxDeliveries(connection:Pool,consumerName:string,workerName:string,batchSize=20,leaseSeconds=60):Promise<OutboxDelivery[]>{
  const result=await connection.query(`SELECT tenant_id AS "tenantId",event_id AS "eventId",event_type AS "eventType",aggregate_type AS "aggregateType",
    aggregate_id AS "aggregateId",aggregate_version AS "aggregateVersion",payload,occurred_at AS "occurredAt",attempt_count AS "attemptCount"
    FROM app.claim_outbox_deliveries($1,$2,$3,$4)`,[consumerName,workerName,batchSize,leaseSeconds]);
  return z.array(deliveryRow).parse(result.rows);
}

export async function recordOutboxReceipt(connection:Pool,delivery:OutboxDelivery,consumerName:string,workerName:string){
  const result=await connection.query<{duplicate:boolean}>('SELECT app.record_outbox_receipt($1,$2,$3,$4) AS duplicate',[delivery.tenantId,delivery.eventId,consumerName,workerName]);
  return result.rows[0]?.duplicate===true;
}

export async function completeOutboxDelivery(connection:Pool,delivery:OutboxDelivery,consumerName:string,workerName:string){
  const result=await connection.query<{completed:boolean}>('SELECT app.complete_outbox_delivery($1,$2,$3,$4) AS completed',[delivery.tenantId,delivery.eventId,consumerName,workerName]);
  return result.rows[0]?.completed===true;
}

export async function failOutboxDelivery(connection:Pool,delivery:OutboxDelivery,consumerName:string,workerName:string,errorCode='CONSUMER_FAILED'){
  const result=await connection.query<{status:'pending'|'dead_letter'}>('SELECT app.fail_outbox_delivery($1,$2,$3,$4,$5) AS status',[delivery.tenantId,delivery.eventId,consumerName,workerName,errorCode]);
  return result.rows[0]?.status;
}

export async function consumeInternalOutboxDelivery(connection:Pool,delivery:OutboxDelivery,consumerName:string,workerName:string){
  if(consumerName!=='internal.operations.v1')throw new Error('OUTBOX_CONSUMER_NOT_REGISTERED');
  const duplicate=await recordOutboxReceipt(connection,delivery,consumerName,workerName);
  if(!await completeOutboxDelivery(connection,delivery,consumerName,workerName))throw new Error('OUTBOX_LEASE_LOST');
  return {duplicate};
}

const incomingSafeMetadataSchema=z.object({
  adapterVersion:z.string().min(1).max(80),
  providerApiVersion:z.string().min(1).max(80).optional(),
  deliveryAttempt:z.number().int().positive().max(1000).optional(),
  contentType:z.literal('application/json').optional(),
}).strict();

const incomingEventSchema=z.object({
  tenantId:z.string().uuid(),
  shopId:z.string().uuid(),
  providerNamespace:z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
  providerEventId:z.string().trim().min(1).max(160),
  eventType:z.string().regex(/^[a-z][a-z0-9._-]{2,119}$/),
  streamType:z.string().regex(/^[a-z][a-z0-9._-]{2,59}$/),
  streamId:z.string().trim().min(1).max(160),
  sequenceNumber:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  occurredAt:z.iso.datetime({offset:true}),
  rawBody:z.string().min(2),
  signature:z.string().min(1).max(256),
  verificationSecret:z.string().min(32).max(512),
  serviceCredential:z.string().min(32).max(512),
  serviceEnvironment:z.enum(servicePrincipalEnvironments).default('development'),
  serviceAudience:z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/).default('integration-inbox'),
  verificationMethod:z.literal('hmac-sha256-v1'),
  verificationKeyReference:z.string().min(1).max(120).optional(),
  metadata:incomingSafeMetadataSchema,
}).strict();

const incomingResultRow=z.object({
  id:z.string().uuid(),
  duplicate:z.boolean(),
  reconciliationStatus:z.enum(['ready','needs_review','rejected']),
  disposition:z.enum(['accepted','recovered_gap','gap','stale','unordered','invalid_signature']),
  version:z.number().int().positive(),
});
export type IncomingEventInput=z.input<typeof incomingEventSchema>;
export type IncomingEventResult=z.infer<typeof incomingResultRow>;

const maximumIncomingBodyBytes=65_536;
function normalizedSignature(value:string){
  const normalized=value.trim().toLowerCase();
  return normalized.startsWith('sha256=')?normalized.slice(7):normalized;
}

export function verifyIncomingHmacSha256(rawBody:string,signature:string,secret:string){
  const supplied=normalizedSignature(signature);
  if(!/^[0-9a-f]{64}$/.test(supplied))return false;
  const expected=createHmac('sha256',secret).update(rawBody,'utf8').digest();
  const received=Buffer.from(supplied,'hex');
  return received.length===expected.length&&timingSafeEqual(received,expected);
}

export async function ingestIncomingEvent(connection:Pool,input:IncomingEventInput):Promise<IncomingEventResult>{
  const parsed=incomingEventSchema.parse(input);
  if(Buffer.byteLength(parsed.rawBody,'utf8')>maximumIncomingBodyBytes)throw new Error('INBOX_BODY_TOO_LARGE');
  let payload:unknown;
  try{payload=JSON.parse(parsed.rawBody);}catch{throw new Error('INBOX_BODY_INVALID_JSON');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('INBOX_BODY_INVALID_JSON_OBJECT');
  const signatureResult=verifyIncomingHmacSha256(parsed.rawBody,parsed.signature,parsed.verificationSecret)?'verified':'invalid';
  const result=await connection.query(`SELECT id,duplicate,reconciliation_status AS "reconciliationStatus",disposition,version
    FROM app.ingest_scoped_integration_inbox_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19)`,[
    createHash('sha256').update(parsed.serviceCredential,'utf8').digest('hex'),parsed.serviceEnvironment,parsed.serviceAudience,parsed.tenantId,parsed.shopId,randomUUID(),parsed.providerNamespace,
    parsed.providerEventId,parsed.eventType,parsed.streamType,parsed.streamId,parsed.sequenceNumber,parsed.occurredAt,
    createHash('sha256').update(parsed.rawBody,'utf8').digest('hex'),JSON.stringify(payload),JSON.stringify(parsed.metadata),
    signatureResult,parsed.verificationMethod,parsed.verificationKeyReference??null,
  ]);
  return incomingResultRow.parse(result.rows[0]);
}

export type ServicePrincipalShop={id:string;name:string};
export type ServiceCredentialSummary={id:string;prefix:string;status:'active'|'retiring'|'retired'|'expired'|'revoked';createdAt:string;expiresAt:string;retireAt:string|null;lastUsedAt:string|null;authorizedRequestCount:string};
type ServiceCredentialSummaryRow=Omit<ServiceCredentialSummary,'id'|'prefix'|'createdAt'|'expiresAt'|'retireAt'|'lastUsedAt'> & {principalId:string;credentialId:string;secretPrefix:string;createdAt:Date;expiresAt:Date;retireAt:Date|null;lastUsedAt:Date|null};
export type ServicePrincipal={id:string;name:string;status:'active'|'revoked';environment:ServicePrincipalEnvironment;audience:string;expiresAt:string;credentialPrefix:string;version:number;createdAt:string;revokedAt:string|null;revokeReason:string|null;shops:ServicePrincipalShop[];scopes:ServicePrincipalScope[];credentials:ServiceCredentialSummary[]};
type ServicePrincipalRow=Omit<ServicePrincipal,'expiresAt'|'createdAt'|'revokedAt'|'shops'|'scopes'|'credentials'>&{expiresAt:Date;createdAt:Date;revokedAt:Date|null};
export type ServicePrincipalWorkspace={principals:ServicePrincipal[];canManage:boolean};

export async function servicePrincipalWorkspace(ctx:Context):Promise<ServicePrincipalWorkspace>{
  return withTenant(ctx,async(tx,role)=>{
    if(!['owner','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดู Service Access');
    const principals=await tx.query<ServicePrincipalRow>(`SELECT p.id,p.name,p.status,p.environment,p.audience,p.expires_at AS "expiresAt",p.credential_prefix AS "credentialPrefix",
      p.version,p.created_at AS "createdAt",p.revoked_at AS "revokedAt",p.revoke_reason AS "revokeReason"
      FROM app.service_principals p WHERE p.tenant_id=$1 ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.created_at DESC`,[ctx.tenantId]);
    const delegations=principals.length?await tx.query<{principalId:string;shopId:string;shopName:string;scopes:ServicePrincipalScope[]}>(`SELECT d.principal_id AS "principalId",d.shop_id AS "shopId",s.name AS "shopName",d.scopes
      FROM app.service_principal_delegations d JOIN app.shops s ON s.tenant_id=d.tenant_id AND s.id=d.shop_id
      WHERE d.tenant_id=$1 AND d.principal_id=ANY($2::uuid[]) ORDER BY s.name`,[ctx.tenantId,principals.map(item=>item.id)]):[];
    const credentials=principals.length?await tx.query<ServiceCredentialSummaryRow>(`SELECT principal_id AS "principalId",credential_id AS "credentialId",secret_prefix AS "secretPrefix",status,
      created_at AS "createdAt",expires_at AS "expiresAt",retire_at AS "retireAt",last_used_at AS "lastUsedAt",authorized_request_count::text AS "authorizedRequestCount"
      FROM app.service_principal_credential_summaries()`):[];
    return {principals:principals.map(item=>{const rows=delegations.filter(row=>row.principalId===item.id),credentialRows=credentials.filter(row=>row.principalId===item.id);return {...item,expiresAt:item.expiresAt.toISOString(),createdAt:item.createdAt.toISOString(),revokedAt:item.revokedAt?.toISOString()??null,shops:rows.map(row=>({id:row.shopId,name:row.shopName})),scopes:[...new Set(rows.flatMap(row=>row.scopes))],credentials:credentialRows.map(row=>({id:row.credentialId,prefix:row.secretPrefix,status:row.status,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),retireAt:row.retireAt?.toISOString()??null,lastUsedAt:row.lastUsedAt?.toISOString()??null,authorizedRequestCount:row.authorizedRequestCount}))};}),canManage:role==='owner'};
  });
}

export type CreatedServicePrincipal={id:string;credential:string;credentialPrefix:string;expiresAt:string;retirePreviousAt:string|null;version:number};
export async function createServicePrincipal(ctx:Context,input:unknown):Promise<CreatedServicePrincipal>{
  const parsed=servicePrincipalInput.parse(input),expiresAt=new Date(parsed.expiresAt);
  if(expiresAt.getTime()<=Date.now()+5*60_000||expiresAt.getTime()>Date.now()+366*24*60*60_000)throw new AppError(400,'INVALID_EXPIRY','วันหมดอายุต้องอยู่ระหว่าง 5 นาทีถึง 366 วันจากปัจจุบัน');
  const credential=`svc_${randomBytes(32).toString('base64url')}`,credentialPrefix=credential.slice(0,16),id=randomUUID();
  try{return await withTenant(ctx,async(tx,role)=>{
    if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าขององค์กรสร้าง Service Principal ได้');
    const [saved]=await tx.query<{id:string}>('SELECT app.create_service_principal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id',[
      id,randomUUID(),parsed.name,parsed.shopIds,parsed.scopes,parsed.expiresAt,parsed.environment,parsed.audience,createHash('sha256').update(credential,'utf8').digest('hex'),credentialPrefix,
    ]);
    return {id:saved.id,credential,credentialPrefix,expiresAt:parsed.expiresAt,retirePreviousAt:null,version:1};
  });}catch(error){
    if(error instanceof AppError)throw error;
    if(error instanceof Error&&error.message.includes('SERVICE_PRINCIPAL_INVALID'))throw new AppError(400,'SERVICE_PRINCIPAL_INVALID','ข้อมูลสิทธิ์ร้าน Scope หรือวันหมดอายุไม่ถูกต้อง');
    throw error;
  }
}

export async function rotateServicePrincipalCredential(ctx:Context,principalId:string,input:unknown):Promise<CreatedServicePrincipal>{
  uuid.parse(principalId);const parsed=servicePrincipalRotationInput.parse(input),expiresAt=new Date(parsed.expiresAt);
  if(expiresAt.getTime()<=Date.now()+(parsed.overlapMinutes+5)*60_000||expiresAt.getTime()>Date.now()+366*24*60*60_000)throw new AppError(400,'INVALID_EXPIRY','วันหมดอายุใหม่ต้องยาวกว่าช่วงทับซ้อนอย่างน้อย 5 นาที และไม่เกิน 366 วัน');
  const credential=`svc_${randomBytes(32).toString('base64url')}`,credentialPrefix=credential.slice(0,16);
  try{return await withTenant(ctx,async(tx,role)=>{
    if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าขององค์กรหมุน credential ได้');
    const [saved]=await tx.query<{id:string;version:number;retirePreviousAt:Date}>('SELECT id,version,retire_previous_at AS "retirePreviousAt" FROM app.rotate_service_principal_credential($1,$2,$3,$4,$5,$6,$7,$8)',[
      principalId,parsed.version,randomUUID(),parsed.expiresAt,parsed.overlapMinutes,parsed.reason,createHash('sha256').update(credential,'utf8').digest('hex'),credentialPrefix,
    ]);
    return {id:saved.id,credential,credentialPrefix,expiresAt:parsed.expiresAt,retirePreviousAt:saved.retirePreviousAt.toISOString(),version:saved.version};
  });}catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('STALE_SERVICE_PRINCIPAL'))throw new AppError(409,'STALE_SERVICE_PRINCIPAL','สิทธิ์นี้ถูกเปลี่ยนหลังจากคุณเปิดหน้า กรุณาโหลดข้อมูลล่าสุด');
    if(message.includes('SERVICE_PRINCIPAL_REVOKED'))throw new AppError(409,'SERVICE_PRINCIPAL_REVOKED','Service Principal นี้ถูกเพิกถอนแล้ว');
    if(message.includes('SERVICE_PRINCIPAL_NOT_FOUND'))throw new AppError(404,'NOT_FOUND','ไม่พบ Service Principal นี้');
    if(message.includes('SERVICE_ROTATION_INVALID'))throw new AppError(400,'SERVICE_ROTATION_INVALID','ข้อมูลการหมุน credential ไม่ถูกต้อง');
    throw error;
  }
}

export async function revokeServicePrincipal(ctx:Context,principalId:string,input:unknown){
  uuid.parse(principalId);const parsed=servicePrincipalRevokeInput.parse(input);
  try{return await withTenant(ctx,async(tx,role)=>{
    if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าขององค์กรเพิกถอน Service Principal ได้');
    return (await tx.query<{id:string;status:'revoked';version:number}>('SELECT id,status,version FROM app.revoke_service_principal($1,$2,$3)',[principalId,parsed.version,parsed.reason]))[0];
  });}catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('STALE_SERVICE_PRINCIPAL'))throw new AppError(409,'STALE_SERVICE_PRINCIPAL','สิทธิ์นี้ถูกเปลี่ยนหลังจากคุณเปิดหน้า กรุณาโหลดข้อมูลล่าสุด');
    if(message.includes('SERVICE_PRINCIPAL_REVOKED'))throw new AppError(409,'SERVICE_PRINCIPAL_REVOKED','Service Principal นี้ถูกเพิกถอนแล้ว');
    if(message.includes('SERVICE_PRINCIPAL_NOT_FOUND'))throw new AppError(404,'NOT_FOUND','ไม่พบ Service Principal นี้');
    if(message.includes('SERVICE_PRINCIPAL_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เพิกถอน Service Principal');
    throw error;
  }
}

export type IntegrationInboxEvent={
  id:string;providerNamespace:string;providerEventId:string;eventType:string;streamType:string;streamId:string;sequenceNumber:string|null;
  occurredAt:string;receivedAt:string;rawBodyHash:string;metadataHash:string;signatureStatus:'verified'|'invalid';verificationMethod:string;
  verificationKeyReference:string|null;reconciliationStatus:'ready'|'needs_review'|'rejected';disposition:'accepted'|'recovered_gap'|'gap'|'stale'|'unordered'|'invalid_signature';
  reviewReason:string|null;operationalStatus:'observed'|'open'|'replay_requested'|'resolved';resolutionAction:'request_replay'|'acknowledge'|null;
  resolutionReason:string|null;resolvedAt:string|null;version:number;adapterVersion:string|null;providerApiVersion:string|null;payloadKeys:string[];
  cursorSequence:string|null;cursorUpdatedAt:string|null;missingSequenceCount:number;
};
type IntegrationInboxEventRow=Omit<IntegrationInboxEvent,'occurredAt'|'receivedAt'|'resolvedAt'|'cursorUpdatedAt'>&{
  occurredAt:Date;receivedAt:Date;resolvedAt:Date|null;cursorUpdatedAt:Date|null;
};
export type IntegrationInboxMetrics={total:number;open:number;needsReview:number;rejected:number;openGaps:number;overdue:number;oldestOpenMinutes:number|null;health:'healthy'|'attention'|'critical';reviewSlaMinutes:number};
export type IntegrationInboxWorkspace={events:IntegrationInboxEvent[];providers:string[];metrics:IntegrationInboxMetrics;canAct:boolean;limit:number};
const reviewSlaMinutes=15;

export async function integrationInboxWorkspace(ctx:Context,shopId:string):Promise<IntegrationInboxWorkspace>{
  uuid.parse(shopId);
  return withTenant(ctx,async(tx,role)=>{
    if(!['owner','operator','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดู Event Inbox');
    if(!(await tx.query('SELECT id FROM app.shops WHERE tenant_id=$1 AND id=$2',[ctx.tenantId,shopId])).length)throw new AppError(403,'SHOP_FORBIDDEN','คุณไม่มีสิทธิ์เข้าถึงร้านนี้');
    const rows=await tx.query<IntegrationInboxEventRow>(`SELECT e.id,e.provider_namespace AS "providerNamespace",e.provider_event_id AS "providerEventId",
      e.event_type AS "eventType",e.stream_type AS "streamType",e.stream_id AS "streamId",e.sequence_number::text AS "sequenceNumber",
      e.occurred_at AS "occurredAt",e.received_at AS "receivedAt",e.raw_body_hash AS "rawBodyHash",e.metadata_hash AS "metadataHash",
      e.signature_status AS "signatureStatus",e.verification_method AS "verificationMethod",e.verification_key_reference AS "verificationKeyReference",
      e.reconciliation_status AS "reconciliationStatus",e.disposition,e.review_reason AS "reviewReason",e.operational_status AS "operationalStatus",
      e.resolution_action AS "resolutionAction",e.resolution_reason AS "resolutionReason",e.resolved_at AS "resolvedAt",e.version,
      e.metadata->>'adapterVersion' AS "adapterVersion",e.metadata->>'providerApiVersion' AS "providerApiVersion",
      ARRAY(SELECT key FROM jsonb_object_keys(e.payload) AS key ORDER BY key) AS "payloadKeys",
      s.last_sequence::text AS "cursorSequence",s.updated_at AS "cursorUpdatedAt",
      CASE WHEN e.disposition='gap' AND e.sequence_number IS NOT NULL AND s.last_sequence IS NOT NULL
        THEN greatest(e.sequence_number-s.last_sequence-1,0)::int ELSE 0 END AS "missingSequenceCount"
      FROM app.integration_inbox_events e LEFT JOIN app.integration_inbox_streams s ON s.tenant_id=e.tenant_id AND s.shop_id=e.shop_id
        AND s.provider_namespace=e.provider_namespace AND s.stream_type=e.stream_type AND s.stream_id=e.stream_id
      WHERE e.tenant_id=$1 AND e.shop_id=$2 ORDER BY
        CASE e.operational_status WHEN 'open' THEN 0 WHEN 'replay_requested' THEN 1 WHEN 'observed' THEN 2 ELSE 3 END,
        e.received_at DESC,e.position DESC LIMIT 200`,[ctx.tenantId,shopId]);
    const [summary]=await tx.query<{total:number;open:number;needsReview:number;rejected:number;openGaps:number;overdue:number;oldestOpenMinutes:number|null}>(`SELECT
      count(*)::int AS total,count(*) FILTER(WHERE operational_status='open')::int AS open,
      count(*) FILTER(WHERE operational_status='open' AND reconciliation_status='needs_review')::int AS "needsReview",
      count(*) FILTER(WHERE operational_status='open' AND reconciliation_status='rejected')::int AS rejected,
      count(*) FILTER(WHERE operational_status='open' AND disposition='gap')::int AS "openGaps",
      count(*) FILTER(WHERE operational_status='open' AND received_at<clock_timestamp()-($3::text||' minutes')::interval)::int AS overdue,
      floor(extract(epoch FROM (clock_timestamp()-min(received_at) FILTER(WHERE operational_status='open')))/60)::int AS "oldestOpenMinutes"
      FROM app.integration_inbox_events WHERE tenant_id=$1 AND shop_id=$2`,[ctx.tenantId,shopId,reviewSlaMinutes]);
    const metrics={...summary,reviewSlaMinutes,health:(summary.rejected>0?'critical':summary.overdue>0||summary.openGaps>0?'attention':'healthy') as IntegrationInboxMetrics['health']};
    return {events:rows.map(row=>({...row,occurredAt:row.occurredAt.toISOString(),receivedAt:row.receivedAt.toISOString(),resolvedAt:row.resolvedAt?.toISOString()??null,cursorUpdatedAt:row.cursorUpdatedAt?.toISOString()??null})),providers:[...new Set(rows.map(row=>row.providerNamespace))].sort(),metrics,canAct:['owner','operator'].includes(role),limit:200};
  });
}

export type TransitionedIntegrationInboxEvent={id:string;operationalStatus:'replay_requested'|'resolved';version:number;actionId:string};
export async function transitionIntegrationInboxEvent(ctx:Context,eventId:string,input:unknown):Promise<TransitionedIntegrationInboxEvent>{
  uuid.parse(eventId);const parsed=integrationInboxActionInput.parse(input);
  try{return await withTenant(ctx,async(tx,role)=>{
    if(!['owner','operator'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการ Event Inbox');
    const [saved]=await tx.query<TransitionedIntegrationInboxEvent>(`SELECT id,operational_status AS "operationalStatus",version,action_id AS "actionId"
      FROM app.transition_integration_inbox_event($1,$2,$3,$4,$5)`,[parsed.shopId,eventId,parsed.version,parsed.action,parsed.reason]);
    await tx.query('INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[
      ctx.tenantId,randomUUID(),ctx.userId,`integration_inbox.${parsed.action}`,saved.id,
      JSON.stringify({shopId:parsed.shopId,reason:parsed.reason,version:saved.version,operationalStatus:saved.operationalStatus,actionId:saved.actionId}),
    ]);
    return saved;
  });}catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('STALE_INBOX_EVENT'))throw new AppError(409,'STALE_INBOX_EVENT','Event นี้ถูกเปลี่ยนหลังจากคุณเปิดหน้า กรุณาโหลดข้อมูลล่าสุด');
    if(message.includes('INBOX_SIGNATURE_NOT_VERIFIED'))throw new AppError(409,'INBOX_SIGNATURE_NOT_VERIFIED','Event ที่ลายเซ็นไม่ผ่านไม่สามารถขอประมวลผลซ้ำได้');
    if(message.includes('INBOX_REPLAY_ALREADY_REQUESTED'))throw new AppError(409,'INBOX_REPLAY_ALREADY_REQUESTED','Event นี้มีคำขอประมวลผลอีกครั้งอยู่แล้ว');
    if(message.includes('INBOX_EVENT_NOT_OPEN'))throw new AppError(409,'INBOX_EVENT_NOT_OPEN','Event นี้ไม่มีรายการติดตามที่ต้องปิด');
    if(message.includes('INBOX_EVENT_RESOLVED'))throw new AppError(409,'INBOX_EVENT_RESOLVED','Event นี้ปิดการติดตามแล้ว');
    if(message.includes('INBOX_EVENT_NOT_FOUND'))throw new AppError(404,'NOT_FOUND','ไม่พบ Event นี้');
    if(message.includes('INBOX_ACTION_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการ Event Inbox');
    throw error;
  }
}
