export const requiredProductionDecisionIds=[
  'DEC-03-IDENTITY','DEC-03-EVIDENCE-STORAGE','DEC-03-RETENTION','DEC-03-BACKUP-RECOVERY','DEC-04-AI-POLICY','OPS-ALERT-OWNERSHIP',
] as const;
export type ProductionDecisionStatus='proposed'|'approved'|'rejected';
export type ProductionDecision={
  id:string;status:ProductionDecisionStatus;recommendedOption:string;ownerRole:string;requiredBefore:string;
  selectedOption:string|null;approvedBy:string[];approvedAt:string|null;evidence:string[];
};
export type ProductionDecisionManifest={schemaVersion:number;reviewedAt:string;decisions:ProductionDecision[]};

function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function string(value:unknown){return typeof value==='string'&&value.trim().length>0;}
function decision(value:unknown):value is ProductionDecision{
  if(!record(value))return false;
  return string(value.id)&&['proposed','approved','rejected'].includes(String(value.status))&&string(value.recommendedOption)&&string(value.ownerRole)&&string(value.requiredBefore)
    &&(value.selectedOption===null||string(value.selectedOption))&&Array.isArray(value.approvedBy)&&value.approvedBy.every(string)
    &&(value.approvedAt===null||string(value.approvedAt))&&Array.isArray(value.evidence)&&value.evidence.every(string);
}

export function productionDecisionGate(input:unknown){
  const errors:string[]=[];
  if(!record(input)||input.schemaVersion!==1||!string(input.reviewedAt)||!Array.isArray(input.decisions)){
    return {status:'blocked' as const,errors:['Invalid production decision manifest.'],decisions:[]};
  }
  const decisions=input.decisions.filter(decision);
  if(decisions.length!==input.decisions.length)errors.push('One or more decisions have an invalid shape.');
  const ids=new Set(decisions.map(item=>item.id));
  for(const id of requiredProductionDecisionIds)if(!ids.has(id))errors.push(`Missing decision ${id}.`);
  if(ids.size!==decisions.length)errors.push('Decision IDs must be unique.');
  for(const item of decisions){
    if(item.status==='approved'){
      if(!item.selectedOption)errors.push(`${item.id} is approved without a selected option.`);
      if(new Set(item.approvedBy.map(approver=>approver.trim())).size<2)errors.push(`${item.id} requires at least two distinct approvers.`);
      if(!item.approvedAt||Number.isNaN(Date.parse(item.approvedAt)))errors.push(`${item.id} requires a valid approval timestamp.`);
      if(item.evidence.length===0)errors.push(`${item.id} requires approval evidence.`);
    }
  }
  const summary=decisions.map(({id,status,recommendedOption,selectedOption,requiredBefore})=>({id,status,recommendedOption,selectedOption,requiredBefore}));
  const ready=errors.length===0&&requiredProductionDecisionIds.every(id=>decisions.find(item=>item.id===id)?.status==='approved');
  return {status:ready?'approved' as const:'blocked' as const,errors,decisions:summary};
}
