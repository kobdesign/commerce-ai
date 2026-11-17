import { randomUUID } from 'node:crypto';

export const canarySignalKinds=['route','session','fallback','error','cost','grant'] as const;
export type CanarySignalKind=typeof canarySignalKinds[number];
const canaryRouteReasons=['global_disabled','kill_switch','tenant_not_enabled','tenant_enabled','dynamic_policy_missing','dynamic_policy_pending',
  'dynamic_policy_revoked','dynamic_policy_expired','dynamic_environment_mismatch','dynamic_tenant_enabled'] as const;
type CanaryRouteReason=typeof canaryRouteReasons[number];

type RouteSignal={kind:'route';engine:'legacy'|'eve';reason:CanaryRouteReason};
type SessionSignal={kind:'session';outcome:'started'|'completed'};
type FallbackSignal={kind:'fallback';reason:'eve_unavailable'|'eve_timeout'|'eve_failed'|'rollback_requested'};
type ErrorSignal={kind:'error';stage:'route'|'session'|'runtime';code:'timeout'|'unavailable'|'execution_failed'|'policy_blocked'};
type CostSignal={kind:'cost';status:'reported'|'partial'|'unavailable';amountUsd:number|null};
type GrantSignal={kind:'grant';outcome:'issued'|'consumed'|'replay'|'revoked'|'expired'|'rate_limited'};
export type CanarySignal={schemaVersion:1;eventId:string;observedAt:string;tenantId:string;executionId:string;contentCaptured:false}&
  (RouteSignal|SessionSignal|FallbackSignal|ErrorSignal|CostSignal|GrantSignal);

export type CanaryMonitoringPolicy={schemaVersion:1;profileId:string;classification:'engineering-rehearsal-only';approvalStatus:'not-approved';
  scope:'synthetic-tenant-only';windowSeconds:number;requiredConsecutiveBreaches:number;requiredConsecutiveRecoveries:number;
  thresholds:{minimumRouteDecisions:number;maximumFallbackRatePercent:number;maximumErrorRatePercent:number;maximumReportedCostUsd:number;
    maximumGrantReplayCount:number;maximumGrantRateLimitedCount:number;maximumGrantExpiredCount:number};
  slo:{status:'not-approved';availabilityPercent:null};incidentOwnership:{status:'not-approved';primaryOwner:null;backupOwner:null}};

export type CanaryWindowSummary={routeDecisions:number;eveRoutes:number;legacyRoutes:number;sessionsStarted:number;sessionsCompleted:number;
  fallbacks:number;errors:number;reportedCostUsd:number;unavailableCostEvents:number;fallbackRatePercent:number;errorRatePercent:number;
  grantsIssued:number;grantsConsumed:number;grantReplays:number;grantsRevoked:number;grantsExpired:number;grantRateLimited:number};
export type CanaryThresholdBreach='insufficient_route_volume'|'fallback_rate'|'error_rate'|'reported_cost'|
  'grant_replay'|'grant_rate_limited'|'grant_expired';
export type CanaryWindowEvaluation={status:'healthy'|'breached';tenantId:string;windowStartedAt:string;windowEndedAt:string;contentCaptured:false;
  policy:{profileId:string;classification:'engineering-rehearsal-only';approvalStatus:'not-approved'};summary:CanaryWindowSummary;breaches:CanaryThresholdBreach[]};
export type CanaryAlert={schemaVersion:'1';eventId:string;source:'commerce-agent-canary-monitor';environment:string;status:'breached'|'recovered';
  observedAt:string;tenantId:string;contentCaptured:false;policy:CanaryWindowEvaluation['policy'];summary:CanaryWindowSummary;breaches:CanaryThresholdBreach[]};

function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function integer(value:unknown,min:number,max:number){return typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;}
function percentage(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;}
function uuid(value:unknown){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
function timestamp(value:unknown){return typeof value==='string'&&!Number.isNaN(Date.parse(value));}

export function parseCanaryMonitoringPolicy(input:unknown):CanaryMonitoringPolicy{
  if(!record(input)||input.schemaVersion!==1||typeof input.profileId!=='string'||input.profileId.trim()===''||
    input.classification!=='engineering-rehearsal-only'||input.approvalStatus!=='not-approved'||input.scope!=='synthetic-tenant-only'||
    !integer(input.windowSeconds,60,3600)||!integer(input.requiredConsecutiveBreaches,1,10)||!integer(input.requiredConsecutiveRecoveries,1,10)||
    !record(input.thresholds)||!integer(input.thresholds.minimumRouteDecisions,1,10_000)||!percentage(input.thresholds.maximumFallbackRatePercent)||
    !percentage(input.thresholds.maximumErrorRatePercent)||typeof input.thresholds.maximumReportedCostUsd!=='number'||
    !Number.isFinite(input.thresholds.maximumReportedCostUsd)||input.thresholds.maximumReportedCostUsd<0||
    !integer(input.thresholds.maximumGrantReplayCount,0,10_000)||!integer(input.thresholds.maximumGrantRateLimitedCount,0,10_000)||
    !integer(input.thresholds.maximumGrantExpiredCount,0,10_000)||
    !record(input.slo)||input.slo.status!=='not-approved'||input.slo.availabilityPercent!==null||!record(input.incidentOwnership)||
    input.incidentOwnership.status!=='not-approved'||input.incidentOwnership.primaryOwner!==null||input.incidentOwnership.backupOwner!==null){
    throw new Error('Invalid synthetic Eve canary monitoring policy.');
  }
  return input as CanaryMonitoringPolicy;
}

export function parseCanarySignal(input:unknown):CanarySignal{
  if(!record(input)||input.schemaVersion!==1||!uuid(input.eventId)||!timestamp(input.observedAt)||!uuid(input.tenantId)||!uuid(input.executionId)||input.contentCaptured!==false||
    !canarySignalKinds.includes(input.kind as CanarySignalKind))throw new Error('Invalid canary monitoring signal.');
  const allowed=new Set(['schemaVersion','eventId','observedAt','tenantId','executionId','contentCaptured','kind']);
  if(input.kind==='route'){
    allowed.add('engine');allowed.add('reason');
    if(!['legacy','eve'].includes(String(input.engine))||!canaryRouteReasons.includes(input.reason as CanaryRouteReason))throw new Error('Invalid route signal.');
  }else if(input.kind==='session'){
    allowed.add('outcome');if(!['started','completed'].includes(String(input.outcome)))throw new Error('Invalid session signal.');
  }else if(input.kind==='fallback'){
    allowed.add('reason');if(!['eve_unavailable','eve_timeout','eve_failed','rollback_requested'].includes(String(input.reason)))throw new Error('Invalid fallback signal.');
  }else if(input.kind==='error'){
    allowed.add('stage');allowed.add('code');
    if(!['route','session','runtime'].includes(String(input.stage))||!['timeout','unavailable','execution_failed','policy_blocked'].includes(String(input.code)))throw new Error('Invalid error signal.');
  }else if(input.kind==='cost'){
    allowed.add('status');allowed.add('amountUsd');
    if(!['reported','partial','unavailable'].includes(String(input.status))||!((input.status==='unavailable'&&input.amountUsd===null)||
      (input.status!=='unavailable'&&typeof input.amountUsd==='number'&&Number.isFinite(input.amountUsd)&&input.amountUsd>=0)))throw new Error('Invalid cost signal.');
  }else{
    allowed.add('outcome');
    if(!['issued','consumed','replay','revoked','expired','rate_limited'].includes(String(input.outcome)))throw new Error('Invalid grant signal.');
  }
  if(Object.keys(input).some(key=>!allowed.has(key)))throw new Error('Canary signal contains a non-allowlisted field.');
  return input as CanarySignal;
}

function rate(numerator:number,denominator:number){return denominator===0?0:Number(((numerator/denominator)*100).toFixed(2));}

export function evaluateCanaryWindow(input:{tenantId:string;signals:unknown[];policy:CanaryMonitoringPolicy;now?:Date}):CanaryWindowEvaluation{
  if(!uuid(input.tenantId))throw new Error('A valid tenant ID is required.');
  const now=input.now??new Date(),start=new Date(now.getTime()-input.policy.windowSeconds*1000);
  const signals=input.signals.map(parseCanarySignal).filter(signal=>signal.tenantId===input.tenantId&&new Date(signal.observedAt)>=start&&new Date(signal.observedAt)<=now);
  const routes=signals.filter((signal):signal is CanarySignal&RouteSignal=>signal.kind==='route');
  const costs=signals.filter((signal):signal is CanarySignal&CostSignal=>signal.kind==='cost');
  const grants=signals.filter((signal):signal is CanarySignal&GrantSignal=>signal.kind==='grant');
  const summary:CanaryWindowSummary={routeDecisions:routes.length,eveRoutes:routes.filter(signal=>signal.engine==='eve').length,
    legacyRoutes:routes.filter(signal=>signal.engine==='legacy').length,sessionsStarted:signals.filter(signal=>signal.kind==='session'&&signal.outcome==='started').length,
    sessionsCompleted:signals.filter(signal=>signal.kind==='session'&&signal.outcome==='completed').length,fallbacks:signals.filter(signal=>signal.kind==='fallback').length,
    errors:signals.filter(signal=>signal.kind==='error').length,reportedCostUsd:Number(costs.reduce((sum,signal)=>sum+(signal.amountUsd??0),0).toFixed(6)),
    unavailableCostEvents:costs.filter(signal=>signal.status==='unavailable').length,fallbackRatePercent:0,errorRatePercent:0,
    grantsIssued:grants.filter(signal=>signal.outcome==='issued').length,grantsConsumed:grants.filter(signal=>signal.outcome==='consumed').length,
    grantReplays:grants.filter(signal=>signal.outcome==='replay').length,grantsRevoked:grants.filter(signal=>signal.outcome==='revoked').length,
    grantsExpired:grants.filter(signal=>signal.outcome==='expired').length,grantRateLimited:grants.filter(signal=>signal.outcome==='rate_limited').length};
  summary.fallbackRatePercent=rate(summary.fallbacks,summary.eveRoutes);
  summary.errorRatePercent=rate(summary.errors,summary.eveRoutes);
  const breaches:CanaryThresholdBreach[]=[];
  if(summary.routeDecisions<input.policy.thresholds.minimumRouteDecisions)breaches.push('insufficient_route_volume');
  if(summary.fallbackRatePercent>input.policy.thresholds.maximumFallbackRatePercent)breaches.push('fallback_rate');
  if(summary.errorRatePercent>input.policy.thresholds.maximumErrorRatePercent)breaches.push('error_rate');
  if(summary.reportedCostUsd>input.policy.thresholds.maximumReportedCostUsd)breaches.push('reported_cost');
  if(summary.grantReplays>input.policy.thresholds.maximumGrantReplayCount)breaches.push('grant_replay');
  if(summary.grantRateLimited>input.policy.thresholds.maximumGrantRateLimitedCount)breaches.push('grant_rate_limited');
  if(summary.grantsExpired>input.policy.thresholds.maximumGrantExpiredCount)breaches.push('grant_expired');
  return {status:breaches.length?'breached':'healthy',tenantId:input.tenantId,windowStartedAt:start.toISOString(),windowEndedAt:now.toISOString(),
    contentCaptured:false,policy:{profileId:input.policy.profileId,classification:input.policy.classification,approvalStatus:input.policy.approvalStatus},summary,breaches};
}

export class CanaryTransitionTracker{
  private state:'unknown'|'healthy'|'breached'='unknown';private consecutiveHealthy=0;private consecutiveBreached=0;
  constructor(private readonly breachThreshold:number,private readonly recoveryThreshold:number){
    if(!integer(breachThreshold,1,10)||!integer(recoveryThreshold,1,10))throw new Error('Canary transition thresholds must be integers from 1 to 10.');
  }
  observe(evaluation:CanaryWindowEvaluation):'breached'|'recovered'|null{
    if(evaluation.status==='healthy'){
      this.consecutiveHealthy++;this.consecutiveBreached=0;
      if(this.state==='unknown'){this.state='healthy';return null;}
      if(this.state==='breached'&&this.consecutiveHealthy>=this.recoveryThreshold){this.state='healthy';return 'recovered';}
      return null;
    }
    this.consecutiveBreached++;this.consecutiveHealthy=0;
    if(this.state!=='breached'&&this.consecutiveBreached>=this.breachThreshold){this.state='breached';return 'breached';}
    return null;
  }
}

export function canaryAlert(environment:string,status:'breached'|'recovered',evaluation:CanaryWindowEvaluation):CanaryAlert{
  return {schemaVersion:'1',eventId:randomUUID(),source:'commerce-agent-canary-monitor',environment,status,observedAt:evaluation.windowEndedAt,
    tenantId:evaluation.tenantId,contentCaptured:false,policy:evaluation.policy,summary:evaluation.summary,breaches:evaluation.breaches};
}
