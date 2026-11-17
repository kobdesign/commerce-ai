import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { canonicalAgentEvidenceJson } from '@commerce/agent-evidence';
import { consolidatePromotionAnalysis } from '../agent/lib/promotion-analysis.ts';
import {
  compareShadowRuns,evePromotionShadowRun,legacyCatalogOnlyShadowRun,shadowEvaluationDatasetSchema,
  type ShadowEvaluationCase,type ShadowEvaluationDataset,type ShadowRun,type ShadowComparisonReport,
} from '../agent/lib/shadow-evaluation.ts';

const asOf='2026-11-13T06:05:00.000Z';
const observedAt='2026-11-13T06:00:00.000Z';
const now=new Date('2026-11-13T06:06:00.000Z');

function integrity(item:unknown){return createHash('sha256').update(canonicalAgentEvidenceJson(item)).digest('hex');}
function evidence(kind:'product'|'variant'|'sales_aggregate'|'inventory_balance'|'inventory_policy',ref:string,sourceVersion:string,item:unknown){
  return {kind,ref:`${kind}:${ref}`,observedAt,sourceVersion,integrityHash:integrity(item)} as const;
}
function metadata<Resource extends 'products'|'sales'|'inventory'>(item:ShadowEvaluationCase,resource:Resource){
  return {contractVersion:'commerce-agent-read-v1' as const,resource,requestId:item.requestIds[resource],asOf,
    dataVersion:`${resource}:poc-v1`,isSynthetic:true,scope:{shopIds:[item.shopId]},page:{limit:1,returned:1,hasMore:false,nextCursor:null},
    limitations:[`${resource} synthetic shadow fixture`]};
}
function verifiedEvidence(item:ShadowEvaluationCase){
  const product={productId:item.productId,variantId:item.variantId,name:item.name,sku:item.sku,category:'เสื้อผ้า',salesUnit:'ตัว',
    attributes:{ประเภท:'กางเกงชิโน'},priceMinor:59900,currency:'THB' as const,archived:false,listedShopIds:[item.shopId]};
  const sale={productId:item.productId,variantId:item.variantId,sku:item.sku,productName:item.name,shopId:null,channel:'tiktok' as const,
    period:item.period,...item.sales,currency:'THB' as const};
  const inventory={productId:item.productId,variantId:item.variantId,productName:item.name,sku:item.sku,...item.stock,
    distributionMode:'shared' as const,balanceVersion:1,channels:[]};
  const salesRef=integrity(sale).slice(0,32);
  return {salesRef,verified:{
    products:{...metadata(item,'products'),items:[{...product,evidence:[evidence('product',item.productId,'catalog-v1',product),evidence('variant',item.variantId,'catalog-v1',product)]}]},
    sales:{...metadata(item,'sales'),items:[{...sale,evidence:[evidence('sales_aggregate',salesRef,'sales-aggregate-v1',sale)]}]},
    inventory:{...metadata(item,'inventory'),items:[{...inventory,evidence:[evidence('inventory_balance',item.variantId,'inventory-ledger-v1',inventory),
      evidence('inventory_policy',item.variantId,'inventory-policy-v1',inventory)]}]},
  }};
}

export async function loadSyntheticShadowDataset():Promise<ShadowEvaluationDataset>{
  const raw=JSON.parse(await readFile(new URL('../../../fixtures/eve-shadow-evaluation.json',import.meta.url),'utf8')) as unknown;
  return shadowEvaluationDatasetSchema.parse(raw);
}

export async function runSyntheticShadowEvaluation():Promise<ShadowComparisonReport>{
  const dataset=await loadSyntheticShadowDataset();const runs:ShadowRun[]=[];
  for(const item of dataset.cases){
    const legacyStarted=performance.now();
    runs.push(legacyCatalogOnlyShadowRun(item,performance.now()-legacyStarted));
    const {salesRef,verified}=verifiedEvidence(item);const eveStarted=performance.now();
    const result=await consolidatePromotionAnalysis({question:item.question,period:item.period,scope:{tenantId:item.tenantId,shopIds:[item.shopId]},
      marketing:{candidates:[{productId:item.productId,variantId:item.variantId,sku:item.sku,signal:item.specialists.marketingSignal,
        rationale:'Synthetic specialist fixture',evidenceRefs:[`variant:${item.variantId}`,`sales_aggregate:${salesRef}`]}],limitations:[]},
      inventory:{assessments:[{productId:item.productId,variantId:item.variantId,sku:item.sku,risk:item.specialists.inventoryRisk,
        eligible:item.specialists.eligible,rationale:'Synthetic specialist fixture',evidenceRefs:[`inventory_balance:${item.variantId}`,`inventory_policy:${item.variantId}`]}],limitations:[]},
      verified},{now});
    runs.push(evePromotionShadowRun(item,result,performance.now()-eveStarted));
  }
  return compareShadowRuns(dataset,runs);
}
