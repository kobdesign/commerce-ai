import { tool } from 'ai';
import { z } from 'zod';
import { AppError,uuid,type Context,type PayoutTotalBasis } from '@commerce/contracts';
import { shops } from '@commerce/domain';
import { settlements,type SettlementLedger,type SettlementLineItem,type SettlementPayout } from '@commerce/finance';

const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'ใช้วันที่รูปแบบ YYYY-MM-DD').refine(value=>{
  const parsed=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
},'วันที่ไม่ถูกต้อง');
const period=z.object({from:isoDate,to:isoDate}).strict().superRefine((value,ctx)=>{
  if(value.from>value.to)ctx.addIssue({code:'custom',path:['to'],message:'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น'});
  if((Date.parse(`${value.to}T00:00:00Z`)-Date.parse(`${value.from}T00:00:00Z`))/86_400_000>366)ctx.addIssue({code:'custom',path:['to'],message:'ช่วงเวลาต้องไม่เกิน 366 วัน'});
});
export const settlementExceptionsInput=z.object({shopId:uuid,period,limit:z.number().int().min(1).max(50).default(20)}).strict();
export const settlementEvidenceInput=z.object({shopId:uuid,period,payoutReference:z.string().trim().min(1).max(150)}).strict();

export type EvidenceBasis='actual'|'allocated'|'estimated'|'incomplete';
export type SettlementExceptionKind='unmatched_statement_line'|'order_difference'|'payout_difference'|'insufficient_payout_evidence';
export type EvidenceReference={kind:'settlement_line'|'settlement_payout'|'sales_order';ref:string;sourceTransactionId:string|null;transactionIdOrigin:'source'|'system_generated'};
export type SettlementException={
  id:string;kind:SettlementExceptionKind;status:'needs_review';basis:EvidenceBasis;payoutTotalOrigin:PayoutTotalBasis|null;
  payoutReference:string|null;orderId:string|null;observedAt:string;importedAt:string|null;
  amounts:{payoutTotalMinor:number|null;allocatedMinor:number|null;expectedReceiptMinor:number|null;differenceMinor:number|null};
  arithmeticBalanced:boolean|null;orderMatchingComplete:boolean|null;independentPayoutVerification:false;
  missingInputs:string[];evidenceReferences:EvidenceReference[];
};
export type SourceVersion={adapter:string;schemaVersion:string;parserVersion:string};
export type EvidenceEnvelope<T>={
  contractVersion:'finance-evidence-v1';scope:{shopId:string;shopName:string;channel:string;period:{from:string;to:string}};
  currency:'THB';metricVersion:'settlement-reconciliation-v2';calculatedAt:string;analysedAt:string;
  observedAt:string|null;importedAt:string|null;isSynthetic:boolean;sources:SourceVersion[];
  results:{total:number;shown:number;truncated:boolean;items:T[]};missingInputs:string[];limitations:string[];
};

function sourceVersions(items:SettlementLineItem[]):SourceVersion[]{
  const unique=new Map<string,SourceVersion>();
  for(const item of items){
    const source={adapter:item.sourceAdapter,schemaVersion:item.sourceSchemaVersion,parserVersion:item.sourceParserVersion};
    unique.set(`${source.adapter}:${source.schemaVersion}:${source.parserVersion}`,source);
  }
  return [...unique.values()].sort((a,b)=>a.adapter.localeCompare(b.adapter));
}
function newest(values:(string|null)[]){return values.filter((value):value is string=>!!value).sort().at(-1)??null;}
function lineReference(item:SettlementLineItem):EvidenceReference{
  return {kind:'settlement_line',ref:`settlement-line:${item.id}`,sourceTransactionId:item.sourceLineId,transactionIdOrigin:item.reversesLineId?'system_generated':'source'};
}
function payoutReference(reference:string):EvidenceReference{return {kind:'settlement_payout',ref:`settlement-payout:${encodeURIComponent(reference)}`,sourceTransactionId:reference,transactionIdOrigin:'source'};}
function orderReference(orderId:string):EvidenceReference{return {kind:'sales_order',ref:`sales-order:${encodeURIComponent(orderId)}`,sourceTransactionId:orderId,transactionIdOrigin:'source'};}
function payoutMissing(payout:SettlementPayout){
  const missing:string[]=[];
  if(payout.payoutTotalBasis==='derived_from_lines')missing.push('reported_payout_total');
  if(payout.payoutTotalBasis==='unknown')missing.push('payout_total_provenance');
  if(payout.unmatchedLineCount)missing.push('matching_sales_orders');
  if(!payout.activeLineCount)missing.push('active_settlement_allocations');
  return missing;
}
function payoutException(payout:SettlementPayout,lines:SettlementLineItem[]):SettlementException{
  const importedAt=newest(lines.map(line=>line.createdAt));
  const reportedMismatch=payout.payoutTotalBasis==='reported_total'&&!payout.arithmeticBalanced;
  return {
    id:`${reportedMismatch?'payout_difference':'insufficient_payout_evidence'}:${payout.payoutReference}`,
    kind:reportedMismatch?'payout_difference':'insufficient_payout_evidence',status:'needs_review',
    basis:reportedMismatch?'allocated':'incomplete',payoutTotalOrigin:payout.payoutTotalBasis,payoutReference:payout.payoutReference,orderId:null,
    observedAt:payout.settledOn,importedAt,
    amounts:{payoutTotalMinor:payout.payoutTotalMinor,allocatedMinor:payout.allocatedMinor,expectedReceiptMinor:null,differenceMinor:payout.differenceMinor},
    arithmeticBalanced:payout.arithmeticBalanced,orderMatchingComplete:payout.unmatchedLineCount===0,independentPayoutVerification:false,
    missingInputs:payoutMissing(payout),evidenceReferences:[payoutReference(payout.payoutReference),...lines.map(lineReference)],
  };
}
function envelope<T>(ledger:SettlementLedger,shop:{id:string;name:string;channel:string},periodValue:{from:string;to:string},items:T[],total:number,itemTimes:{observedAt:string;importedAt:string|null}[],missingInputs:string[]):EvidenceEnvelope<T>{
  const uniqueMissing=[...new Set(missingInputs)].sort();
  const truncated=items.length<total;
  return {
    contractVersion:'finance-evidence-v1',scope:{shopId:shop.id,shopName:shop.name,channel:shop.channel,period:periodValue},currency:'THB',
    metricVersion:'settlement-reconciliation-v2',calculatedAt:ledger.asOf,analysedAt:new Date().toISOString(),
    observedAt:newest(itemTimes.map(item=>item.observedAt)),importedAt:newest(itemTimes.map(item=>item.importedAt)),
    isSynthetic:['local-demo','staging-demo'].includes(process.env.APP_MODE??''),sources:sourceVersions(ledger.items),
    results:{total,shown:items.length,truncated,items},missingInputs:uniqueMissing,
    limitations:[
      'ผลนี้เปรียบเทียบรายงานขายกับ allocations และยอดรวมใน Statement เท่านั้น ไม่ใช่หลักฐานว่าเงินเข้าธนาคาร',
      'เครื่องมือนี้ไม่คำนวณกำไรสุทธิ ต้นทุนสินค้า หรือสาเหตุของข้อแตกต่าง',
      ...(truncated?['ผลลัพธ์ถูกจำกัดตาม page limit ห้ามสรุปว่ารายการที่แสดงคือข้อแตกต่างทั้งหมด']:[]),
      ...(ledger.items.length===ledger.limit?['รายการหลักฐานและรุ่นต้นทางอาจถูกตัดตามขีดจำกัดการอ่าน']:[]),
    ],
  };
}
async function scopedShop(ctx:Context,shopId:string){
  const shop=(await shops(ctx)).find(candidate=>candidate.id===shopId);
  if(!shop)throw new AppError(403,'SHOP_FORBIDDEN','คุณไม่มีสิทธิ์เข้าถึงร้านนี้');
  return shop;
}

export async function getSettlementExceptions(ctx:Context,input:unknown):Promise<EvidenceEnvelope<SettlementException>>{
  const data=settlementExceptionsInput.parse(input);
  const ledger=await settlements(ctx,data.shopId,{...data.period,limit:100});
  const shop=await scopedShop(ctx,data.shopId),byPayout=new Map<string,SettlementLineItem[]>();
  for(const line of ledger.items){const entries=byPayout.get(line.payoutReference)??[];entries.push(line);byPayout.set(line.payoutReference,entries);}
  const payoutItems=ledger.payouts.filter(item=>!item.reconciliationComplete).map(item=>payoutException(item,byPayout.get(item.payoutReference)??[]));
  const orderItems:SettlementException[]=ledger.orders.filter(item=>item.differenceMinor!==0).map(item=>({
    id:`order_difference:${item.orderId}`,kind:'order_difference',status:'needs_review',basis:'allocated',payoutTotalOrigin:null,payoutReference:null,orderId:item.orderId,
    observedAt:item.observedOn,importedAt:item.latestSettlementAt,
    amounts:{payoutTotalMinor:null,allocatedMinor:item.settledMinor,expectedReceiptMinor:item.expectedReceiptMinor,differenceMinor:item.differenceMinor},
    arithmeticBalanced:null,orderMatchingComplete:true,independentPayoutVerification:false,missingInputs:[],
    evidenceReferences:[orderReference(item.orderId),...ledger.items.filter(line=>line.orderId===item.orderId).map(lineReference)],
  }));
  const unmatchedItems:SettlementException[]=ledger.items.filter(item=>!item.matched&&!item.reversesLineId&&!item.reversedByLineId).map(item=>({
    id:`unmatched_statement_line:${item.id}`,kind:'unmatched_statement_line',status:'needs_review',basis:'incomplete',payoutTotalOrigin:item.payoutTotalBasis,payoutReference:item.payoutReference,orderId:item.orderId,
    observedAt:item.settledOn,importedAt:item.createdAt,
    amounts:{payoutTotalMinor:item.payoutTotalMinor,allocatedMinor:item.amountMinor,expectedReceiptMinor:null,differenceMinor:null},
    arithmeticBalanced:null,orderMatchingComplete:false,independentPayoutVerification:false,missingInputs:['matching_sales_order'],
    evidenceReferences:[lineReference(item),payoutReference(item.payoutReference)],
  }));
  const all=[...payoutItems,...orderItems,...unmatchedItems].sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.id.localeCompare(b.id));
  const total=ledger.summary.unresolvedPayoutCount+ledger.summary.unresolvedOrderCount+ledger.summary.unmatchedLineCount;
  const visible=all.slice(0,data.limit),times=visible.map(item=>({observedAt:item.observedAt,importedAt:item.importedAt}));
  const missingInputs=[...visible.flatMap(item=>item.missingInputs)];
  if(!ledger.summary.payoutCount)missingInputs.push('settlement_data');
  if(ledger.summary.derivedPayoutCount)missingInputs.push('reported_payout_total');
  if(ledger.summary.unknownPayoutCount)missingInputs.push('payout_total_provenance');
  if(ledger.summary.unmatchedLineCount)missingInputs.push('matching_sales_orders');
  return envelope(ledger,shop,data.period,visible,total,times,missingInputs);
}

export type SettlementEvidenceDetail={
  payoutReference:string;payoutTotalOrigin:PayoutTotalBasis;basis:EvidenceBasis;observedAt:string;importedAt:string|null;
  amounts:{payoutTotalMinor:number;allocatedMinor:number;differenceMinor:number};arithmeticBalanced:boolean;orderMatchingComplete:boolean;
  reconciliationComplete:boolean;independentPayoutVerification:false;activeLineCount:number;unmatchedLineCount:number;
  missingInputs:string[];evidenceReferences:EvidenceReference[];
};
export async function explainSettlementEvidence(ctx:Context,input:unknown):Promise<EvidenceEnvelope<SettlementEvidenceDetail>>{
  const data=settlementEvidenceInput.parse(input);
  const ledger=await settlements(ctx,data.shopId,{...data.period,payoutReference:data.payoutReference,limit:100});
  const shop=await scopedShop(ctx,data.shopId),payout=ledger.payouts[0];
  if(!payout)throw new AppError(404,'SETTLEMENT_EVIDENCE_NOT_FOUND','ไม่พบหลักฐานรอบโอนในร้านและช่วงเวลาที่เลือก');
  const lines=ledger.items.filter(line=>line.payoutReference===payout.payoutReference),missingInputs=payoutMissing(payout);
  const detail: SettlementEvidenceDetail={
    payoutReference:payout.payoutReference,payoutTotalOrigin:payout.payoutTotalBasis,basis:payout.payoutTotalBasis==='reported_total'?'allocated':'incomplete',
    observedAt:payout.settledOn,importedAt:newest(lines.map(line=>line.createdAt)),
    amounts:{payoutTotalMinor:payout.payoutTotalMinor,allocatedMinor:payout.allocatedMinor,differenceMinor:payout.differenceMinor},
    arithmeticBalanced:payout.arithmeticBalanced,orderMatchingComplete:payout.unmatchedLineCount===0,reconciliationComplete:payout.reconciliationComplete,
    independentPayoutVerification:false,activeLineCount:payout.activeLineCount,unmatchedLineCount:payout.unmatchedLineCount,missingInputs,
    evidenceReferences:[payoutReference(payout.payoutReference),...lines.map(lineReference)],
  };
  return envelope(ledger,shop,data.period,[detail],1,[{observedAt:detail.observedAt,importedAt:detail.importedAt}],missingInputs);
}

function requireSelectedShop(selectedShopId:string,requestedShopId:string){
  if(selectedShopId!==requestedShopId)throw new AppError(403,'SHOP_SCOPE_MISMATCH','เครื่องมือนี้อ่านได้เฉพาะร้านที่ผู้ใช้เลือก');
}
export function financialReadTools(ctx:Context,selectedShopId:string){
  return {
    get_settlement_exceptions:tool({
      description:'Read settlement exceptions for the selected authorized shop and period. Returns computed amounts, provenance, evidence references, pagination metadata, timestamps and limitations. Read-only.',
      inputSchema:settlementExceptionsInput,
      execute:async input=>{requireSelectedShop(selectedShopId,input.shopId);return getSettlementExceptions(ctx,input);},
    }),
    explain_settlement_evidence:tool({
      description:'Explain one authorized payout using finance-service calculations and immutable evidence references. Never verifies a bank deposit and performs no write.',
      inputSchema:settlementEvidenceInput,
      execute:async input=>{requireSelectedShop(selectedShopId,input.shopId);return explainSettlementEvidence(ctx,input);},
    }),
  };
}
