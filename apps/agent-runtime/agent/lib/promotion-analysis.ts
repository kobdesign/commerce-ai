import { z } from 'zod';
import {
  evidenceReferenceSchema,inventoryReadResponseSchema,productReadResponseSchema,salesReadResponseSchema,
} from '@commerce/agent-contracts';
import {
  resolvedEvidenceReferenceSchema,verifyAgentEvidenceBundle,type ResolvedEvidenceReference,
} from '@commerce/agent-evidence';
import type { CommerceScope } from './commerce-scope.ts';
import { buildCommerceExecutionTraceLink,commerceExecutionTraceLinkSchema } from './observability.ts';

const uuid=z.string().uuid();
const evidenceRef=z.string().regex(/^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/);
async function workflowIdempotencyId(idempotencyKey:string,operation:string){
  const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(`commerce-agent-idempotency-v1\n${operation}\n${idempotencyKey}`))).slice(0,16);
  digest[6]=(digest[6]&0x0f)|0x50;digest[8]=(digest[8]&0x3f)|0x80;
  const hex=[...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const promotionPeriodSchema=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict();

export const marketingAnalysisSchema=z.object({
  candidates:z.array(z.object({productId:uuid,variantId:uuid,sku:z.string().min(1).max(64),
    signal:z.enum(['strong','moderate','exploratory']),rationale:z.string().min(1).max(400),
    evidenceRefs:z.array(evidenceRef).min(1).max(10),}).strict()).max(10),
  limitations:z.array(z.string().min(1).max(240)).max(10),
}).strict();
export type MarketingAnalysis=z.infer<typeof marketingAnalysisSchema>;

export const inventoryAnalysisSchema=z.object({
  assessments:z.array(z.object({productId:uuid,variantId:uuid,sku:z.string().min(1).max(64),
    risk:z.enum(['low','medium','high','unknown']),eligible:z.boolean(),rationale:z.string().min(1).max(400),
    evidenceRefs:z.array(evidenceRef).min(1).max(10),}).strict()).max(10),
  limitations:z.array(z.string().min(1).max(240)).max(10),
}).strict();
export type InventoryAnalysis=z.infer<typeof inventoryAnalysisSchema>;

const constraintReasonSchema=z.enum(['no_distributable_stock','specialist_ineligible','specialist_high_or_unknown_risk']);
const stockConstraintSchema=z.object({policyVersion:z.literal('promotion-stockout-v1'),onHand:z.number().int().min(0),
  reserved:z.number().int().min(0),available:z.number().int().min(0),safetyStock:z.number().int().min(0),
  distributable:z.number().int().min(0),promotionCapacity:z.number().int().min(0),blocked:z.boolean(),
  reasons:z.array(constraintReasonSchema).max(3),}).strict().superRefine((value,ctx)=>{
    if(value.available!==Math.max(0,value.onHand-value.reserved))ctx.addIssue({code:'custom',path:['available'],message:'Available stock is inconsistent'});
    if(value.distributable!==Math.max(0,value.available-value.safetyStock))ctx.addIssue({code:'custom',path:['distributable'],message:'Distributable stock is inconsistent'});
    if(value.promotionCapacity!==value.distributable)ctx.addIssue({code:'custom',path:['promotionCapacity'],message:'Promotion capacity must equal distributable stock'});
    if(value.blocked!==(value.reasons.length>0))ctx.addIssue({code:'custom',path:['blocked'],message:'Blocked must reflect constraint reasons'});
  });

const recommendationSchema=z.object({
  productId:uuid,variantId:uuid,sku:z.string().min(1).max(64),productName:z.string().min(1).max(150),
  action:z.enum(['promote','hold']),marketingSignal:z.enum(['strong','moderate','exploratory']),stockRisk:z.enum(['low','medium','high']),
  salesObserved:z.boolean(),salesQuantity:z.number().int().min(0),orderCount:z.number().int().min(0),grossSalesMinor:z.number().int().min(0),
  onHand:z.number().int().min(0),reserved:z.number().int().min(0),available:z.number().int().min(0),safetyStock:z.number().int().min(0),distributable:z.number().int().min(0),
  stockConstraint:stockConstraintSchema,decisionReason:z.string().min(1).max(500),
  evidence:z.array(evidenceReferenceSchema).min(4).max(20),evidenceRefs:z.array(evidenceRef).min(4).max(20),
}).strict().superRefine((value,ctx)=>{
  if(value.action==='promote'&&value.stockConstraint.blocked)ctx.addIssue({code:'custom',path:['action'],message:'A blocked SKU cannot be promoted'});
  if(value.action==='hold'&&!value.stockConstraint.blocked)ctx.addIssue({code:'custom',path:['action'],message:'A held SKU must identify a stock constraint'});
  for(const key of ['onHand','reserved','available','safetyStock','distributable'] as const){
    if(value[key]!==value.stockConstraint[key])ctx.addIssue({code:'custom',path:[key],message:'Stock fact must match the verified constraint'});
  }
});

const evidenceSourceSchema=z.object({resource:z.enum(['products','sales','inventory']),requestId:uuid,
  asOf:z.string().datetime({offset:true}),dataVersion:z.string().min(1).max(100),limitations:z.array(z.string().min(1).max(240)).max(20)}).strict();

export const promotionRecommendationSchema=z.object({
  question:z.string().min(1).max(500),period:promotionPeriodSchema,scope:z.object({shopIds:z.array(uuid).min(1).max(20)}).strict(),
  execution:z.object({id:uuid,idempotencyVersion:z.literal('eve-commerce-v1')}).strict(),
  asOf:z.string().datetime({offset:true}),verifiedAt:z.string().datetime({offset:true}),isSynthetic:z.literal(true),
  recommendations:z.array(recommendationSchema).max(10),limitations:z.array(z.string().min(1).max(240)).max(20),
  sourceRequestIds:z.array(uuid).length(3),sources:z.array(evidenceSourceSchema).length(3),
  evidenceManifest:z.array(resolvedEvidenceReferenceSchema).max(100),
  trace:commerceExecutionTraceLinkSchema,
  evidenceCompleteness:z.object({status:z.literal('verified'),recommendationCount:z.number().int().min(0).max(10),
    resolvedReferenceCount:z.number().int().min(0).max(100),unresolvedReferenceCount:z.literal(0)}).strict(),
}).strict().superRefine((value,ctx)=>{
  const manifest=new Map(value.evidenceManifest.map(item=>[item.ref,item]));
  if(manifest.size!==value.evidenceManifest.length)ctx.addIssue({code:'custom',path:['evidenceManifest'],message:'Evidence manifest references must be unique'});
  if(new Set(value.sources.map(source=>source.resource)).size!==3)ctx.addIssue({code:'custom',path:['sources'],message:'Sources must contain products, sales and inventory exactly once'});
  const sources=new Map(value.sources.map(source=>[source.requestId,source]));
  for(const [index,item] of value.evidenceManifest.entries()){
    const source=sources.get(item.sourceRequestId);
    if(!source||source.resource!==item.resource||source.asOf!==item.responseAsOf||source.dataVersion!==item.dataVersion){
      ctx.addIssue({code:'custom',path:['evidenceManifest',index],message:'Evidence provenance does not match source metadata'});
    }
  }
  const used=new Set<string>();
  for(const [index,recommendation] of value.recommendations.entries()){
    if(new Set(recommendation.evidenceRefs).size!==recommendation.evidenceRefs.length)ctx.addIssue({code:'custom',path:['recommendations',index,'evidenceRefs'],message:'Evidence references must be unique'});
    const requiredKinds=new Set(['product','variant','inventory_balance','inventory_policy']);
    for(const ref of recommendation.evidenceRefs){
      used.add(ref);const item=manifest.get(ref);
      if(!item)ctx.addIssue({code:'custom',path:['recommendations',index,'evidenceRefs'],message:`Evidence reference ${ref} is unresolved`});
      else if(item.variantId!==recommendation.variantId||item.productId!==recommendation.productId)ctx.addIssue({code:'custom',path:['recommendations',index,'evidenceRefs'],message:`Evidence reference ${ref} belongs to another item`});
      else requiredKinds.delete(item.kind);
    }
    if(requiredKinds.size>0)ctx.addIssue({code:'custom',path:['recommendations',index,'evidenceRefs'],message:`Required evidence kinds are missing: ${[...requiredKinds].join(', ')}`});
    const envelopeRefs=new Set(recommendation.evidence.map(item=>item.ref));
    if(envelopeRefs.size!==recommendation.evidenceRefs.length||recommendation.evidenceRefs.some(ref=>!envelopeRefs.has(ref))){
      ctx.addIssue({code:'custom',path:['recommendations',index,'evidence'],message:'Evidence envelopes and references must match'});
    }
  }
  if(manifest.size!==used.size)ctx.addIssue({code:'custom',path:['evidenceManifest'],message:'Evidence manifest must contain only recommendation evidence'});
  if(used.size!==value.evidenceCompleteness.resolvedReferenceCount)ctx.addIssue({code:'custom',path:['evidenceCompleteness','resolvedReferenceCount'],message:'Resolved count must match recommendation evidence'});
  if(value.recommendations.length!==value.evidenceCompleteness.recommendationCount)ctx.addIssue({code:'custom',path:['evidenceCompleteness','recommendationCount'],message:'Recommendation count is inconsistent'});
  if(value.sourceRequestIds.join('|')!==value.sources.map(source=>source.requestId).join('|'))ctx.addIssue({code:'custom',path:['sourceRequestIds'],message:'Source request IDs must match source metadata'});
});
export type PromotionRecommendation=z.infer<typeof promotionRecommendationSchema>;

type ProductResponse=z.infer<typeof productReadResponseSchema>;
type SalesResponse=z.infer<typeof salesReadResponseSchema>;
type InventoryResponse=z.infer<typeof inventoryReadResponseSchema>;
export type VerifiedPromotionEvidence={products:ProductResponse;sales:SalesResponse;inventory:InventoryResponse};

function uniqueEvidence(items:z.infer<typeof evidenceReferenceSchema>[][]){
  const byRef=new Map<string,z.infer<typeof evidenceReferenceSchema>>();
  for(const item of items.flat())byRef.set(item.ref,item);
  return [...byRef.values()];
}
function riskFromVerifiedStock(item:InventoryResponse['items'][number]):'low'|'medium'|'high'{
  if(item.distributable===0)return 'high';
  if(item.safetyStock>0&&item.distributable<=item.safetyStock)return 'medium';
  return 'low';
}
function evidenceResolvesForVariant(refs:string[],resolved:Map<string,ResolvedEvidenceReference>,variantId:string,kinds:string[]){
  return refs.length>0&&refs.every(ref=>resolved.get(ref)?.variantId===variantId)&&refs.some(ref=>kinds.includes(resolved.get(ref)?.kind??''));
}

/** Final facts come only from cryptographically verified, scope-bound Commerce API snapshots. */
export async function consolidatePromotionAnalysis(input:{question:string;period:z.infer<typeof promotionPeriodSchema>;scope:CommerceScope;
  marketing:MarketingAnalysis;inventory:InventoryAnalysis;verified:VerifiedPromotionEvidence;executionId?:string;
  traceContext?:{rootSessionId:string;rootTurnId:string;rootCallId:string}},
  options:{now?:Date;verifiedAt?:string;maximumSnapshotAgeMs?:number}={}):Promise<PromotionRecommendation>{
  const responses=[input.verified.products,input.verified.sales,input.verified.inventory];
  if(responses.some(response=>!response.isSynthetic))throw new Error('EVE POC requires synthetic Commerce responses.');
  const verifiedBundle=await verifyAgentEvidenceBundle(input.verified,{expectedShopIds:input.scope.shopIds,now:options.now,maximumSnapshotAgeMs:options.maximumSnapshotAgeMs});
  const resolved=new Map(verifiedBundle.manifest.map(item=>[item.ref,item]));
  const products=new Map(input.verified.products.items.map(item=>[item.variantId,item]));
  const inventoryItems=new Map(input.verified.inventory.items.map(item=>[item.variantId,item]));
  const assessments=new Map(input.inventory.assessments.map(item=>[item.variantId,item]));
  const salesByVariant=new Map<string,SalesResponse['items'][number]>();
  for(const sale of input.verified.sales.items){
    if(sale.period.from!==input.period.from||sale.period.to!==input.period.to)throw new Error('Verified sales evidence does not match the requested period.');
    const prior=salesByVariant.get(sale.variantId);
    if(!prior)salesByVariant.set(sale.variantId,{...sale});
    else salesByVariant.set(sale.variantId,{...prior,quantity:prior.quantity+sale.quantity,orderCount:prior.orderCount+sale.orderCount,
      grossSalesMinor:prior.grossSalesMinor+sale.grossSalesMinor,evidence:uniqueEvidence([prior.evidence,sale.evidence])});
  }
  const limitations=new Set([...input.verified.products.limitations,...input.verified.sales.limitations,...input.verified.inventory.limitations,
    ...input.marketing.limitations,...input.inventory.limitations]);
  const recommendations=[] as z.infer<typeof recommendationSchema>[];
  const usedEvidenceRefs=new Set<string>();
  for(const candidate of input.marketing.candidates){
    const product=products.get(candidate.variantId);const stock=inventoryItems.get(candidate.variantId);const assessment=assessments.get(candidate.variantId);
    if(!product||!stock||!assessment||product.productId!==candidate.productId||assessment.productId!==candidate.productId||product.sku!==candidate.sku||assessment.sku!==candidate.sku)continue;
    const marketingResolved=evidenceResolvesForVariant(candidate.evidenceRefs,resolved,candidate.variantId,['product','variant','sales_aggregate']);
    const inventoryResolved=evidenceResolvesForVariant(assessment.evidenceRefs,resolved,candidate.variantId,['inventory_balance','inventory_policy']);
    if(!marketingResolved||!inventoryResolved){limitations.add(`Specialist evidence for SKU ${product.sku} did not resolve to the verified Core snapshot; the candidate was excluded.`);continue;}
    const sale=salesByVariant.get(candidate.variantId);const stockRisk=riskFromVerifiedStock(stock);
    const reasons:z.infer<typeof constraintReasonSchema>[]=[];
    if(stock.distributable===0)reasons.push('no_distributable_stock');
    if(!assessment.eligible)reasons.push('specialist_ineligible');
    if(assessment.risk==='high'||assessment.risk==='unknown')reasons.push('specialist_high_or_unknown_risk');
    const action=reasons.length===0?'promote':'hold';
    if(assessment.risk!==stockRisk)limitations.add(`Inventory specialist and deterministic stock policy differed for SKU ${product.sku}; the verified policy result was used.`);
    const evidence=uniqueEvidence([product.evidence,stock.evidence,sale?.evidence??[]]);
    const evidenceRefs=evidence.map(item=>item.ref);evidenceRefs.forEach(ref=>usedEvidenceRefs.add(ref));
    recommendations.push({productId:product.productId,variantId:product.variantId,sku:product.sku,productName:product.name,action,
      marketingSignal:candidate.signal,stockRisk,salesObserved:Boolean(sale),salesQuantity:sale?.quantity??0,orderCount:sale?.orderCount??0,
      grossSalesMinor:sale?.grossSalesMinor??0,onHand:stock.onHand,reserved:stock.reserved,available:stock.available,
      safetyStock:stock.safetyStock,distributable:stock.distributable,
      stockConstraint:{policyVersion:'promotion-stockout-v1',onHand:stock.onHand,reserved:stock.reserved,available:stock.available,
        safetyStock:stock.safetyStock,distributable:stock.distributable,promotionCapacity:stock.distributable,blocked:reasons.length>0,reasons},
      decisionReason:action==='promote'
        ?`Verified distributable stock is ${stock.distributable}; completed-order sales in the selected period total ${sale?.quantity??0} units.`
        :`Hold promotion because verified constraints are ${reasons.join(', ')}; distributable stock is ${stock.distributable}.`,
      evidence,evidenceRefs});
  }
  recommendations.sort((a,b)=>(a.action===b.action?0:a.action==='promote'?-1:1)||b.grossSalesMinor-a.grossSalesMinor||b.distributable-a.distributable||a.sku.localeCompare(b.sku));
  const evidenceManifest=verifiedBundle.manifest.filter(item=>usedEvidenceRefs.has(item.ref));
  const verifiedAt=options.verifiedAt??(options.now??new Date()).toISOString();
  const executionId=input.executionId??await workflowIdempotencyId(verifiedBundle.sources.map(source=>source.requestId).join(':'),'promotion-execution');
  const trace=buildCommerceExecutionTraceLink({tenantId:input.scope.tenantId,executionId,
    rootSessionId:input.traceContext?.rootSessionId??`synthetic:${executionId}`,
    rootTurnId:input.traceContext?.rootTurnId??`synthetic:${executionId}:turn`,rootCallId:input.traceContext?.rootCallId??`synthetic:${executionId}:call`,
    coreRequestIds:verifiedBundle.sources.map(source=>source.requestId),evidenceRefs:evidenceManifest.map(item=>item.ref)});
  return promotionRecommendationSchema.parse({question:input.question,period:input.period,scope:{shopIds:input.scope.shopIds},
    execution:{id:executionId,idempotencyVersion:'eve-commerce-v1'},asOf:verifiedBundle.asOf,verifiedAt,isSynthetic:true,
    recommendations,limitations:[...limitations].slice(0,20),
    sourceRequestIds:verifiedBundle.sources.map(source=>source.requestId),sources:verifiedBundle.sources,evidenceManifest,trace,
    evidenceCompleteness:{status:'verified',recommendationCount:recommendations.length,resolvedReferenceCount:usedEvidenceRefs.size,unresolvedReferenceCount:0}});
}

export type PromotionExecutionIdentity={id:string;key:string;snapshotAt:string;rootSessionId:string;rootTurnId:string;rootCallId:string};

export async function preparePromotionExecution(input:{sessionId:string;turnId:string;callId:string},now:Date=new Date()):Promise<PromotionExecutionIdentity>{
  'use step';
  const key=`eve:${input.sessionId}:${input.turnId}:${input.callId}`;
  return {id:await workflowIdempotencyId(key,'promotion-execution'),key,snapshotAt:now.toISOString(),
    rootSessionId:input.sessionId,rootTurnId:input.turnId,rootCallId:input.callId};
}

export async function verifyAndConsolidatePromotion(input:{question:string;period:z.infer<typeof promotionPeriodSchema>;scope:CommerceScope;
  marketing:MarketingAnalysis;inventory:InventoryAnalysis;execution:PromotionExecutionIdentity}){
  'use step';
  const variantIds=[...new Set([...input.marketing.candidates.map(item=>item.variantId),...input.inventory.assessments.map(item=>item.variantId)])].slice(0,20);
  if(variantIds.length===0)throw new Error('Specialists returned no evidence-backed candidate variants.');
  const {commerceClientForScope}=await import('./commerce-client.ts');
  const client=await commerceClientForScope(input.scope);const asOf=input.execution.snapshotAt;
  const common={shopIds:input.scope.shopIds,variantIds,cursor:null,limit:variantIds.length,asOf};
  const [products,sales,inventory]=await Promise.all([
    client.products({...common,search:'',status:'active'},{idempotencyKey:input.execution.key}),
    client.sales({...common,period:input.period,granularity:'variant',orderStates:['completed']},{idempotencyKey:input.execution.key}),
    client.inventory({...common,search:'',availability:'all',includeChannelAllocation:true},{idempotencyKey:input.execution.key}),
  ]);
  return await consolidatePromotionAnalysis({...input,executionId:input.execution.id,verified:{products,sales,inventory},
    traceContext:{rootSessionId:input.execution.rootSessionId,rootTurnId:input.execution.rootTurnId,rootCallId:input.execution.rootCallId}},
    {verifiedAt:input.execution.snapshotAt});
}
