import { createHash,createHmac,randomUUID,timingSafeEqual } from 'node:crypto';

export const supportSensitiveSelectors=[
  'input[type="password"]',
  '[data-support-secret]',
  '[data-support-pii]',
  '[data-support-financial]',
  '[data-support-evidence]',
] as const;

export type SupportPageClass='catalog'|'imports'|'settlements'|'reviews';
export type SupportSessionState='awaiting_consent'|'ready_for_agent'|'active'|'ended';
export type SupportEndReason='customer_stopped'|'expired'|'access_revoked'|'scope_changed'|'kill_switch'|'vendor_ended';
export type SupportPolicy={
  enabled:boolean;
  killSwitch:boolean;
  allowedOrigins:string[];
  allowedPageClasses:SupportPageClass[];
  ttlMs:number;
  codePepper:string;
  privateByDefault:true;
  maskedSelectors:string[];
};
export type SupportSession={
  id:string;
  tenantId:string;
  customerUserId:string;
  caseId:string;
  assignedAgentId:string;
  origin:string;
  pageClass:SupportPageClass;
  state:SupportSessionState;
  mode:'view_only';
  codeHash:string;
  codeConsumedAt:string|null;
  vendorSessionId:string|null;
  requestedAt:string;
  consentedAt:string|null;
  startedAt:string|null;
  expiresAt:string;
  endedAt:string|null;
  endReason:SupportEndReason|null;
  policyVersion:string;
};
export type VendorCreateInput={
  externalReference:string;
  mode:'view_only';
  origin:string;
  pageClass:SupportPageClass;
  privateByDefault:true;
  maskedSelectors:string[];
  recording:false;
  remoteControl:false;
  fullDeviceSharing:false;
};
export interface CobrowsingVendorAdapter{
  createSession(input:VendorCreateInput):Promise<{vendorSessionId:string}>;
  claimSession(input:{vendorSessionId:string;agentId:string}):Promise<void>;
  endSession(input:{vendorSessionId:string;reason:SupportEndReason}):Promise<void>;
}

export class SupportPolicyError extends Error{
  constructor(public readonly code:string,message:string){super(message);this.name='SupportPolicyError';}
}
function deny(code:string,message:string):never{throw new SupportPolicyError(code,message);}
function instant(value:Date|string){return new Date(value).toISOString();}
function codeHash(code:string,pepper:string){return createHash('sha256').update(`${pepper}:${code}`).digest('hex');}
function sameHash(a:string,b:string){const left=Buffer.from(a,'hex'),right=Buffer.from(b,'hex');return left.length===right.length&&timingSafeEqual(left,right);}
function allowedScope(policy:SupportPolicy,origin:string,pageClass:SupportPageClass){
  let parsed:URL;
  try{parsed=new URL(origin);}catch{deny('ORIGIN_NOT_ALLOWED','Origin ไม่ถูกต้อง');}
  if(parsed.protocol!=='https:'||parsed.origin!==origin||!policy.allowedOrigins.includes(origin))deny('ORIGIN_NOT_ALLOWED','หน้านี้อยู่นอก origin ที่อนุญาต');
  if(!policy.allowedPageClasses.includes(pageClass))deny('PAGE_NOT_ALLOWED','หน้าประเภทนี้ไม่อนุญาตให้แชร์');
}
export function validateSupportPolicy(policy:SupportPolicy){
  const errors:string[]=[];
  if(!policy.privateByDefault)errors.push('Co-browsing policy must be private by default.');
  if(!Number.isInteger(policy.ttlMs)||policy.ttlMs<60_000||policy.ttlMs>15*60_000)errors.push('Session TTL must be between 1 and 15 minutes.');
  if(policy.codePepper.length<16)errors.push('Code pepper must be at least 16 characters.');
  for(const selector of supportSensitiveSelectors)if(!policy.maskedSelectors.includes(selector))errors.push(`Missing sensitive selector ${selector}.`);
  for(const origin of policy.allowedOrigins){
    try{const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin)errors.push(`Allowed origin must be an exact HTTPS origin: ${origin}.`);}
    catch{errors.push(`Allowed origin is invalid: ${origin}.`);}
  }
  return {valid:errors.length===0,errors};
}
function requireAvailable(policy:SupportPolicy){
  const report=validateSupportPolicy(policy);if(!report.valid)deny('POLICY_INVALID',report.errors.join(' '));
  if(!policy.enabled||policy.killSwitch)deny('SUPPORT_DISABLED','การแชร์หน้าจอถูกปิดใช้งาน');
}

export function requestSupportSession(input:{
  tenantId:string;customerUserId:string;caseId:string;assignedAgentId:string;origin:string;pageClass:SupportPageClass;oneTimeCode:string;policyVersion:string;
},policy:SupportPolicy,now=new Date()):SupportSession{
  requireAvailable(policy);allowedScope(policy,input.origin,input.pageClass);
  if(!/^\d{6}$/.test(input.oneTimeCode))deny('INVALID_CODE','รหัสต้องเป็นตัวเลข 6 หลัก');
  const requestedAt=instant(now);
  return {id:randomUUID(),tenantId:input.tenantId,customerUserId:input.customerUserId,caseId:input.caseId,assignedAgentId:input.assignedAgentId,origin:input.origin,pageClass:input.pageClass,state:'awaiting_consent',mode:'view_only',codeHash:codeHash(input.oneTimeCode,policy.codePepper),codeConsumedAt:null,vendorSessionId:null,requestedAt,consentedAt:null,startedAt:null,expiresAt:instant(new Date(now.getTime()+policy.ttlMs)),endedAt:null,endReason:null,policyVersion:input.policyVersion};
}

export async function consentToSupportSession(session:SupportSession,consent:boolean,policy:SupportPolicy,adapter:CobrowsingVendorAdapter,now=new Date()){
  requireAvailable(policy);allowedScope(policy,session.origin,session.pageClass);
  if(session.state!=='awaiting_consent')deny('INVALID_STATE','สถานะ session ไม่พร้อมรับ consent');
  if(new Date(session.expiresAt)<=now)deny('SESSION_EXPIRED','session หมดอายุแล้ว');
  if(!consent)deny('CONSENT_REQUIRED','ผู้ใช้ยังไม่ได้ยินยอม');
  const vendor=await adapter.createSession({externalReference:session.id,mode:'view_only',origin:session.origin,pageClass:session.pageClass,privateByDefault:true,maskedSelectors:[...policy.maskedSelectors],recording:false,remoteControl:false,fullDeviceSharing:false});
  return {...session,state:'ready_for_agent' as const,vendorSessionId:vendor.vendorSessionId,consentedAt:instant(now)};
}

export async function claimSupportSession(session:SupportSession,input:{tenantId:string;caseId:string;agentId:string;oneTimeCode:string},policy:SupportPolicy,adapter:CobrowsingVendorAdapter,now=new Date()){
  requireAvailable(policy);
  if(session.state!=='ready_for_agent'||!session.vendorSessionId||session.codeConsumedAt)deny('CODE_ALREADY_USED','รหัสนี้ใช้ไม่ได้แล้ว');
  if(new Date(session.expiresAt)<=now)deny('SESSION_EXPIRED','session หมดอายุแล้ว');
  if(input.tenantId!==session.tenantId||input.caseId!==session.caseId||input.agentId!==session.assignedAgentId)deny('SCOPE_MISMATCH','agent, case หรือ tenant ไม่ตรงกับ session');
  if(!sameHash(session.codeHash,codeHash(input.oneTimeCode,policy.codePepper)))deny('INVALID_CODE','รหัสไม่ถูกต้อง');
  await adapter.claimSession({vendorSessionId:session.vendorSessionId,agentId:input.agentId});
  const at=instant(now);return {...session,state:'active' as const,codeConsumedAt:at,startedAt:at};
}

export async function endSupportSession(session:SupportSession,reason:SupportEndReason,adapter:CobrowsingVendorAdapter,now=new Date()){
  if(session.state==='ended')return session;
  if(session.vendorSessionId)await adapter.endSession({vendorSessionId:session.vendorSessionId,reason});
  return {...session,state:'ended' as const,endedAt:instant(now),endReason:reason};
}

export async function revalidateSupportSession(session:SupportSession,input:{tenantId:string;origin:string;pageClass:SupportPageClass;membershipActive:boolean},policy:SupportPolicy,adapter:CobrowsingVendorAdapter,now=new Date()){
  if(session.state==='ended')return session;
  let reason:SupportEndReason|null=null;
  if(!policy.enabled||policy.killSwitch)reason='kill_switch';
  else if(new Date(session.expiresAt)<=now)reason='expired';
  else if(!input.membershipActive)reason='access_revoked';
  else if(input.tenantId!==session.tenantId||input.origin!==session.origin||input.pageClass!==session.pageClass||!policy.allowedOrigins.includes(input.origin)||!policy.allowedPageClasses.includes(input.pageClass))reason='scope_changed';
  return reason?endSupportSession(session,reason,adapter,now):session;
}

export type SyntheticWebhookEvent={eventId:string;vendorSessionId:string;type:'session.ended';occurredAt:string};
export function verifySyntheticWebhook(payload:string,signature:string,secret:string){
  const expected=createHmac('sha256',secret).update(payload).digest('hex');
  return /^[a-f0-9]{64}$/.test(signature)&&sameHash(signature,expected);
}
export async function applySyntheticWebhook(session:SupportSession,event:SyntheticWebhookEvent,processedEventIds:Set<string>,adapter:CobrowsingVendorAdapter,now=new Date(event.occurredAt)){
  if(processedEventIds.has(event.eventId))return {session,duplicate:true};
  if(event.vendorSessionId!==session.vendorSessionId)deny('VENDOR_SESSION_MISMATCH','webhook ไม่ตรงกับ vendor session');
  processedEventIds.add(event.eventId);
  void adapter;
  return {session:{...session,state:'ended' as const,endedAt:instant(now),endReason:'vendor_ended' as const},duplicate:false};
}

export class SyntheticCobrowsingAdapter implements CobrowsingVendorAdapter{
  readonly created:VendorCreateInput[]=[];
  readonly claimed:{vendorSessionId:string;agentId:string}[]=[];
  readonly ended:{vendorSessionId:string;reason:SupportEndReason}[]=[];
  async createSession(input:VendorCreateInput){this.created.push(input);return {vendorSessionId:`synthetic-${this.created.length}`};}
  async claimSession(input:{vendorSessionId:string;agentId:string}){this.claimed.push(input);}
  async endSession(input:{vendorSessionId:string;reason:SupportEndReason}){this.ended.push(input);}
}
