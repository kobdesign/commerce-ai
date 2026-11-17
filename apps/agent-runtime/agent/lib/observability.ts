import { z } from 'zod';
import type { InstrumentationEvent, InstrumentationUsage } from 'eve/instrumentation';

export const commerceAgentTraceVersion='commerce-agent-trace-v1' as const;
export const commerceAgentRedactionPolicyVersion='commerce-agent-metadata-only-v1' as const;

const boundedId=z.string().min(1).max(240);
const uuid=z.string().uuid();
const usageSchema=z.object({
  inputTokens:z.number().int().min(0).nullable(),outputTokens:z.number().int().min(0).nullable(),
  cacheReadTokens:z.number().int().min(0).nullable(),cacheWriteTokens:z.number().int().min(0).nullable(),
  costUsd:z.number().min(0).nullable(),
}).strict();

export const commerceExecutionTraceLinkSchema=z.object({
  schemaVersion:z.literal(commerceAgentTraceVersion),redactionPolicyVersion:z.literal(commerceAgentRedactionPolicyVersion),
  contentCaptured:z.literal(false),tenantId:uuid,executionId:uuid,rootSessionId:boundedId,rootTurnId:boundedId,rootCallId:boundedId,
  agents:z.array(z.enum(['commerce-lead','marketing-analysis','inventory-analysis'])).length(3),
  coreRequestIds:z.array(uuid).length(3),evidenceRefs:z.array(z.string().min(3).max(240)).max(100),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.coreRequestIds).size!==value.coreRequestIds.length)ctx.addIssue({code:'custom',path:['coreRequestIds'],message:'Core request IDs must be unique'});
  if(new Set(value.evidenceRefs).size!==value.evidenceRefs.length)ctx.addIssue({code:'custom',path:['evidenceRefs'],message:'Evidence references must be unique'});
});
export type CommerceExecutionTraceLink=z.infer<typeof commerceExecutionTraceLinkSchema>;

export const safeInstrumentationRecordSchema=z.object({
  schemaVersion:z.literal(commerceAgentTraceVersion),redactionPolicyVersion:z.literal(commerceAgentRedactionPolicyVersion),
  contentCaptured:z.literal(false),eventId:boundedId,eventType:z.string().min(1).max(80),rootSessionId:boundedId.nullable(),
  sessionId:boundedId,turnId:boundedId.nullable(),runId:boundedId.nullable(),attempt:z.number().int().min(0).nullable(),
  agentName:z.string().min(1).max(100).nullable(),parentSessionId:boundedId.nullable(),parentCallId:boundedId.nullable(),
  capabilityKind:z.enum(['tool','agent','skill','control']).nullable(),capabilityName:z.string().min(1).max(160).nullable(),
  modelProvider:z.string().min(1).max(100).nullable(),modelId:z.string().min(1).max(160).nullable(),
  outcome:z.string().min(1).max(80).nullable(),durationMs:z.number().min(0).nullable(),usage:usageSchema.nullable(),
}).strict();
export type SafeInstrumentationRecord=z.infer<typeof safeInstrumentationRecordSchema>;

export const commerceUsageAttributionSchema=z.object({
  schemaVersion:z.literal(commerceAgentTraceVersion),tenantId:uuid,executionId:uuid,rootSessionId:boundedId,
  modelCallCount:z.number().int().min(0),costedModelCallCount:z.number().int().min(0),toolCallCount:z.number().int().min(0),
  inputTokens:z.number().int().min(0),outputTokens:z.number().int().min(0),cacheReadTokens:z.number().int().min(0),cacheWriteTokens:z.number().int().min(0),
  cost:z.object({status:z.enum(['reported','partial','unavailable']),currency:z.literal('USD'),amount:z.number().min(0).nullable(),source:z.literal('provider-reported')}).strict(),
  byAgent:z.array(z.object({agentName:z.string().min(1).max(100),modelCallCount:z.number().int().min(0),inputTokens:z.number().int().min(0),
    outputTokens:z.number().int().min(0),costUsd:z.number().min(0).nullable()}).strict()).max(20),
}).strict();
export type CommerceUsageAttribution=z.infer<typeof commerceUsageAttributionSchema>;

function safeUsage(usage:InstrumentationUsage|undefined){
  if(!usage)return null;
  return usageSchema.parse({inputTokens:usage.inputTokens??null,outputTokens:usage.outputTokens??null,
    cacheReadTokens:usage.inputTokenDetails?.cacheReadTokens??null,cacheWriteTokens:usage.inputTokenDetails?.cacheWriteTokens??null,
    costUsd:usage.costUsd??null});
}

/**
 * Projects an eve event to an allow-listed metadata record. Inputs, outputs,
 * errors, provider metadata, prompts, responses and principal identifiers are
 * intentionally unreachable from the returned shape.
 */
export function projectSafeInstrumentationEvent(event:InstrumentationEvent):SafeInstrumentationRecord{
  const common={schemaVersion:commerceAgentTraceVersion,redactionPolicyVersion:commerceAgentRedactionPolicyVersion,
    contentCaptured:false as const,eventId:event.idempotencyKey,eventType:event.type,rootSessionId:null as string|null,sessionId:'',turnId:null as string|null,
    runId:null as string|null,attempt:null as number|null,agentName:null as string|null,parentSessionId:null as string|null,parentCallId:null as string|null,
    capabilityKind:null as 'tool'|'agent'|'skill'|'control'|null,capabilityName:null as string|null,modelProvider:null as string|null,
    modelId:null as string|null,outcome:null as string|null,durationMs:null as number|null,usage:null as z.infer<typeof usageSchema>|null};
  if(event.type==='session.started')return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.rootSessionId,sessionId:event.sessionId,
    agentName:event.agentName??null,parentSessionId:event.parentLineage?.sessionId??null,parentCallId:event.parentLineage?.callId??null});
  if(event.type==='session.ended')return safeInstrumentationRecordSchema.parse({...common,sessionId:event.sessionId,
    turnId:event.turnId??null,outcome:event.outcome});
  if(event.type==='turn.started')return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.rootSessionId,sessionId:event.sessionId,
    turnId:event.turnId,agentName:event.agentName??null,parentSessionId:event.parentLineage?.sessionId??null,parentCallId:event.parentLineage?.callId??null});
  if(event.type==='turn.settled')return safeInstrumentationRecordSchema.parse({...common,sessionId:event.sessionId,
    turnId:event.turnId,outcome:event.outcome});
  if(event.type==='call.requested')return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.scope.rootSessionId,sessionId:event.scope.sessionId,
    turnId:event.scope.turnId??null,runId:event.scope.runId,attempt:event.scope.attempt,capabilityKind:event.capability.kind,
    capabilityName:event.capability.name});
  if(event.type==='call.settled')return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.scope.rootSessionId,sessionId:event.scope.sessionId,
    turnId:event.scope.turnId??null,runId:event.scope.runId,attempt:event.scope.attempt,outcome:event.outcome,durationMs:event.durationMs??null,
    usage:safeUsage(event.usage)});
  if(event.type==='model.call.started')return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.scope.rootSessionId,sessionId:event.scope.sessionId,
    turnId:event.scope.turnId??null,runId:event.scope.runId,attempt:event.scope.attempt,modelProvider:event.model.provider,modelId:event.model.modelId});
  if(event.type==='model.call.settled')return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.scope.rootSessionId,sessionId:event.scope.sessionId,
    turnId:event.scope.turnId??null,runId:event.scope.runId,attempt:event.scope.attempt,outcome:event.outcome,
    usage:event.outcome==='completed'?safeUsage(event.usage):null});
  if('scope' in event)return safeInstrumentationRecordSchema.parse({...common,rootSessionId:event.scope.rootSessionId,sessionId:event.scope.sessionId,
    turnId:event.scope.turnId??null,runId:event.scope.runId,attempt:event.scope.attempt,outcome:'outcome' in event?String(event.outcome):null});
  const sessionId='sessionId' in event?event.sessionId:'unknown-session';
  return safeInstrumentationRecordSchema.parse({...common,sessionId});
}

export function buildCommerceExecutionTraceLink(input:{tenantId:string;executionId:string;rootSessionId:string;rootTurnId:string;rootCallId:string;
  coreRequestIds:string[];evidenceRefs:string[]}):CommerceExecutionTraceLink{
  return commerceExecutionTraceLinkSchema.parse({...input,schemaVersion:commerceAgentTraceVersion,
    redactionPolicyVersion:commerceAgentRedactionPolicyVersion,contentCaptured:false,
    agents:['commerce-lead','marketing-analysis','inventory-analysis']});
}

/** Aggregates provider-call usage once, avoiding double counting subagent call summaries. */
export function attributeCommerceUsage(link:CommerceExecutionTraceLink,records:SafeInstrumentationRecord[]):CommerceUsageAttribution{
  const traceRecords=records.filter(record=>record.rootSessionId===link.rootSessionId);
  const agentBySession=new Map(traceRecords.filter(record=>record.agentName!==null).map(record=>[record.sessionId,record.agentName as string]));
  const modelCalls=traceRecords.filter(record=>record.eventType==='model.call.settled'&&record.outcome==='completed');
  const byAgentMap=new Map<string,{agentName:string;modelCallCount:number;inputTokens:number;outputTokens:number;costUsd:number;costed:number}>();
  let inputTokens=0,outputTokens=0,cacheReadTokens=0,cacheWriteTokens=0,costUsd=0,costedModelCallCount=0;
  for(const record of modelCalls){
    const usage=record.usage;inputTokens+=usage?.inputTokens??0;outputTokens+=usage?.outputTokens??0;
    cacheReadTokens+=usage?.cacheReadTokens??0;cacheWriteTokens+=usage?.cacheWriteTokens??0;
    if(usage?.costUsd!==null&&usage?.costUsd!==undefined){costUsd+=usage.costUsd;costedModelCallCount++;}
    const agentName=agentBySession.get(record.sessionId)??'unknown-agent';
    const item=byAgentMap.get(agentName)??{agentName,modelCallCount:0,inputTokens:0,outputTokens:0,costUsd:0,costed:0};
    item.modelCallCount++;item.inputTokens+=usage?.inputTokens??0;item.outputTokens+=usage?.outputTokens??0;
    if(usage?.costUsd!==null&&usage?.costUsd!==undefined){item.costUsd+=usage.costUsd;item.costed++;}byAgentMap.set(agentName,item);
  }
  const status=modelCalls.length===0||costedModelCallCount===0?'unavailable':costedModelCallCount===modelCalls.length?'reported':'partial';
  return commerceUsageAttributionSchema.parse({schemaVersion:commerceAgentTraceVersion,tenantId:link.tenantId,executionId:link.executionId,
    rootSessionId:link.rootSessionId,modelCallCount:modelCalls.length,costedModelCallCount,
    toolCallCount:traceRecords.filter(record=>record.eventType==='call.requested'&&record.capabilityKind==='tool').length,
    inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,cost:{status,currency:'USD',amount:status==='unavailable'?null:costUsd,source:'provider-reported'},
    byAgent:[...byAgentMap.values()].sort((a,b)=>a.agentName.localeCompare(b.agentName)).map(item=>({agentName:item.agentName,
      modelCallCount:item.modelCallCount,inputTokens:item.inputTokens,outputTokens:item.outputTokens,costUsd:item.costed===0?null:item.costUsd}))});
}

export function traceAttributeIsSensitive(key:string){
  return /(?:authorization|cookie|secret|token|credential|password|api[._-]?key|email|phone|address|customer|buyer|prompt|message|input|output|response|reasoning)/i.test(key);
}
