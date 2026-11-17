import { agentCanaryReadinessGate } from './agent-canary-readiness';

const requiredAbortCriteria=['tenant_isolation','unauthorized_tool','evidence_integrity','mutation_attempt','alert_delivery','budget','incident_ack'] as const;
const requiredPreflightEvidence=['approvalRecord','providerRetentionConfirmation','stagingSecretProvisioning','alertDeliveryDryRun','ownerAcknowledgement','rollbackRehearsal','liveTurnPolicyTest','changeTicket'] as const;
type PlanStatus='draft'|'approved'|'rejected';
type MonitoringOption={id:string;label:string;disposition:'recommended'|'alternative'|'insufficient-alone';components:string[];officialReferences:string[];limitations:string[]};
type SloProfile={id:string;label:string;classification:'proposal-only';minimumSampleSize:number;applicationAvailabilityPercent:number;
  agentCompletionRatePercent:number;maximumFallbackRatePercent:number;maximumErrorRatePercent:number;acknowledgementTargetMinutes:number;escalationTargetMinutes:number};
type StagingPlan={schemaVersion:1;reviewedAt:string;status:PlanStatus;scope:'staging-synthetic-only';executionEnabled:boolean;
  selectedOptions:{monitoringStack:string|null;sloProfile:string|null};monitoringOptions:MonitoringOption[];sloProfiles:SloProfile[];
  incidentOwnership:{primaryOwner:string|null;backupOwner:string|null;communicationsOwner:string|null};
  window:{startsAt:string|null;endsAt:string|null;changeTicket:string|null};syntheticTenantId:string|null;
  runtimeCapabilities:{liveTurnsImplemented:boolean;commerceMutationsEnabled:false;productionTenantDataEnabled:false;codeReference:string};
  requestedCapabilities:{liveModelCalls:true;commerceMutations:false;productionTenantData:false};
  abortCriteria:{id:string;action:'kill-switch-and-fallback';description:string}[];
  preflightEvidence:Record<typeof requiredPreflightEvidence[number],string|null>;
  completionEvidenceTemplate:{routeMetrics:null;sessionMetrics:null;costMetrics:null;incidentTimeline:null;rollbackResult:null};
};

function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0;}
function textList(value:unknown):value is string[]{return Array.isArray(value)&&value.every(text);}
function integer(value:unknown,min:number,max:number){return typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;}
function percentage(value:unknown,min=0){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=100;}
function nullableText(value:unknown){return value===null||text(value);}
function uuid(value:unknown){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
function monitoringOption(value:unknown):value is MonitoringOption{
  return record(value)&&text(value.id)&&text(value.label)&&['recommended','alternative','insufficient-alone'].includes(String(value.disposition))&&
    textList(value.components)&&textList(value.officialReferences)&&value.officialReferences.length>0&&textList(value.limitations);
}
function sloProfile(value:unknown):value is SloProfile{
  return record(value)&&text(value.id)&&text(value.label)&&value.classification==='proposal-only'&&integer(value.minimumSampleSize,1,10_000)&&
    percentage(value.applicationAvailabilityPercent,90)&&percentage(value.agentCompletionRatePercent,0)&&percentage(value.maximumFallbackRatePercent)&&
    percentage(value.maximumErrorRatePercent)&&integer(value.acknowledgementTargetMinutes,1,240)&&integer(value.escalationTargetMinutes,1,480)&&
    Number(value.escalationTargetMinutes)>=Number(value.acknowledgementTargetMinutes);
}
function parsePlan(input:unknown):{plan:StagingPlan|null;errors:string[]}{
  const errors:string[]=[];
  if(!record(input)||input.schemaVersion!==1||!text(input.reviewedAt)||!['draft','approved','rejected'].includes(String(input.status))||
    input.scope!=='staging-synthetic-only'||typeof input.executionEnabled!=='boolean'||!record(input.selectedOptions)||
    !nullableText(input.selectedOptions.monitoringStack)||!nullableText(input.selectedOptions.sloProfile)||!Array.isArray(input.monitoringOptions)||
    !Array.isArray(input.sloProfiles)||!record(input.incidentOwnership)||!nullableText(input.incidentOwnership.primaryOwner)||
    !nullableText(input.incidentOwnership.backupOwner)||!nullableText(input.incidentOwnership.communicationsOwner)||!record(input.window)||
    !nullableText(input.window.startsAt)||!nullableText(input.window.endsAt)||!nullableText(input.window.changeTicket)||
    !(input.syntheticTenantId===null||uuid(input.syntheticTenantId))||!record(input.runtimeCapabilities)||
    typeof input.runtimeCapabilities.liveTurnsImplemented!=='boolean'||input.runtimeCapabilities.commerceMutationsEnabled!==false||
    input.runtimeCapabilities.productionTenantDataEnabled!==false||!text(input.runtimeCapabilities.codeReference)||!record(input.requestedCapabilities)||
    input.requestedCapabilities.liveModelCalls!==true||input.requestedCapabilities.commerceMutations!==false||input.requestedCapabilities.productionTenantData!==false||
    !Array.isArray(input.abortCriteria)||!record(input.preflightEvidence)||!record(input.completionEvidenceTemplate)){
    return {plan:null,errors:['Invalid Eve canary staging plan.']};
  }
  const monitors=input.monitoringOptions.filter(monitoringOption),profiles=input.sloProfiles.filter(sloProfile);
  if(monitors.length!==input.monitoringOptions.length)errors.push('One or more monitoring options have an invalid shape.');
  if(profiles.length!==input.sloProfiles.length)errors.push('One or more SLO profiles have an invalid shape.');
  if(new Set(monitors.map(option=>option.id)).size!==monitors.length)errors.push('Monitoring option IDs must be unique.');
  if(new Set(profiles.map(profile=>profile.id)).size!==profiles.length)errors.push('SLO profile IDs must be unique.');
  if(monitors.filter(option=>option.disposition==='recommended').length!==1)errors.push('Exactly one monitoring option must be recommended.');
  const aborts=input.abortCriteria.filter(item=>record(item)&&text(item.id)&&item.action==='kill-switch-and-fallback'&&text(item.description));
  if(aborts.length!==input.abortCriteria.length)errors.push('One or more abort criteria have an invalid shape.');
  const abortIds=new Set(aborts.map(item=>String(item.id)));
  for(const id of requiredAbortCriteria)if(!abortIds.has(id))errors.push(`Missing abort criterion ${id}.`);
  for(const key of requiredPreflightEvidence)if(!(key in input.preflightEvidence)||!nullableText(input.preflightEvidence[key]))errors.push(`Invalid preflight evidence field ${key}.`);
  for(const key of ['routeMetrics','sessionMetrics','costMetrics','incidentTimeline','rollbackResult'])if(input.completionEvidenceTemplate[key]!==null)errors.push(`Completion evidence template ${key} must remain null before execution.`);
  return {plan:input as StagingPlan,errors};
}

export function agentCanaryStagingGate(planInput:unknown,readinessInput:unknown){
  const parsed=parsePlan(planInput),readiness=agentCanaryReadinessGate(readinessInput);
  if(!parsed.plan)return {status:'blocked' as const,executionDecision:'no-go' as const,errors:parsed.errors,blockingConditions:['invalid_plan'],readiness};
  const plan=parsed.plan,blocking:string[]=[];
  if(plan.status!=='approved')blocking.push('plan_not_approved');
  if(!plan.executionEnabled)blocking.push('execution_disabled');
  if(!plan.selectedOptions.monitoringStack)blocking.push('monitoring_stack_not_selected');
  else{
    const selectedMonitor=plan.monitoringOptions.find(option=>option.id===plan.selectedOptions.monitoringStack);
    if(!selectedMonitor)parsed.errors.push('Selected monitoring option does not exist.');
    else if(selectedMonitor.disposition==='insufficient-alone')parsed.errors.push('Selected monitoring option is explicitly insufficient as a standalone canary control.');
  }
  if(!plan.selectedOptions.sloProfile)blocking.push('slo_profile_not_selected');
  else if(!plan.sloProfiles.some(profile=>profile.id===plan.selectedOptions.sloProfile))parsed.errors.push('Selected SLO profile does not exist.');
  const owners=[plan.incidentOwnership.primaryOwner,plan.incidentOwnership.backupOwner,plan.incidentOwnership.communicationsOwner];
  if(readiness.governance?.mode==='bootstrap-single-owner'){
    const owner=readiness.governance.ownerSubject;
    if(!plan.incidentOwnership.primaryOwner||!plan.incidentOwnership.communicationsOwner)blocking.push('bootstrap_owner_not_assigned');
    else if(plan.incidentOwnership.primaryOwner!==owner||plan.incidentOwnership.communicationsOwner!==owner){
      parsed.errors.push('Primary and communications ownership must match the configured bootstrap owner.');
    }
    if(plan.incidentOwnership.backupOwner===owner)parsed.errors.push('Bootstrap owner cannot be recorded as their own backup.');
  }else if(owners.some(owner=>!owner))blocking.push('incident_owners_missing');
  else if(new Set(owners).size!==owners.length)parsed.errors.push('Primary, backup and communications owners must be distinct.');
  if(!plan.syntheticTenantId)blocking.push('synthetic_tenant_not_selected');
  if(!plan.window.startsAt||!plan.window.endsAt||!plan.window.changeTicket)blocking.push('canary_window_not_scheduled');
  else{
    const starts=Date.parse(plan.window.startsAt),ends=Date.parse(plan.window.endsAt);
    if(Number.isNaN(starts)||Number.isNaN(ends)||ends<=starts||ends-starts>4*60*60*1000)parsed.errors.push('Canary window must be valid and no longer than four hours.');
  }
  for(const key of requiredPreflightEvidence)if(!plan.preflightEvidence[key])blocking.push(`preflight_evidence_missing:${key}`);
  if(!plan.runtimeCapabilities.liveTurnsImplemented)blocking.push('live_turn_policy_not_implemented');
  if(readiness.status!=='approved')blocking.push(...readiness.blockingGates.map(gate=>`readiness:${gate}`));
  const ready=parsed.errors.length===0&&blocking.length===0;
  return {status:ready?'approved' as const:'blocked' as const,executionDecision:ready?'go' as const:'no-go' as const,errors:parsed.errors,
    blockingConditions:[...new Set(blocking)],selectedOptions:plan.selectedOptions,runtimeCapabilities:plan.runtimeCapabilities,readiness};
}
