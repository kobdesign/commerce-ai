export const requiredCanaryTechnicalGateIds=[
  'POC-ISOLATION','POC-EVIDENCE','POC-OBSERVABILITY','POC-SHADOW','POC-ROLLBACK','CANARY-GRANT-REGISTRY','CANARY-GRANT-OPERATIONS','CANARY-SESSION-ACL','CANARY-SESSION-LIFECYCLE','CANARY-LIFECYCLE-RECONCILIATION','CANARY-CLEANUP-IDENTITY-RETENTION',
] as const;
export const requiredCanaryApprovalGateIds=[
  'CANARY-IDENTITY-SECRETS','CANARY-DATA-POLICY','CANARY-MODEL-BUDGET','CANARY-DYNAMIC-ROUTING','CANARY-MONITORING-SLO','CANARY-INCIDENT-OWNERSHIP',
] as const;

type GateStatus='proposed'|'approved'|'rejected';
type TechnicalGate={id:string;status:'verified'|'failed';evidence:string[]};
type Approver={subject:string;role:string};
type Governance={mode:'separated-roles'|'bootstrap-single-owner';ownerSubject:string|null;productionAllowed:false;
  realTenantDataAllowed:false;commerceMutationsAllowed:false;maximumWindowHours:number;promotionRequirement:string};
type ApprovalGate={id:string;status:GateStatus;ownerRoles:string[];requiredBefore:string;selectedOption:string|null;
  controls:Record<string,unknown>;approvedBy:Approver[];approvedAt:string|null;evidence:string[]};

function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0;}
function stringList(value:unknown):value is string[]{return Array.isArray(value)&&value.every(text);}
function technicalGate(value:unknown):value is TechnicalGate{
  return record(value)&&text(value.id)&&['verified','failed'].includes(String(value.status))&&stringList(value.evidence);
}
function approver(value:unknown):value is Approver{return record(value)&&text(value.subject)&&text(value.role);}
function governance(value:unknown):value is Governance{
  if(!record(value)||!['separated-roles','bootstrap-single-owner'].includes(String(value.mode))||
    !(value.ownerSubject===null||text(value.ownerSubject))||value.productionAllowed!==false||value.realTenantDataAllowed!==false||
    value.commerceMutationsAllowed!==false||!positiveNumber(value.maximumWindowHours)||Number(value.maximumWindowHours)>4||!text(value.promotionRequirement))return false;
  return value.mode==='separated-roles'||text(value.ownerSubject);
}
function approvalGate(value:unknown):value is ApprovalGate{
  return record(value)&&text(value.id)&&['proposed','approved','rejected'].includes(String(value.status))&&stringList(value.ownerRoles)&&new Set(value.ownerRoles).size>=2&&
    text(value.requiredBefore)&&(value.selectedOption===null||text(value.selectedOption))&&record(value.controls)&&Array.isArray(value.approvedBy)&&value.approvedBy.every(approver)&&
    (value.approvedAt===null||text(value.approvedAt))&&stringList(value.evidence);
}
function positiveNumber(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>0;}
function controlText(controls:Record<string,unknown>,key:string){return text(controls[key]);}

function approvedControlErrors(gate:ApprovalGate,governancePolicy:Governance){
  if(gate.status!=='approved')return [];
  const errors:string[]=[];
  const requireText=(key:string)=>{if(!controlText(gate.controls,key))errors.push(`${gate.id} requires control ${key}.`);};
  const requireNumber=(key:string)=>{if(!positiveNumber(gate.controls[key]))errors.push(`${gate.id} requires a positive numeric control ${key}.`);};
  if(gate.id==='CANARY-IDENTITY-SECRETS')for(const key of ['identityProvider','secretManager','rotationRehearsal'])requireText(key);
  if(gate.id==='CANARY-DATA-POLICY')for(const key of ['allowedDataContract','retentionPolicy','providerRetentionMode'])requireText(key);
  if(gate.id==='CANARY-MODEL-BUDGET'){
    requireText('modelAllowlist');for(const key of ['monthlyBudgetUsd','perRunMaxInputTokens','perRunMaxOutputTokens','perRunMaxCostUsd'])requireNumber(key);
  }
  if(gate.id==='CANARY-DYNAMIC-ROUTING'){
    for(const key of ['flagOwner','auditSink'])requireText(key);requireNumber('revocationSloSeconds');
  }
  if(gate.id==='CANARY-MONITORING-SLO'){
    for(const key of ['monitorProvider','alertEvidence'])requireText(key);
    if(!positiveNumber(gate.controls.availabilitySloPercent)||Number(gate.controls.availabilitySloPercent)>100)errors.push(`${gate.id} requires availabilitySloPercent between 0 and 100.`);
  }
  if(gate.id==='CANARY-INCIDENT-OWNERSHIP'){
    if(governancePolicy.mode==='bootstrap-single-owner'){
      for(const key of ['primaryOwner','communicationsOwner','runbook'])requireText(key);requireNumber('ackTargetMinutes');
      if(gate.controls.primaryOwner!==governancePolicy.ownerSubject||gate.controls.communicationsOwner!==governancePolicy.ownerSubject){
        errors.push(`${gate.id} bootstrap incident ownership must match the configured owner.`);
      }
      if(gate.controls.backupOwner===governancePolicy.ownerSubject)errors.push(`${gate.id} bootstrap owner cannot be their own backup.`);
    }else{
      for(const key of ['primaryOwner','backupOwner','runbook'])requireText(key);requireNumber('ackTargetMinutes');
      if(controlText(gate.controls,'primaryOwner')&&gate.controls.primaryOwner===gate.controls.backupOwner)errors.push(`${gate.id} requires different primary and backup owners.`);
    }
  }
  return errors;
}

export function agentCanaryReadinessGate(input:unknown){
  const errors:string[]=[];
  if(!record(input)||input.schemaVersion!==1||!text(input.reviewedAt)||input.scope!=='read-only-internal-canary'||
    !governance(input.governance)||!Array.isArray(input.technicalGates)||!Array.isArray(input.approvalGates)){
    return {status:'blocked' as const,productionDecision:'no-go' as const,errors:['Invalid Eve canary readiness manifest.'],technicalGates:[],approvalGates:[],blockingGates:[]};
  }
  const governancePolicy=input.governance,technical=input.technicalGates.filter(technicalGate),approvals=input.approvalGates.filter(approvalGate);
  if(technical.length!==input.technicalGates.length)errors.push('One or more technical gates have an invalid shape.');
  if(approvals.length!==input.approvalGates.length)errors.push('One or more approval gates have an invalid shape.');
  const technicalIds=new Set(technical.map(gate=>gate.id)),approvalIds=new Set(approvals.map(gate=>gate.id));
  if(technicalIds.size!==technical.length)errors.push('Technical gate IDs must be unique.');
  if(approvalIds.size!==approvals.length)errors.push('Approval gate IDs must be unique.');
  for(const id of requiredCanaryTechnicalGateIds)if(!technicalIds.has(id))errors.push(`Missing technical gate ${id}.`);
  for(const id of requiredCanaryApprovalGateIds)if(!approvalIds.has(id))errors.push(`Missing approval gate ${id}.`);
  for(const gate of technical)if(gate.status==='verified'&&gate.evidence.length===0)errors.push(`${gate.id} requires technical evidence.`);
  for(const gate of approvals){
    if(gate.status==='approved'){
      if(!gate.selectedOption)errors.push(`${gate.id} is approved without a selected option.`);
      const subjects=new Set(gate.approvedBy.map(item=>item.subject.trim())),roles=new Set(gate.approvedBy.map(item=>item.role.trim()));
      if(governancePolicy.mode==='bootstrap-single-owner'){
        if(subjects.size!==1||!subjects.has(governancePolicy.ownerSubject!))errors.push(`${gate.id} requires the configured bootstrap owner.`);
        if(roles.size!==1||!roles.has('BootstrapOwner'))errors.push(`${gate.id} requires the BootstrapOwner role.`);
      }else{
        if(subjects.size<2)errors.push(`${gate.id} requires at least two distinct approvers.`);
        if(roles.size<2)errors.push(`${gate.id} requires approvers from at least two distinct roles.`);
        if(gate.approvedBy.some(item=>!gate.ownerRoles.includes(item.role)))errors.push(`${gate.id} has an approver outside the declared owner roles.`);
      }
      if(!gate.approvedAt||Number.isNaN(Date.parse(gate.approvedAt)))errors.push(`${gate.id} requires a valid approval timestamp.`);
      if(gate.evidence.length===0)errors.push(`${gate.id} requires approval evidence.`);
      errors.push(...approvedControlErrors(gate,governancePolicy));
    }
  }
  const technicalReady=requiredCanaryTechnicalGateIds.every(id=>technical.find(gate=>gate.id===id)?.status==='verified');
  const approvalsReady=requiredCanaryApprovalGateIds.every(id=>approvals.find(gate=>gate.id===id)?.status==='approved');
  const blockingGates=[...technical.filter(gate=>gate.status!=='verified').map(gate=>gate.id),...approvals.filter(gate=>gate.status!=='approved').map(gate=>gate.id)];
  const ready=errors.length===0&&technicalReady&&approvalsReady;
  return {status:ready?'approved' as const:'blocked' as const,productionDecision:'no-go' as const,errors,technicalReady,approvalsReady,blockingGates,
    governance:{mode:governancePolicy.mode,ownerSubject:governancePolicy.ownerSubject,productionAllowed:false,realTenantDataAllowed:false,commerceMutationsAllowed:false},
    technicalGates:technical.map(({id,status,evidence})=>({id,status,evidenceCount:evidence.length})),
    approvalGates:approvals.map(({id,status,requiredBefore,selectedOption})=>({id,status,requiredBefore,selectedOption}))};
}
