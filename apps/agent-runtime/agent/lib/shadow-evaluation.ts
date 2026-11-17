import { z } from 'zod';
import type { PromotionRecommendation } from './promotion-analysis.ts';

export const eveShadowEvaluationVersion='eve-shadow-eval-v1' as const;
const uuid=z.string().uuid();
const action=z.enum(['promote','hold']);
export const shadowEvaluationCaseSchema=z.object({
  id:z.string().regex(/^EV-SH-\d{2}$/),title:z.string().min(1).max(200),question:z.string().min(5).max(500),
  period:z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict(),
  tenantId:uuid,shopId:uuid,productId:uuid,variantId:uuid,
  requestIds:z.object({products:uuid,sales:uuid,inventory:uuid}).strict(),name:z.string().min(1).max(150),sku:z.string().min(1).max(64),
  sales:z.object({quantity:z.number().int().min(0),orderCount:z.number().int().min(0),grossSalesMinor:z.number().int().min(0)}).strict(),
  stock:z.object({onHand:z.number().int().min(0),reserved:z.number().int().min(0),available:z.number().int().min(0),
    safetyStock:z.number().int().min(0),distributable:z.number().int().min(0)}).strict(),
  specialists:z.object({marketingSignal:z.enum(['strong','moderate','exploratory']),inventoryRisk:z.enum(['low','medium','high','unknown']),eligible:z.boolean()}).strict(),
  expected:z.object({action,stockRisk:z.enum(['low','medium','high']),promotionCapacity:z.number().int().min(0)}).strict(),
}).strict().superRefine((value,ctx)=>{
  if(value.stock.available!==Math.max(0,value.stock.onHand-value.stock.reserved))ctx.addIssue({code:'custom',path:['stock','available'],message:'available is inconsistent'});
  if(value.stock.distributable!==Math.max(0,value.stock.available-value.stock.safetyStock))ctx.addIssue({code:'custom',path:['stock','distributable'],message:'distributable is inconsistent'});
});
export type ShadowEvaluationCase=z.infer<typeof shadowEvaluationCaseSchema>;
export const shadowEvaluationDatasetSchema=z.object({version:z.literal(eveShadowEvaluationVersion),synthetic:z.literal(true),
  userVisibleEngine:z.literal('legacy'),cases:z.array(shadowEvaluationCaseSchema).min(3).max(25)}).strict().superRefine((value,ctx)=>{
    if(new Set(value.cases.map(item=>item.id)).size!==value.cases.length)ctx.addIssue({code:'custom',path:['cases'],message:'Case IDs must be unique'});
  });
export type ShadowEvaluationDataset=z.infer<typeof shadowEvaluationDatasetSchema>;

const operationalMetricsSchema=z.object({localHarnessLatencyMs:z.number().min(0),productionComparable:z.literal(false),
  inputTokens:z.number().int().min(0).nullable(),outputTokens:z.number().int().min(0).nullable(),costUsd:z.number().min(0).nullable()}).strict();
export const shadowRunSchema=z.object({datasetVersion:z.literal(eveShadowEvaluationVersion),caseId:z.string().regex(/^EV-SH-\d{2}$/),
  engine:z.enum(['legacy','eve']),mode:z.literal('synthetic-deterministic'),userVisible:z.boolean(),status:z.enum(['completed','rejected','failed']),
  recommendations:z.array(z.object({variantId:uuid,action,stockRisk:z.enum(['low','medium','high']).nullable(),promotionCapacity:z.number().int().min(0).nullable(),
    evidenceRefs:z.array(z.string().min(3).max(240)).max(20)}).strict()).max(10),
  sourceRequestIds:z.array(uuid).max(3),limitations:z.array(z.string().min(1).max(300)).max(10),mutationsAttempted:z.literal(0),
  metrics:operationalMetricsSchema,
}).strict();
export type ShadowRun=z.infer<typeof shadowRunSchema>;

export const shadowEvaluationResultSchema=z.object({caseId:z.string(),engine:z.enum(['legacy','eve']),passed:z.boolean(),
  correctnessRate:z.number().min(0).max(1),groundingRate:z.number().min(0).max(1),stockoutSafetyPassed:z.boolean(),
  checks:z.array(z.object({id:z.enum(['contract','correctness','grounding','stockout_safety','read_only','visibility']),critical:z.boolean(),passed:z.boolean(),detail:z.string()}).strict()),
  criticalFailures:z.array(z.string()),metrics:operationalMetricsSchema}).strict();
export type ShadowEvaluationResult=z.infer<typeof shadowEvaluationResultSchema>;

export const shadowComparisonReportSchema=z.object({version:z.literal(eveShadowEvaluationVersion),synthetic:z.literal(true),
  comparisonKind:z.literal('system-capability-shadow'),userVisibleEngine:z.literal('legacy'),cases:z.number().int().min(1),
  passed:z.boolean(),releaseDecision:z.literal('continue-to-rollback-rehearsal'),productionDecision:z.literal('no-go'),
  liveMetricsAvailable:z.literal(false),legacy:z.object({criticalFailures:z.number().int().min(0),averageCorrectness:z.number().min(0).max(1),averageGrounding:z.number().min(0).max(1)}).strict(),
  eve:z.object({criticalFailures:z.number().int().min(0),averageCorrectness:z.number().min(0).max(1),averageGrounding:z.number().min(0).max(1)}).strict(),
  results:z.array(shadowEvaluationResultSchema),limitations:z.array(z.string()).min(1)}).strict();
export type ShadowComparisonReport=z.infer<typeof shadowComparisonReportSchema>;

export function legacyCatalogOnlyShadowRun(item:ShadowEvaluationCase,latencyMs:number):ShadowRun{
  return shadowRunSchema.parse({datasetVersion:eveShadowEvaluationVersion,caseId:item.id,engine:'legacy',mode:'synthetic-deterministic',userVisible:true,status:'completed',
    recommendations:[],sourceRequestIds:[item.requestIds.products],mutationsAttempted:0,
    limitations:['Legacy catalog analysis has no sales or inventory evidence and therefore makes no promotion decision.',
      'This fallback is the user-visible baseline during shadow evaluation.'],
    metrics:{localHarnessLatencyMs:latencyMs,productionComparable:false,inputTokens:null,outputTokens:null,costUsd:null}});
}

export function evePromotionShadowRun(item:ShadowEvaluationCase,result:PromotionRecommendation,latencyMs:number):ShadowRun{
  return shadowRunSchema.parse({datasetVersion:eveShadowEvaluationVersion,caseId:item.id,engine:'eve',mode:'synthetic-deterministic',userVisible:false,status:'completed',
    recommendations:result.recommendations.map(recommendation=>({variantId:recommendation.variantId,action:recommendation.action,
      stockRisk:recommendation.stockRisk,promotionCapacity:recommendation.stockConstraint.promotionCapacity,evidenceRefs:recommendation.evidenceRefs})),
    sourceRequestIds:result.sourceRequestIds,limitations:result.limitations,mutationsAttempted:0,
    metrics:{localHarnessLatencyMs:latencyMs,productionComparable:false,inputTokens:null,outputTokens:null,costUsd:null}});
}

export function evaluateShadowRun(item:ShadowEvaluationCase,run:ShadowRun):ShadowEvaluationResult{
  const recommendation=run.recommendations.find(value=>value.variantId===item.variantId);
  const correctness=Number(recommendation?.action===item.expected.action&&recommendation.stockRisk===item.expected.stockRisk&&
    recommendation.promotionCapacity===item.expected.promotionCapacity);
  const expectedRequests=new Set(Object.values(item.requestIds));
  const sourceGrounding=run.engine==='eve'&&run.sourceRequestIds.length===3&&run.sourceRequestIds.every(id=>expectedRequests.has(id));
  const evidenceGrounding=run.engine==='eve'&&!!recommendation&&recommendation.evidenceRefs.length>=4&&
    recommendation.evidenceRefs.every(ref=>ref.includes(item.productId)||ref.includes(item.variantId)||ref.startsWith('sales_aggregate:'));
  const grounding=Number(sourceGrounding&&evidenceGrounding);
  const stockoutSafety=!(item.expected.promotionCapacity===0&&recommendation?.action==='promote');
  const checks=[
    {id:'contract' as const,critical:true,passed:run.status==='completed',detail:'Run must complete under the versioned shadow contract.'},
    {id:'correctness' as const,critical:run.engine==='eve',passed:correctness===1,detail:'Action, stock risk and promotion capacity must match the deterministic expectation.'},
    {id:'grounding' as const,critical:run.engine==='eve',passed:grounding===1,detail:'Eve recommendations must resolve to all three Core requests and item evidence.'},
    {id:'stockout_safety' as const,critical:true,passed:stockoutSafety,detail:'A zero-capacity SKU must never be promoted.'},
    {id:'read_only' as const,critical:true,passed:run.mutationsAttempted===0,detail:'Shadow execution must make no mutation attempt.'},
    {id:'visibility' as const,critical:true,passed:run.userVisible===(run.engine==='legacy'),detail:'Legacy remains visible and Eve remains shadow-only.'},
  ];
  return shadowEvaluationResultSchema.parse({caseId:item.id,engine:run.engine,passed:checks.every(check=>check.passed),
    correctnessRate:correctness,groundingRate:grounding,stockoutSafetyPassed:stockoutSafety,checks,
    criticalFailures:checks.filter(check=>check.critical&&!check.passed).map(check=>check.id),metrics:run.metrics});
}

function average(values:number[]){return values.length===0?0:values.reduce((sum,value)=>sum+value,0)/values.length;}
export function compareShadowRuns(dataset:ShadowEvaluationDataset,runs:ShadowRun[]):ShadowComparisonReport{
  const results=dataset.cases.flatMap(item=>['legacy','eve'].map(engine=>{
    const run=runs.find(candidate=>candidate.caseId===item.id&&candidate.engine===engine);
    if(!run)throw new Error(`Missing ${engine} shadow run for ${item.id}`);
    return evaluateShadowRun(item,run);
  }));
  const summarize=(engine:'legacy'|'eve')=>{const selected=results.filter(result=>result.engine===engine);return {
    criticalFailures:selected.reduce((sum,result)=>sum+result.criticalFailures.length,0),
    averageCorrectness:average(selected.map(result=>result.correctnessRate)),averageGrounding:average(selected.map(result=>result.groundingRate))};};
  const legacy=summarize('legacy'),eve=summarize('eve');
  return shadowComparisonReportSchema.parse({version:eveShadowEvaluationVersion,synthetic:true,comparisonKind:'system-capability-shadow',
    userVisibleEngine:dataset.userVisibleEngine,cases:dataset.cases.length,passed:eve.criticalFailures===0,
    releaseDecision:'continue-to-rollback-rehearsal',productionDecision:'no-go',liveMetricsAvailable:false,legacy,eve,results,
    limitations:['Legacy and Eve do not have equivalent tools; this compares system capability, not model quality alone.',
      'No live model ran, so token usage and provider cost are null rather than estimated.',
      'Local harness latency is measured but is not comparable to Vercel, Render or provider production latency.']});
}
