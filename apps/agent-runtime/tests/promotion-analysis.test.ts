import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AgentEvidenceVerificationError,canonicalAgentEvidenceJson } from '@commerce/agent-evidence';
import { consolidatePromotionAnalysis,preparePromotionExecution } from '../agent/lib/promotion-analysis.ts';

const ids={tenant:'20000000-0000-4000-8000-000000000001',shop:'30000000-0000-4000-8000-000000000001',
  otherShop:'30000000-0000-4000-8000-000000000099',product:'40000000-0000-4000-8000-000000000001',
  variant:'50000000-0000-4000-8000-000000000001',forgedProduct:'40000000-0000-4000-8000-000000000099',
  forgedVariant:'50000000-0000-4000-8000-000000000099'};
const asOf='2026-11-13T06:05:00.000Z';
const now=new Date('2026-11-13T06:06:00.000Z');
const observedAt='2026-11-13T06:00:00.000Z';
const period={from:'2026-11-01',to:'2026-11-07'};
const requestIds={products:'60000000-0000-4000-8000-000000000001',sales:'60000000-0000-4000-8000-000000000002',inventory:'60000000-0000-4000-8000-000000000003'};

function evidence(kind:'product'|'variant'|'sales_aggregate'|'inventory_balance'|'inventory_policy',ref:string,sourceVersion:string,item:unknown){
  return {kind,ref:`${kind}:${ref}`,observedAt,sourceVersion,integrityHash:createHash('sha256').update(canonicalAgentEvidenceJson(item)).digest('hex')} as const;
}
const productItem=()=>({productId:ids.product,variantId:ids.variant,name:'กางเกงชิโน',sku:'CH-L-BK-32',category:'เสื้อผ้า',salesUnit:'ตัว',
  attributes:{ไซซ์:'32'},priceMinor:59900,currency:'THB' as const,archived:false,listedShopIds:[ids.shop]});
const salesItem=()=>({productId:ids.product,variantId:ids.variant,sku:'CH-L-BK-32',productName:'กางเกงชิโน',shopId:null,
  channel:'tiktok' as const,period,quantity:12,orderCount:10,grossSalesMinor:718800,currency:'THB' as const});
const inventoryItem=(stock={onHand:30,reserved:5,available:25,safetyStock:5,distributable:20})=>({productId:ids.product,variantId:ids.variant,
  productName:'กางเกงชิโน',sku:'CH-L-BK-32',...stock,distributionMode:'shared' as const,balanceVersion:2,channels:[]});
const metadata=<R extends 'products'|'sales'|'inventory'>(resource:R,returned=1)=>({contractVersion:'commerce-agent-read-v1' as const,resource,
  requestId:requestIds[resource],asOf,dataVersion:`${resource}:poc-v1`,isSynthetic:true,scope:{shopIds:[ids.shop]},
  page:{limit:20,returned,hasMore:false,nextCursor:null},limitations:[`${resource} limitation`]});

function verifiedFixture(stock?:Parameters<typeof inventoryItem>[0]){
  const product=productItem();const sale=salesItem();const inventory=inventoryItem(stock);
  const salesRef=createHash('sha256').update(canonicalAgentEvidenceJson(sale)).digest('hex').slice(0,32);
  return {
    products:{...metadata('products'),items:[{...product,evidence:[evidence('product',ids.product,'catalog-v1',product),evidence('variant',ids.variant,'catalog-v1',product)]}]},
    sales:{...metadata('sales'),items:[{...sale,evidence:[evidence('sales_aggregate',salesRef,'sales-aggregate-v1',sale)]}]},
    inventory:{...metadata('inventory'),items:[{...inventory,evidence:[evidence('inventory_balance',ids.variant,'inventory-ledger-v1',inventory),evidence('inventory_policy',ids.variant,'inventory-policy-v1',inventory)]}]},
  };
}
function analysisInput(verified=verifiedFixture()){
  return {question:'Which products should we promote next week without creating stockout risk?',period,scope:{tenantId:ids.tenant,shopIds:[ids.shop]},
    marketing:{candidates:[
      {productId:ids.product,variantId:ids.variant,sku:'CH-L-BK-32',signal:'strong' as const,rationale:'claimed',evidenceRefs:[`variant:${ids.variant}`]},
      {productId:ids.forgedProduct,variantId:ids.forgedVariant,sku:'FORGED',signal:'strong' as const,rationale:'invented',evidenceRefs:[`variant:${ids.forgedVariant}`]},
    ],limitations:[]},
    inventory:{assessments:[
      {productId:ids.product,variantId:ids.variant,sku:'CH-L-BK-32',risk:'low' as const,eligible:true,rationale:'claimed',evidenceRefs:[`inventory_balance:${ids.variant}`]},
      {productId:ids.forgedProduct,variantId:ids.forgedVariant,sku:'FORGED',risk:'low' as const,eligible:true,rationale:'invented',evidenceRefs:[`inventory_balance:${ids.forgedVariant}`]},
    ],limitations:[]},verified};
}

test('Commerce Lead returns only recommendations whose evidence resolves to verified Core facts',async()=>{
  const result=await consolidatePromotionAnalysis(analysisInput(),{now});
  assert.equal(result.recommendations.length,1);assert.equal(result.recommendations[0].variantId,ids.variant);
  assert.equal(result.recommendations[0].action,'promote');assert.equal(result.recommendations[0].salesQuantity,12);
  assert.equal(result.recommendations[0].stockConstraint.promotionCapacity,20);assert.ok(!JSON.stringify(result).includes('FORGED'));
  assert.deepEqual(result.sourceRequestIds,Object.values(requestIds));
  assert.equal(result.sources.every(source=>source.asOf===asOf),true);
  assert.deepEqual(result.evidenceCompleteness,{status:'verified',recommendationCount:1,resolvedReferenceCount:5,unresolvedReferenceCount:0});
  const manifest=new Map(result.evidenceManifest.map(item=>[item.ref,item]));
  assert.equal(result.recommendations[0].evidenceRefs.every(ref=>manifest.has(ref)),true);
  assert.equal(result.evidenceManifest.every(item=>item.integrityHash.length===64&&item.responseAsOf===asOf),true);
});

test('workflow retries derive one stable execution identity and snapshot boundary',async()=>{
  const context={sessionId:'session-poc-08',turnId:'turn-poc-08',callId:'call-poc-08'};
  const first=await preparePromotionExecution(context,new Date(asOf));
  const replay=await preparePromotionExecution(context,new Date(asOf));
  const anotherCall=await preparePromotionExecution({...context,callId:'call-poc-08-next'},new Date(asOf));
  assert.deepEqual(replay,first);assert.notEqual(anotherCall.id,first.id);assert.equal(first.snapshotAt,asOf);
  const result=await consolidatePromotionAnalysis({...analysisInput(),executionId:first.id},{now,verifiedAt:first.snapshotAt});
  assert.deepEqual(result.execution,{id:first.id,idempotencyVersion:'eve-commerce-v1'});
  assert.equal(result.trace.tenantId,ids.tenant);assert.equal(result.trace.executionId,first.id);
  assert.equal(result.trace.contentCaptured,false);assert.deepEqual(result.trace.coreRequestIds,Object.values(requestIds));
  assert.equal(result.verifiedAt,asOf);
});

test('deterministic stockout constraint holds a candidate when distributable stock is zero',async()=>{
  const input=analysisInput(verifiedFixture({onHand:5,reserved:5,available:0,safetyStock:0,distributable:0}));
  input.inventory.assessments[0].risk='low';
  const result=await consolidatePromotionAnalysis(input,{now});
  assert.equal(result.recommendations[0].action,'hold');assert.equal(result.recommendations[0].stockRisk,'high');
  assert.deepEqual(result.recommendations[0].stockConstraint.reasons,['no_distributable_stock']);
  assert.ok(result.limitations.some(item=>item.includes('deterministic stock policy differed')));
});

test('fails closed when a Core item is changed after its evidence hash was issued',async()=>{
  const input=analysisInput();input.verified.products.items[0].name='ข้อมูลถูกแก้ไข';
  await assert.rejects(()=>consolidatePromotionAnalysis(input,{now}),
    (error:unknown)=>error instanceof AgentEvidenceVerificationError&&error.code==='INTEGRITY_MISMATCH');
});

test('fails closed when required evidence is missing or source version is unsupported',async()=>{
  const missing=analysisInput();missing.verified.inventory.items[0].evidence=missing.verified.inventory.items[0].evidence.slice(0,1);
  await assert.rejects(()=>consolidatePromotionAnalysis(missing,{now}),
    (error:unknown)=>error instanceof AgentEvidenceVerificationError&&error.code==='EVIDENCE_INCOMPLETE');
  const wrongVersion=analysisInput();wrongVersion.verified.products.items[0].evidence[0]={...wrongVersion.verified.products.items[0].evidence[0],sourceVersion:'catalog-v0'};
  await assert.rejects(()=>consolidatePromotionAnalysis(wrongVersion,{now}),
    (error:unknown)=>error instanceof AgentEvidenceVerificationError&&error.code==='SOURCE_VERSION_MISMATCH');
});

test('rejects stale, split-snapshot and cross-shop evidence',async()=>{
  await assert.rejects(()=>consolidatePromotionAnalysis(analysisInput(),{now:new Date('2026-11-13T06:20:00.000Z')}),
    (error:unknown)=>error instanceof AgentEvidenceVerificationError&&error.code==='SNAPSHOT_STALE');
  const split=analysisInput();split.verified.sales.asOf='2026-11-13T06:04:00.000Z';
  await assert.rejects(()=>consolidatePromotionAnalysis(split,{now}),
    (error:unknown)=>error instanceof AgentEvidenceVerificationError&&error.code==='SNAPSHOT_MISMATCH');
  const foreign=analysisInput();foreign.verified.inventory.scope.shopIds=[ids.otherShop];
  await assert.rejects(()=>consolidatePromotionAnalysis(foreign,{now}),
    (error:unknown)=>error instanceof AgentEvidenceVerificationError&&error.code==='SCOPE_MISMATCH');
});

test('excludes specialist output whose cited evidence does not resolve to the same variant',async()=>{
  const input=analysisInput();input.marketing.candidates[0].evidenceRefs=[`variant:${ids.forgedVariant}`];
  const result=await consolidatePromotionAnalysis(input,{now});
  assert.equal(result.recommendations.length,0);assert.equal(result.evidenceManifest.length,0);
  assert.equal(result.evidenceCompleteness.unresolvedReferenceCount,0);
  assert.ok(result.limitations.some(item=>item.includes('did not resolve')));
});
