type RecordValue=Record<string,unknown>;

function record(value:unknown):value is RecordValue{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0;}
function positiveNumber(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>0;}

export function agentAiGatewayBudgetConfiguration(input:unknown,readiness:unknown){
  const errors:string[]=[];
  if(!record(input)||input.schemaVersion!==1||input.provider!=='vercel-ai-gateway'||input.scope!=='project'||
    !record(input.target)||!text(input.target.projectId)||!text(input.target.projectName)||!text(input.target.teamId)||
    input.currency!=='USD'||!positiveNumber(input.limit)||input.refreshPeriod!=='monthly'||
    !record(input.approvedBy)||!text(input.approvedBy.subject)||input.approvedBy.role!=='BootstrapOwner'||
    !text(input.approvedAt)||Number.isNaN(Date.parse(input.approvedAt))||!record(input.platformSync)||
    !['pending','applied'].includes(String(input.platformSync.status))||!text(input.applyCommand)){
    return {status:'invalid' as const,enforcementStatus:'unknown' as const,errors:['Invalid AI Gateway project budget configuration.']};
  }
  if(!record(readiness)||!Array.isArray(readiness.approvalGates))errors.push('Invalid Eve canary readiness manifest.');
  const budgetGate=record(readiness)&&Array.isArray(readiness.approvalGates)
    ? readiness.approvalGates.find(gate=>record(gate)&&gate.id==='CANARY-MODEL-BUDGET') : null;
  const controls=record(budgetGate)&&record(budgetGate.controls)?budgetGate.controls:null;
  if(!controls||controls.monthlyBudgetUsd!==input.limit)errors.push('Readiness monthlyBudgetUsd must match the AI Gateway project budget limit.');
  if(input.platformSync.status==='applied'&&
    (!text(input.platformSync.lastVerifiedAt)||Number.isNaN(Date.parse(input.platformSync.lastVerifiedAt))||!text(input.platformSync.evidence))){
    errors.push('Applied platform budget requires verification time and evidence.');
  }
  return {
    status:errors.length===0?'valid' as const:'invalid' as const,
    enforcementStatus:input.platformSync.status==='applied'?'platform-applied' as const:'platform-sync-pending' as const,
    errors,
    target:{projectId:input.target.projectId,projectName:input.target.projectName,teamId:input.target.teamId},
    budget:{currency:'USD' as const,limitUsd:input.limit,refreshPeriod:'monthly' as const},
  };
}
