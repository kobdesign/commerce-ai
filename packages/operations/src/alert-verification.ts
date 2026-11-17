import { createHmac,timingSafeEqual } from 'node:crypto';

export const alertVerificationErrorCodes=[
  'INVALID_SECRET','BODY_TOO_LARGE','MISSING_HEADER','INVALID_TIMESTAMP','STALE_REQUEST','FUTURE_REQUEST',
  'INVALID_SIGNATURE','INVALID_JSON','INVALID_ALERT','HEADER_MISMATCH','SCOPE_MISMATCH','REPLAYED_EVENT',
] as const;
export type AlertVerificationErrorCode=typeof alertVerificationErrorCodes[number];

export class AlertVerificationError extends Error{
  constructor(readonly code:AlertVerificationErrorCode){super(code);this.name='AlertVerificationError';}
}

export type AlertReplayStore={
  consume(eventId:string,expiresAt:Date):Promise<'accepted'|'duplicate'>;
};

export type VerifiedAlert={
  schemaVersion:'1';eventId:string;source:'commerce-runtime-monitor'|'commerce-agent-canary-monitor';environment:string;
  status:'unavailable'|'recovered'|'breached';observedAt:string;tenantId:string|null;contentCaptured:false;
};

type HeaderSource=Headers|Readonly<Record<string,string|undefined>>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signaturePattern=/^sha256=([0-9a-f]{64})$/i;
const runtimeKeys=new Set(['schemaVersion','eventId','source','environment','status','observedAt','checks']);
const canaryKeys=new Set(['schemaVersion','eventId','source','environment','status','observedAt','tenantId','contentCaptured','policy','summary','breaches']);
const canaryPolicyKeys=new Set(['profileId','classification','approvalStatus']);
const canarySummaryKeys=new Set(['routeDecisions','eveRoutes','legacyRoutes','sessionsStarted','sessionsCompleted','fallbacks','errors','reportedCostUsd',
  'unavailableCostEvents','fallbackRatePercent','errorRatePercent','grantsIssued','grantsConsumed','grantReplays','grantsRevoked','grantsExpired','grantRateLimited']);

function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function header(input:HeaderSource,name:string){
  if(input instanceof Headers)return input.get(name)?.trim()||null;
  const match=Object.entries(input).find(([key])=>key.toLowerCase()===name);
  return match?.[1]?.trim()||null;
}
function exactKeys(input:Record<string,unknown>,allowed:Set<string>){return Object.keys(input).every(key=>allowed.has(key))&&Object.keys(input).length===allowed.size;}
function environment(value:unknown){return typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value);}
function validProbe(value:unknown){
  if(!record(value)||!['ok','unavailable'].includes(String(value.status))||
    !(value.httpStatus===null||(typeof value.httpStatus==='number'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599))||
    !['none','http','timeout','network','invalid-response'].includes(String(value.reason)))return false;
  const allowed=new Set(['status','httpStatus','reason','checks']);
  if(Object.keys(value).some(key=>!allowed.has(key)))return false;
  if(value.checks!==undefined&&(!record(value.checks)||Object.entries(value.checks).some(([key,status])=>
    !['configuration','applicationDatabase','identityDatabase','worker','importQueue'].includes(key)||!['ok','unavailable'].includes(String(status)))))return false;
  return true;
}
function validRuntimeAlert(input:Record<string,unknown>){
  if(!exactKeys(input,runtimeKeys)||input.source!=='commerce-runtime-monitor'||!['unavailable','recovered'].includes(String(input.status))||!record(input.checks)||
    !exactKeys(input.checks,new Set(['health','readiness']))||!validProbe(input.checks.health)||!validProbe(input.checks.readiness))return false;
  return true;
}
function validSummary(input:unknown){return record(input)&&exactKeys(input,canarySummaryKeys)&&
  Object.values(input).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0);}
function validCanaryAlert(input:Record<string,unknown>){
  if(!exactKeys(input,canaryKeys)||input.source!=='commerce-agent-canary-monitor'||!['breached','recovered'].includes(String(input.status))||
    typeof input.tenantId!=='string'||!uuid.test(input.tenantId)||input.contentCaptured!==false||!record(input.policy)||
    !exactKeys(input.policy,canaryPolicyKeys)||
    typeof input.policy.profileId!=='string'||input.policy.classification!=='engineering-rehearsal-only'||input.policy.approvalStatus!=='not-approved'||
    !validSummary(input.summary)||!Array.isArray(input.breaches)||input.breaches.some(value=>!['insufficient_route_volume','fallback_rate','error_rate','reported_cost','grant_replay','grant_rate_limited','grant_expired'].includes(String(value))))return false;
  return true;
}
function safeEqual(actual:string,expected:string){
  const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}

export async function verifySignedAlert(input:{
  rawBody:string;headers:HeaderSource;secret:string;replayStore:AlertReplayStore;expectedEnvironment:string;
  allowedSources:readonly VerifiedAlert['source'][];now?:Date;maxBodyBytes?:number;maxAgeMs?:number;maxFutureSkewMs?:number;
}):Promise<VerifiedAlert>{
  const maxBodyBytes=input.maxBodyBytes??16_384,maxAgeMs=input.maxAgeMs??5*60_000,maxFutureSkewMs=input.maxFutureSkewMs??60_000;
  if(input.secret.length<32)throw new AlertVerificationError('INVALID_SECRET');
  if(Buffer.byteLength(input.rawBody,'utf8')>maxBodyBytes)throw new AlertVerificationError('BODY_TOO_LARGE');
  const eventId=header(input.headers,'x-commerce-event-id'),timestamp=header(input.headers,'x-commerce-event-timestamp'),signature=header(input.headers,'x-commerce-signature');
  if(!eventId||!timestamp||!signature)throw new AlertVerificationError('MISSING_HEADER');
  const observedMs=Date.parse(timestamp);if(Number.isNaN(observedMs))throw new AlertVerificationError('INVALID_TIMESTAMP');
  const now=input.now??new Date(),age=now.getTime()-observedMs;
  if(age>maxAgeMs)throw new AlertVerificationError('STALE_REQUEST');
  if(age < -maxFutureSkewMs)throw new AlertVerificationError('FUTURE_REQUEST');
  if(!signaturePattern.test(signature))throw new AlertVerificationError('INVALID_SIGNATURE');
  const expected=`sha256=${createHmac('sha256',input.secret).update(`${timestamp}.${input.rawBody}`).digest('hex')}`;
  if(!safeEqual(signature.toLowerCase(),expected))throw new AlertVerificationError('INVALID_SIGNATURE');
  let parsed:unknown;try{parsed=JSON.parse(input.rawBody);}catch{throw new AlertVerificationError('INVALID_JSON');}
  if(!record(parsed)||parsed.schemaVersion!=='1'||typeof parsed.eventId!=='string'||!uuid.test(parsed.eventId)||
    !environment(parsed.environment)||typeof parsed.observedAt!=='string'||Number.isNaN(Date.parse(parsed.observedAt))||
    !(validRuntimeAlert(parsed)||validCanaryAlert(parsed)))throw new AlertVerificationError('INVALID_ALERT');
  if(parsed.eventId!==eventId||parsed.observedAt!==timestamp)throw new AlertVerificationError('HEADER_MISMATCH');
  if(parsed.environment!==input.expectedEnvironment||!input.allowedSources.includes(parsed.source as VerifiedAlert['source']))throw new AlertVerificationError('SCOPE_MISMATCH');
  const consumed=await input.replayStore.consume(eventId,new Date(observedMs+maxAgeMs));
  if(consumed==='duplicate')throw new AlertVerificationError('REPLAYED_EVENT');
  return {schemaVersion:'1',eventId,source:parsed.source as VerifiedAlert['source'],environment:parsed.environment as string,
    status:parsed.status as VerifiedAlert['status'],observedAt:timestamp,tenantId:typeof parsed.tenantId==='string'?parsed.tenantId:null,contentCaptured:false};
}

/** Local/test only. Production must use a shared durable store with atomic consume semantics. */
export class InMemoryAlertReplayStore implements AlertReplayStore{
  private readonly entries=new Map<string,number>();
  constructor(private readonly now:()=>Date=()=>new Date()){}
  async consume(eventId:string,expiresAt:Date){
    const now=this.now().getTime();for(const [id,expiry] of this.entries)if(expiry<=now)this.entries.delete(id);
    if(this.entries.has(eventId))return 'duplicate' as const;
    this.entries.set(eventId,expiresAt.getTime());return 'accepted' as const;
  }
}
