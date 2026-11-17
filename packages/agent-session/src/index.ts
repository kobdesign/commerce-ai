import { randomUUID } from 'node:crypto';
import {
  readAgentRouteConfiguration,
  resolveAgentRoute,
  resolveDynamicAgentRoute,
  type AgentRouteConfiguration,
  type AgentRouteDecision,
  type DynamicAgentRoutePolicy,
} from '@commerce/agent-routing';
import {
  exportCommerceSessionPublicKey,
  commerceSessionIdSchema,
  CommerceSessionGrantError,
  issueCommerceSessionGrant,
  verifyCommerceSessionGrant,
  type CommerceSessionEnvironment,
} from '@commerce/agent-session-auth';
import { AppError,uuid,type Context } from '@commerce/contracts';
import {
  abandonAgentSession,
  bindAgentSession,
  consumeAgentSessionGrant,
  createAgentSessionEndIntent,
  endAgentSession,
  readAgentSessionGrantMetrics,
  readAgentSessionReconciliationMetrics,
  recordAgentSessionEveReceipt,
  revokeAgentSession,
  revokeAgentSessionGrant,
  withTenant,
} from '@commerce/db';
import { z } from 'zod';

const createRequestSchema=z.object({
  shopIds:z.array(uuid).min(1).max(20).refine(values=>new Set(values).size===values.length,'ร้านค้าต้องไม่ซ้ำกัน'),
}).strict();
const continueRequestSchema=z.object({sessionId:commerceSessionIdSchema}).strict();
const requestSchema=z.union([createRequestSchema,continueRequestSchema]);
const bindSchema=z.object({sessionId:commerceSessionIdSchema,grantToken:z.string().min(80).max(4096),confirmed:z.literal(true)}).strict();
const revocationSchema=z.object({reason:z.string().trim().min(10).max(500),confirmed:z.literal(true)}).strict();
const abandonSchema=bindSchema.extend({reason:z.string().trim().min(10).max(500)}).strict();
const endIntentSchema=z.object({
  grantToken:z.string().min(80).max(4096),idempotencyKey:uuid,
  reason:z.string().trim().min(10).max(500),confirmed:z.literal(true),
}).strict();
const eveReceiptSchema=z.object({
  deliveryId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/),confirmed:z.literal(true),
}).strict();

export const commerceAgentSessionMaxLifetimeSeconds=14_400;

export type CommerceAgentSessionConfiguration={environment:CommerceSessionEnvironment;keyId:string|null;privateKey:string|null;route:AgentRouteConfiguration;dynamicRouting?:boolean;ttlSeconds?:number;now?:Date};

export async function createCommerceAgentSession(ctx:Context,input:unknown,configuration:CommerceAgentSessionConfiguration){
  const request=requestSchema.parse(input);
  if(configuration.dynamicRouting){
    const expectedEnvironment=process.env.APP_MODE==='local-demo'?'development':process.env.APP_MODE==='staging-demo'?'staging':null;
    if(process.env.AI_ENABLED!=='false'||expectedEnvironment!==configuration.environment){
      throw new AppError(503,'AGENT_SESSION_DISABLED','Dynamic AI routing is restricted to the synthetic non-live runtime.');
    }
  }
  let staticRoute:AgentRouteDecision|null=null;
  if(!configuration.dynamicRouting){
    staticRoute=resolveAgentRoute(ctx.tenantId,configuration.route);
    if(staticRoute.engine==='legacy')return {engine:'legacy' as const,reason:staticRoute.reason,token:null,expiresAt:null};
  }else if(!configuration.route.eveEnabled){
    return {engine:'legacy' as const,reason:'global_disabled' as const,token:null,expiresAt:null};
  }else if(configuration.route.killSwitch){
    return {engine:'legacy' as const,reason:'kill_switch' as const,token:null,expiresAt:null};
  }
  if(!configuration.keyId||!configuration.privateKey)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session signing is not configured.');
  const keyId=configuration.keyId,privateKey=configuration.privateKey;
  try{return await withTenant(ctx,async tx=>{
    let route=staticRoute;
    let policyVersion:number|null=null;
    if(configuration.dynamicRouting){
      const policies=await tx.query<DynamicAgentRoutePolicy>(`SELECT status,environment,expires_at AS "expiresAt",version
        FROM app.read_agent_route_policy_for_grant()`);
      const policy=policies[0]??null;policyVersion=policy?.version??null;
      route=resolveDynamicAgentRoute(ctx.tenantId,configuration.environment,policy,configuration.now??new Date());
      if(route.engine==='legacy')return {engine:'legacy' as const,reason:route.reason,token:null,expiresAt:null};
    }
    if(!route||route.engine!=='eve')throw new AppError(503,'AGENT_SESSION_DISABLED','AI route could not be resolved.');
    let shopIds:string[],role=ctx.role,sessionId:string|null=null,capability:'create'|'continue'='create';
    if('sessionId' in request){
      const sessions=await tx.query<{sessionId:string;shopIds:string[];role:typeof ctx.role;policyVersion:number|null}>(
        `SELECT session_id AS "sessionId",shop_ids AS "shopIds",role,policy_version AS "policyVersion"
         FROM app.read_agent_session_for_continuation($1,$2)`,[request.sessionId,configuration.environment],
      );
      const session=sessions[0];
      if(!session)throw new AppError(409,'AGENT_SESSION_UNAVAILABLE','AI session นี้หมดอายุ ถูกยกเลิก หรือคุณไม่มีสิทธิ์ใช้งาน');
      shopIds=session.shopIds;role=session.role;sessionId=session.sessionId;policyVersion=session.policyVersion;capability='continue';
    }else{
      shopIds=request.shopIds;
      const allowed=await tx.query<{id:string}>('SELECT id FROM app.shops WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[ctx.tenantId,shopIds]);
      if(allowed.length!==shopIds.length)throw new AppError(403,'SHOP_FORBIDDEN','คุณไม่มีสิทธิ์ใช้ AI กับร้านค้าที่เลือก');
    }
    const issued=issueCommerceSessionGrant({subject:ctx.userId,tenantId:ctx.tenantId,shopIds,role,
      environment:configuration.environment,capability,sessionId,ttlSeconds:configuration.ttlSeconds},{keyId,privateKey,now:configuration.now});
    await tx.query('SELECT app.register_agent_session_grant_v2($1,$2,$3::uuid[],$4,$5,$6,to_timestamp($7),to_timestamp($8),$9,$10,$11)',[
      issued.claims.grantId,issued.claims.subject,issued.claims.shopIds,issued.claims.role,issued.claims.environment,keyId,
      issued.claims.issuedAt,issued.claims.expiresAt,policyVersion,issued.claims.capability,issued.claims.sessionId,
    ]);
    await tx.query('INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',[
      ctx.tenantId,randomUUID(),ctx.userId,'agent.session_grant.issued',issued.claims.grantId,
      JSON.stringify({shopIds,expiresAt:issued.claims.expiresAt,keyId,routeReason:route.reason,policyVersion,capability,sessionId}),
    ]);
    return {engine:'eve' as const,reason:route.reason,token:issued.token,
      capability,sessionId,expiresAt:new Date(issued.claims.expiresAt*1000).toISOString()};
  });}catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('AGENT_SESSION_UNAVAILABLE'))throw new AppError(409,'AGENT_SESSION_UNAVAILABLE','AI session นี้หมดอายุ ถูกยกเลิก หรือคุณไม่มีสิทธิ์ใช้งาน');
    if(message.includes('AGENT_SESSION_GRANT_INVALID'))throw new AppError(409,'AGENT_SESSION_GRANT_UNAVAILABLE','ไม่สามารถออก session grant ได้');
    throw error;
  }
}

export type CommerceAgentSessionVerifierConfiguration={environment:CommerceSessionEnvironment;keyId:string;publicKey:string;now?:Date};

export function commerceAgentSessionVerifierConfiguration(env:Readonly<Record<string,string|undefined>>):CommerceAgentSessionVerifierConfiguration{
  const environment=env.APP_MODE==='local-demo'?'development':env.APP_MODE==='staging-demo'?'staging':null;
  const keyId=env.COMMERCE_AGENT_SESSION_KEY_ID?.trim(),privateKey=env.COMMERCE_AGENT_SESSION_PRIVATE_KEY?.trim();
  if(!environment||!keyId||!privateKey)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session grant verification is not configured.');
  try{return {environment,keyId,publicKey:exportCommerceSessionPublicKey(privateKey)};}
  catch{throw new AppError(503,'AGENT_SESSION_DISABLED','AI session grant verification configuration is invalid.');}
}

export async function consumeCommerceAgentSessionGrant(token:string,configuration:CommerceAgentSessionVerifierConfiguration){
  try{
    const claims=verifyCommerceSessionGrant(token,{...configuration});
    const consumed=await consumeAgentSessionGrant(claims);
    return {status:'consumed' as const,grantId:consumed.grantId,consumedAt:consumed.consumedAt.toISOString()};
  }catch(error){
    if(error instanceof Error&&error.message.includes('AGENT_SESSION_GRANT_UNAVAILABLE')){
      throw new AppError(409,'AGENT_SESSION_GRANT_UNAVAILABLE','Session grant นี้หมดอายุ ถูกยกเลิก หรือถูกใช้ไปแล้ว');
    }
    throw error;
  }
}

export async function bindCommerceAgentSession(ctx:Context,input:unknown,configuration:CommerceAgentSessionConfiguration){
  const parsed=bindSchema.parse(input);
  if(!configuration.keyId||!configuration.privateKey)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session signing is not configured.');
  try{
    const now=configuration.now??new Date();
    const claims=verifyCommerceSessionGrant(parsed.grantToken,{
      environment:configuration.environment,keyId:configuration.keyId,
      publicKey:exportCommerceSessionPublicKey(configuration.privateKey),now,
    });
    if(claims.capability!=='create'||claims.sessionId!==null||claims.tenantId!==ctx.tenantId||claims.subject!==ctx.userId){
      throw new Error('AGENT_SESSION_BIND_UNAVAILABLE');
    }
    const bound=await bindAgentSession(ctx,{grantId:claims.grantId,sessionId:parsed.sessionId,
      expiresAt:new Date(now.getTime()+commerceAgentSessionMaxLifetimeSeconds*1000)});
    return {sessionId:bound.sessionId,status:'active' as const,expiresAt:bound.expiresAt.toISOString()};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(error instanceof CommerceSessionGrantError||message.includes('AGENT_SESSION_BIND'))throw new AppError(409,'AGENT_SESSION_BIND_UNAVAILABLE','ไม่สามารถผูก AI session นี้ได้');
    throw error;
  }
}

export async function abandonCommerceAgentSession(ctx:Context,input:unknown,configuration:CommerceAgentSessionConfiguration){
  const parsed=abandonSchema.parse(input);
  if(!configuration.keyId||!configuration.privateKey)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session signing is not configured.');
  try{
    const claims=verifyCommerceSessionGrant(parsed.grantToken,{
      environment:configuration.environment,keyId:configuration.keyId,
      publicKey:exportCommerceSessionPublicKey(configuration.privateKey),now:configuration.now??new Date(),
    });
    if(claims.capability!=='create'||claims.sessionId!==null||claims.tenantId!==ctx.tenantId||claims.subject!==ctx.userId){
      throw new Error('AGENT_SESSION_ABANDON_UNAVAILABLE');
    }
    return await abandonAgentSession(ctx,{grantId:claims.grantId,sessionId:parsed.sessionId,reason:parsed.reason});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(error instanceof CommerceSessionGrantError||message.includes('AGENT_SESSION_ABANDON')){
      throw new AppError(409,'AGENT_SESSION_ABANDON_UNAVAILABLE','ไม่สามารถปิด session ที่ผูกไม่สำเร็จได้');
    }
    throw error;
  }
}

export async function endCommerceAgentSession(ctx:Context,sessionId:string,input:unknown){
  commerceSessionIdSchema.parse(sessionId);const parsed=revocationSchema.parse(input);
  try{return await endAgentSession(ctx,sessionId,parsed.reason);}
  catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('AGENT_SESSION_END_FORBIDDEN'))throw new AppError(403,'AGENT_SESSION_END_FORBIDDEN','คุณไม่มีสิทธิ์ปิด AI session นี้');
    if(message.includes('AGENT_SESSION_END_EVIDENCE_REQUIRED'))throw new AppError(409,'AGENT_SESSION_END_EVIDENCE_REQUIRED','ยังไม่มีหลักฐานว่า Eve รับคำขอปิด session นี้');
    if(message.includes('AGENT_SESSION_END_UNAVAILABLE'))throw new AppError(409,'AGENT_SESSION_END_UNAVAILABLE','AI session นี้ถูกปิดหรือยกเลิกไปแล้ว');
    throw error;
  }
}

export async function createCommerceAgentSessionEndIntent(
  ctx:Context,sessionId:string,input:unknown,configuration:CommerceAgentSessionConfiguration,
){
  commerceSessionIdSchema.parse(sessionId);const parsed=endIntentSchema.parse(input);
  if(!configuration.keyId||!configuration.privateKey)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session signing is not configured.');
  try{
    const claims=verifyCommerceSessionGrant(parsed.grantToken,{
      environment:configuration.environment,keyId:configuration.keyId,
      publicKey:exportCommerceSessionPublicKey(configuration.privateKey),now:configuration.now??new Date(),
    });
    if(claims.capability!=='continue'||claims.sessionId!==sessionId
      ||claims.tenantId!==ctx.tenantId||claims.subject!==ctx.userId){
      throw new Error('AGENT_SESSION_INTENT_UNAVAILABLE');
    }
    return await createAgentSessionEndIntent(ctx,{
      id:randomUUID(),sessionId,grantId:claims.grantId,idempotencyKey:parsed.idempotencyKey,reason:parsed.reason,
    });
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('AGENT_SESSION_INTENT_CONFLICT')){
      throw new AppError(409,'AGENT_SESSION_INTENT_CONFLICT','รหัสคำขอปิด session ถูกใช้กับข้อมูลอื่นแล้ว');
    }
    if(error instanceof CommerceSessionGrantError||message.includes('AGENT_SESSION_INTENT_UNAVAILABLE')){
      throw new AppError(409,'AGENT_SESSION_INTENT_UNAVAILABLE','ไม่สามารถสร้างคำขอปิด AI session นี้ได้');
    }
    throw error;
  }
}

export async function recordCommerceAgentSessionEveReceipt(ctx:Context,intentId:string,input:unknown){
  uuid.parse(intentId);const parsed=eveReceiptSchema.parse(input);
  try{return await recordAgentSessionEveReceipt(ctx,intentId,parsed.deliveryId);}
  catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('AGENT_SESSION_RECEIPT_CONFLICT')){
      throw new AppError(409,'AGENT_SESSION_RECEIPT_CONFLICT','Eve receipt ไม่ตรงกับหลักฐานที่บันทึกไว้');
    }
    if(message.includes('AGENT_SESSION_RECEIPT_UNAVAILABLE')){
      throw new AppError(409,'AGENT_SESSION_RECEIPT_UNAVAILABLE','คำขอนี้ไม่พร้อมรับ Eve receipt');
    }
    throw error;
  }
}

export async function revokeCommerceAgentSession(ctx:Context,sessionId:string,input:unknown){
  commerceSessionIdSchema.parse(sessionId);const parsed=revocationSchema.parse(input);
  try{return await revokeAgentSession(ctx,sessionId,parsed.reason);}
  catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('AGENT_SESSION_REVOKE_FORBIDDEN'))throw new AppError(403,'AGENT_SESSION_REVOKE_FORBIDDEN','คุณไม่มีสิทธิ์หรือ session นี้ปิดไปแล้ว');
    throw error;
  }
}

export async function revokeCommerceAgentSessionGrant(ctx:Context,grantId:string,input:unknown){
  uuid.parse(grantId);const parsed=revocationSchema.parse(input);
  if(!['owner','auditor'].includes(ctx.role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของหรือผู้ตรวจสอบที่ยกเลิก AI session grant ได้');
  try{return await revokeAgentSessionGrant(ctx,grantId,parsed.reason);}
  catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('AGENT_SESSION_GRANT_UNAVAILABLE'))throw new AppError(409,'AGENT_SESSION_GRANT_UNAVAILABLE','Session grant นี้ไม่พร้อมให้ยกเลิก');
    if(message.includes('AGENT_SESSION_GRANT_REVOKE_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ยกเลิก Session grant นี้');
    throw error;
  }
}

export async function commerceAgentSessionGrantMetrics(ctx:Context,windowMinutes:number){
  if(!['owner','auditor'].includes(ctx.role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของหรือผู้ตรวจสอบที่ดูข้อมูลความปลอดภัยของ AI ได้');
  const metrics=await readAgentSessionGrantMetrics(ctx,windowMinutes);
  return {windowMinutes,contentCaptured:false as const,metrics:Object.fromEntries(metrics.map(metric=>[metric.eventType,metric.eventCount]))};
}

export async function commerceAgentSessionReconciliationMetrics(ctx:Context){
  if(!['owner','auditor'].includes(ctx.role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของหรือผู้ตรวจสอบที่ดูสถานะการกระทบยอด AI session ได้');
  return {contentCaptured:false as const,metrics:await readAgentSessionReconciliationMetrics(ctx)};
}

export function commerceAgentSessionConfiguration(env:Readonly<Record<string,string|undefined>>):CommerceAgentSessionConfiguration{
  const environment=env.APP_MODE==='local-demo'?'development':env.APP_MODE==='staging-demo'?'staging':null;
  if(!environment)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session is available only in the synthetic local or staging POC.');
  const route=readAgentRouteConfiguration(env);
  const dynamicValue=env.COMMERCE_AGENT_DYNAMIC_ROUTING?.trim()||'false';
  if(!['true','false'].includes(dynamicValue))throw new AppError(503,'AGENT_SESSION_DISABLED','COMMERCE_AGENT_DYNAMIC_ROUTING must be true or false.');
  const dynamicRouting=dynamicValue==='true';
  if(dynamicRouting&&env.AI_ENABLED!=='false')throw new AppError(503,'AGENT_SESSION_DISABLED','Dynamic AI routing requires AI_ENABLED=false.');
  const keyId=env.COMMERCE_AGENT_SESSION_KEY_ID?.trim(),privateKey=env.COMMERCE_AGENT_SESSION_PRIVATE_KEY?.trim();
  if(route.eveEnabled&&!route.killSwitch){
    if(!keyId||!privateKey)throw new AppError(503,'AGENT_SESSION_DISABLED','AI session signing is not configured.');
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(keyId)||!/^[A-Za-z0-9_-]{40,}$/.test(privateKey))throw new AppError(503,'AGENT_SESSION_DISABLED','AI session signing configuration is invalid.');
  }
  return {environment,keyId:keyId??null,privateKey:privateKey??null,route,dynamicRouting};
}
