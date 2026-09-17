import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError,uuid,type Context } from '@commerce/contracts';
import { withTenant } from '@commerce/db';
import { assertShop,audit } from '@commerce/domain';
export * from './settlement-imports';

export const financialEventTypes=['refund','fee_rebate'] as const;
export type FinancialEventType=typeof financialEventTypes[number];
const eventInput=z.object({
  shopId:uuid,
  sourceEventId:z.string().trim().min(1).max(150),
  orderId:z.string().trim().min(1).max(100),
  eventType:z.enum(financialEventTypes),
  occurredOn:z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value,'วันที่ไม่ถูกต้อง'),
  amountMinor:z.number().int().min(1).max(1_000_000_000),
  note:z.string().trim().min(3).max(500),
  confirmedOutsideImportedReceipt:z.literal(true),
}).strict();
const reversalInput=z.object({
  shopId:uuid,
  sourceEventId:z.string().trim().min(1).max(150).optional(),
  occurredOn:z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value,'วันที่ไม่ถูกต้อง'),
  note:z.string().trim().min(3).max(500),
  confirmedCorrection:z.literal(true),
}).strict();
function access(role:string,write=true){
  if(!(write?['owner','finance']:['owner','finance','auditor']).includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการรายการปรับยอด');
}
function isoDate(value:string|Date){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}

export type FinancialEventItem={
  id:string;sourceEventId:string;orderId:string;eventType:FinancialEventType;occurredOn:string;
  amountMinor:number;note:string;createdAt:string;matchedLineCount:number;reversesEventId:string|null;reversedByEventId:string|null;
};
export type FinancialEventSummary={
  total:number;matched:number;unmatched:number;matchedRefundMinor:number;matchedFeeRebateMinor:number;
  unmatchedAmountMinor:number;netAdjustmentMinor:number;
};
export type OrderAdjustment={orderId:string;eventCount:number;refundMinor:number;feeRebateMinor:number;netAdjustmentMinor:number};
export type FinancialEventLedger={summary:FinancialEventSummary;items:FinancialEventItem[];byOrder:OrderAdjustment[];limit:number;asOf:string};

async function matchedLines(shopId:string,orderId:string,query:<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>Promise<T[]>){
  const [{count}]=await query<{count:number}>('SELECT count(*)::int AS count FROM app.sales_lines WHERE shop_id=$1 AND order_id=$2',[shopId,orderId]);
  return count;
}

export async function recordFinancialEvent(ctx:Context,input:unknown){
  const d=eventInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,d.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:${d.sourceEventId}`]);
    const [existing]=await tx.query<{id:string;orderId:string;eventType:FinancialEventType;occurredOn:string|Date;amountMinor:number;note:string}>(`SELECT id,order_id AS "orderId",event_type AS "eventType",occurred_on AS "occurredOn",amount_minor AS "amountMinor",note
      FROM app.financial_events WHERE shop_id=$1 AND source_event_id=$2`,[d.shopId,d.sourceEventId]);
    if(existing){
      const same=existing.orderId===d.orderId&&existing.eventType===d.eventType&&isoDate(existing.occurredOn)===d.occurredOn&&existing.amountMinor===d.amountMinor&&existing.note===d.note;
      if(!same)throw new AppError(409,'EVENT_ID_CONFLICT','รหัสรายการต้นทางนี้มีข้อมูลต่างจากรายการเดิม กรุณาตรวจแหล่งข้อมูล');
      return {id:existing.id,duplicate:true,matchedLineCount:await matchedLines(d.shopId,d.orderId,tx.query)};
    }
    const id=randomUUID();
    await tx.query(`INSERT INTO app.financial_events(tenant_id,id,shop_id,source_event_id,order_id,event_type,occurred_on,amount_minor,source_scope,note,actor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'outside_imported_net_receipt',$9,$10)`,[ctx.tenantId,id,d.shopId,d.sourceEventId,d.orderId,d.eventType,d.occurredOn,d.amountMinor,d.note,ctx.userId]);
    const matchedLineCount=await matchedLines(d.shopId,d.orderId,tx.query);
    await audit(tx,ctx,'financial_event.recorded',id,{shopId:d.shopId,sourceEventId:d.sourceEventId,orderId:d.orderId,eventType:d.eventType,amountMinor:d.amountMinor,matchedLineCount,sourceScope:'outside_imported_net_receipt'});
    return {id,duplicate:false,matchedLineCount};
  });
}

export async function reverseFinancialEvent(ctx:Context,eventId:string,input:unknown){
  const id=uuid.parse(eventId),d=reversalInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,d.shopId);
    const sourceEventId=d.sourceEventId??`REV-${id}`;
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:reversal:${id}`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:${sourceEventId}`]);
    const [existing]=await tx.query<{id:string;reversesEventId:string|null;occurredOn:string|Date;note:string}>(`SELECT id,reverses_event_id AS "reversesEventId",occurred_on AS "occurredOn",note
      FROM app.financial_events WHERE shop_id=$1 AND source_event_id=$2`,[d.shopId,sourceEventId]);
    if(existing){
      const same=existing.reversesEventId===id&&isoDate(existing.occurredOn)===d.occurredOn&&existing.note===d.note;
      if(!same)throw new AppError(409,'EVENT_ID_CONFLICT','รหัสรายการต้นทางนี้มีข้อมูลต่างจากรายการเดิม กรุณาตรวจแหล่งข้อมูล');
      return {id:existing.id,sourceEventId,duplicate:true,reversedEventId:id};
    }
    const [original]=await tx.query<{orderId:string;eventType:FinancialEventType;amountMinor:number;reversesEventId:string|null;reversedByEventId:string|null}>(`SELECT e.order_id AS "orderId",e.event_type AS "eventType",e.amount_minor AS "amountMinor",e.reverses_event_id AS "reversesEventId",r.id AS "reversedByEventId"
      FROM app.financial_events e LEFT JOIN app.financial_events r ON r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_event_id=e.id
      WHERE e.shop_id=$1 AND e.id=$2`,[d.shopId,id]);
    if(!original)throw new AppError(404,'EVENT_NOT_FOUND','ไม่พบรายการปรับยอดที่ต้องการแก้กลับ');
    if(original.reversesEventId)throw new AppError(409,'REVERSAL_NOT_REVERSIBLE','รายการแก้กลับไม่สามารถถูกแก้กลับซ้ำได้');
    if(original.reversedByEventId)throw new AppError(409,'EVENT_ALREADY_REVERSED','รายการนี้ถูกแก้กลับไว้แล้ว');
    const reversalId=randomUUID();
    await tx.query(`INSERT INTO app.financial_events(tenant_id,id,shop_id,source_event_id,order_id,event_type,occurred_on,amount_minor,source_scope,note,actor_id,reverses_event_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'event_reversal',$9,$10,$11)`,[ctx.tenantId,reversalId,d.shopId,sourceEventId,original.orderId,original.eventType,d.occurredOn,original.amountMinor,d.note,ctx.userId,id]);
    await audit(tx,ctx,'financial_event.reversed',reversalId,{shopId:d.shopId,sourceEventId,reversedEventId:id,orderId:original.orderId,eventType:original.eventType,amountMinor:original.amountMinor});
    return {id:reversalId,sourceEventId,duplicate:false,reversedEventId:id};
  });
}

export async function financialEvents(ctx:Context,shopId:string):Promise<FinancialEventLedger>{
  return withTenant(ctx,async(tx,role)=>{
    access(role,false);await assertShop(tx,ctx,shopId);
    type RawSummary={total:number;matched:number;unmatched:number;matchedRefundMinor:string;matchedFeeRebateMinor:string;unmatchedAmountMinor:string};
    const [raw]=await tx.query<RawSummary>(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE e.reverses_event_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.financial_events r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_event_id=e.id) AND EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id))::int AS matched,
      count(*) FILTER(WHERE e.reverses_event_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.financial_events r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_event_id=e.id) AND NOT EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id))::int AS unmatched,
      coalesce(sum(CASE WHEN e.reverses_event_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.event_type='refund' AND EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)),0)::text AS "matchedRefundMinor",
      coalesce(sum(CASE WHEN e.reverses_event_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.event_type='fee_rebate' AND EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)),0)::text AS "matchedFeeRebateMinor",
      coalesce(sum(CASE WHEN e.reverses_event_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE NOT EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)),0)::text AS "unmatchedAmountMinor"
      FROM app.financial_events e WHERE e.shop_id=$1`,[shopId]);
    const matchedRefundMinor=Number(raw.matchedRefundMinor),matchedFeeRebateMinor=Number(raw.matchedFeeRebateMinor);
    const summary:FinancialEventSummary={...raw,matchedRefundMinor,matchedFeeRebateMinor,unmatchedAmountMinor:Number(raw.unmatchedAmountMinor),netAdjustmentMinor:matchedFeeRebateMinor-matchedRefundMinor};
    type RawItem=Omit<FinancialEventItem,'occurredOn'|'createdAt'>&{occurredOn:string|Date;createdAt:string|Date};
    const rows=await tx.query<RawItem>(`SELECT e.id,e.source_event_id AS "sourceEventId",e.order_id AS "orderId",e.event_type AS "eventType",e.occurred_on AS "occurredOn",e.amount_minor AS "amountMinor",e.note,e.created_at AS "createdAt",e.reverses_event_id AS "reversesEventId",r.id AS "reversedByEventId",count(l.id)::int AS "matchedLineCount"
      FROM app.financial_events e LEFT JOIN app.sales_lines l ON l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id
      LEFT JOIN app.financial_events r ON r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_event_id=e.id
      WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.id,r.id ORDER BY e.occurred_on DESC,e.created_at DESC LIMIT 100`,[shopId]);
    type RawOrder={orderId:string;eventCount:number;refundMinor:string;feeRebateMinor:string};
    const orders=await tx.query<RawOrder>(`SELECT e.order_id AS "orderId",count(*)::int AS "eventCount",
      coalesce(sum(CASE WHEN e.reverses_event_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.event_type='refund'),0)::text AS "refundMinor",
      coalesce(sum(CASE WHEN e.reverses_event_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END) FILTER(WHERE e.event_type='fee_rebate'),0)::text AS "feeRebateMinor"
      FROM app.financial_events e WHERE e.shop_id=$1
      AND EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)
      GROUP BY e.order_id`,[shopId]);
    return {summary,items:rows.map(row=>({...row,occurredOn:isoDate(row.occurredOn),createdAt:new Date(row.createdAt).toISOString()})),byOrder:orders.map(row=>{const refundMinor=Number(row.refundMinor),feeRebateMinor=Number(row.feeRebateMinor);return {...row,refundMinor,feeRebateMinor,netAdjustmentMinor:feeRebateMinor-refundMinor};}),limit:100,asOf:new Date().toISOString()};
  });
}

export function applyFinancialEvents(netReceiptMinor:number,cogsMinor:number|null,refundMinor:number,feeRebateMinor:number){
  const adjustedReceiptMinor=netReceiptMinor-refundMinor+feeRebateMinor;
  return {adjustedReceiptMinor,adjustedContributionMinor:cogsMinor===null?null:adjustedReceiptMinor-cogsMinor};
}

const settlementInput=z.object({
  shopId:uuid,
  sourceLineId:z.string().trim().min(1).max(150),
  payoutReference:z.string().trim().min(1).max(150),
  orderId:z.string().trim().min(1).max(100),
  settledOn:z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value,'วันที่ไม่ถูกต้อง'),
  payoutTotalMinor:z.number().int().min(1).max(1_000_000_000),
  amountMinor:z.number().int().min(1).max(1_000_000_000),
  note:z.string().trim().min(3).max(500),
  confirmedStatement:z.literal(true),
}).strict();
const settlementReversalInput=z.object({
  shopId:uuid,
  note:z.string().trim().min(3).max(500),
  confirmedCorrection:z.literal(true),
}).strict();

function settlementAccess(role:string,write=true){
  if(!(write?['owner','finance']:['owner','finance','auditor']).includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการการกระทบยอดเงินโอน');
}

export type SettlementLineItem={
  id:string;sourceLineId:string;payoutReference:string;orderId:string;settledOn:string;payoutTotalMinor:number;
  amountMinor:number;note:string;createdAt:string;matched:boolean;reversesLineId:string|null;reversedByLineId:string|null;importBatchId:string|null;sourceRecord:number|null;
};
export type SettlementPayout={payoutReference:string;settledOn:string;payoutTotalMinor:number;allocatedMinor:number;differenceMinor:number;activeLineCount:number;unmatchedLineCount:number};
export type SettlementOrder={orderId:string;expectedReceiptMinor:number;settledMinor:number;differenceMinor:number;settlementLineCount:number};
export type SettlementSummary={payoutCount:number;balancedPayoutCount:number;unresolvedPayoutCount:number;reportedPayoutMinor:number;allocatedMinor:number;unmatchedLineCount:number;reconciledOrderCount:number;unresolvedOrderCount:number};
export type SettlementLedger={summary:SettlementSummary;payouts:SettlementPayout[];orders:SettlementOrder[];items:SettlementLineItem[];limit:number;asOf:string};

export async function recordSettlementLine(ctx:Context,input:unknown){
  const d=settlementInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    settlementAccess(role);await assertShop(tx,ctx,d.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:settlement-write`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:settlement-source:${d.sourceLineId}`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:payout:${d.payoutReference}`]);
    const [existing]=await tx.query<{id:string;payoutReference:string;orderId:string;settledOn:string|Date;payoutTotalMinor:number;amountMinor:number;note:string}>(`SELECT id,payout_reference AS "payoutReference",order_id AS "orderId",settled_on AS "settledOn",payout_total_minor AS "payoutTotalMinor",amount_minor AS "amountMinor",note
      FROM app.settlement_lines WHERE shop_id=$1 AND source_line_id=$2`,[d.shopId,d.sourceLineId]);
    if(existing){
      const same=existing.payoutReference===d.payoutReference&&existing.orderId===d.orderId&&isoDate(existing.settledOn)===d.settledOn&&existing.payoutTotalMinor===d.payoutTotalMinor&&existing.amountMinor===d.amountMinor&&existing.note===d.note;
      if(!same)throw new AppError(409,'SETTLEMENT_LINE_CONFLICT','รหัสบรรทัดต้นทางนี้มีข้อมูลต่างจากรายการเดิม กรุณาตรวจ statement');
      return {id:existing.id,duplicate:true,matchedLineCount:await matchedLines(d.shopId,d.orderId,tx.query)};
    }
    const [payout]=await tx.query<{settledOn:string|Date;payoutTotalMinor:number}>(`SELECT settled_on AS "settledOn",payout_total_minor AS "payoutTotalMinor" FROM app.settlement_lines
      WHERE shop_id=$1 AND payout_reference=$2 AND reverses_line_id IS NULL LIMIT 1`,[d.shopId,d.payoutReference]);
    if(payout&&(isoDate(payout.settledOn)!==d.settledOn||payout.payoutTotalMinor!==d.payoutTotalMinor))throw new AppError(409,'PAYOUT_SUMMARY_CONFLICT','รอบโอนนี้มีวันที่หรือยอดโอนรวมต่างจากรายการเดิม');
    const id=randomUUID();
    await tx.query(`INSERT INTO app.settlement_lines(tenant_id,id,shop_id,source_line_id,payout_reference,order_id,settled_on,payout_total_minor,amount_minor,source_scope,note,actor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'settlement_statement',$10,$11)`,[ctx.tenantId,id,d.shopId,d.sourceLineId,d.payoutReference,d.orderId,d.settledOn,d.payoutTotalMinor,d.amountMinor,d.note,ctx.userId]);
    const matchedLineCount=await matchedLines(d.shopId,d.orderId,tx.query);
    await audit(tx,ctx,'settlement.line.recorded',id,{shopId:d.shopId,sourceLineId:d.sourceLineId,payoutReference:d.payoutReference,orderId:d.orderId,payoutTotalMinor:d.payoutTotalMinor,amountMinor:d.amountMinor,matchedLineCount});
    return {id,duplicate:false,matchedLineCount};
  });
}

export async function reverseSettlementLine(ctx:Context,lineId:string,input:unknown){
  const id=uuid.parse(lineId),d=settlementReversalInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    settlementAccess(role);await assertShop(tx,ctx,d.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:settlement-write`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:settlement-reversal:${id}`]);
    const [original]=await tx.query<{sourceLineId:string;payoutReference:string;orderId:string;settledOn:string|Date;payoutTotalMinor:number;amountMinor:number;reversesLineId:string|null;reversedByLineId:string|null}>(`SELECT e.source_line_id AS "sourceLineId",e.payout_reference AS "payoutReference",e.order_id AS "orderId",e.settled_on AS "settledOn",e.payout_total_minor AS "payoutTotalMinor",e.amount_minor AS "amountMinor",e.reverses_line_id AS "reversesLineId",r.id AS "reversedByLineId"
      FROM app.settlement_lines e LEFT JOIN app.settlement_lines r ON r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_line_id=e.id
      WHERE e.shop_id=$1 AND e.id=$2`,[d.shopId,id]);
    if(!original)throw new AppError(404,'SETTLEMENT_LINE_NOT_FOUND','ไม่พบบรรทัดเงินโอนที่ต้องการแก้กลับ');
    if(original.reversesLineId)throw new AppError(409,'REVERSAL_NOT_REVERSIBLE','รายการแก้กลับไม่สามารถถูกแก้กลับซ้ำได้');
    if(original.reversedByLineId)return {id:original.reversedByLineId,sourceLineId:`REV-${id}`,duplicate:true,reversedLineId:id};
    const reversalId=randomUUID(),sourceLineId=`REV-${id}`;
    await tx.query(`INSERT INTO app.settlement_lines(tenant_id,id,shop_id,source_line_id,payout_reference,order_id,settled_on,payout_total_minor,amount_minor,source_scope,note,actor_id,reverses_line_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'settlement_reversal',$10,$11,$12)`,[ctx.tenantId,reversalId,d.shopId,sourceLineId,original.payoutReference,original.orderId,isoDate(original.settledOn),original.payoutTotalMinor,original.amountMinor,d.note,ctx.userId,id]);
    await audit(tx,ctx,'settlement.line.reversed',reversalId,{shopId:d.shopId,sourceLineId,reversedLineId:id,payoutReference:original.payoutReference,orderId:original.orderId,amountMinor:original.amountMinor});
    return {id:reversalId,sourceLineId,duplicate:false,reversedLineId:id};
  });
}

export async function settlements(ctx:Context,shopId:string):Promise<SettlementLedger>{
  return withTenant(ctx,async(tx,role)=>{
    settlementAccess(role,false);await assertShop(tx,ctx,shopId);
    type RawPayout=Omit<SettlementPayout,'settledOn'|'allocatedMinor'|'differenceMinor'>&{settledOn:string|Date;allocatedMinor:string};
    const payoutRows=await tx.query<RawPayout>(`SELECT e.payout_reference AS "payoutReference",max(e.settled_on) AS "settledOn",max(e.payout_total_minor)::int AS "payoutTotalMinor",
      coalesce(sum(CASE WHEN e.reverses_line_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END),0)::text AS "allocatedMinor",
      count(*) FILTER(WHERE e.reverses_line_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.settlement_lines r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_line_id=e.id))::int AS "activeLineCount",
      count(*) FILTER(WHERE e.reverses_line_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.settlement_lines r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_line_id=e.id) AND NOT EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id))::int AS "unmatchedLineCount"
      FROM app.settlement_lines e WHERE e.shop_id=$1 GROUP BY e.payout_reference ORDER BY max(e.settled_on) DESC,max(e.created_at) DESC LIMIT 100`,[shopId]);
    const payouts=payoutRows.map(row=>{const allocatedMinor=Number(row.allocatedMinor);return {...row,settledOn:isoDate(row.settledOn),allocatedMinor,differenceMinor:allocatedMinor-row.payoutTotalMinor};});
    type RawPayoutSummary={payoutCount:number;balancedPayoutCount:number;reportedPayoutMinor:string;allocatedMinor:string;unmatchedLineCount:number};
    const [payoutSummary]=await tx.query<RawPayoutSummary>(`WITH grouped AS (
        SELECT e.tenant_id,e.shop_id,e.payout_reference,max(e.payout_total_minor)::bigint AS reported,
          sum(CASE WHEN e.reverses_line_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END)::bigint AS allocated,
          count(*) FILTER(WHERE e.reverses_line_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.settlement_lines r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_line_id=e.id) AND NOT EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id))::int AS unmatched
        FROM app.settlement_lines e WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.shop_id,e.payout_reference
      ) SELECT count(*)::int AS "payoutCount",count(*) FILTER(WHERE allocated=reported AND unmatched=0)::int AS "balancedPayoutCount",
        coalesce(sum(reported),0)::text AS "reportedPayoutMinor",coalesce(sum(allocated),0)::text AS "allocatedMinor",coalesce(sum(unmatched),0)::int AS "unmatchedLineCount" FROM grouped`,[shopId]);
    type RawOrder={orderId:string;expectedReceiptMinor:string;settledMinor:string;settlementLineCount:number};
    const orderRows=await tx.query<RawOrder>(`WITH sales AS (
        SELECT l.tenant_id,l.shop_id,l.order_id,sum(l.net_receipt_minor)::bigint AS receipt
        FROM app.sales_lines l WHERE l.shop_id=$1 GROUP BY l.tenant_id,l.shop_id,l.order_id
      ), adjustments AS (
        SELECT e.tenant_id,e.shop_id,e.order_id,
          sum((CASE WHEN e.event_type='refund' THEN -1 ELSE 1 END)*(CASE WHEN e.reverses_event_id IS NULL THEN 1 ELSE -1 END)*e.amount_minor)::bigint AS amount
        FROM app.financial_events e WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.shop_id,e.order_id
      ), paid AS (
        SELECT e.tenant_id,e.shop_id,e.order_id,sum(CASE WHEN e.reverses_line_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END)::bigint AS amount,
          count(*) FILTER(WHERE e.reverses_line_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.settlement_lines r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_line_id=e.id))::int AS line_count
        FROM app.settlement_lines e WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.shop_id,e.order_id
      ) SELECT s.order_id AS "orderId",(s.receipt+coalesce(a.amount,0))::text AS "expectedReceiptMinor",p.amount::text AS "settledMinor",p.line_count AS "settlementLineCount"
      FROM paid p JOIN sales s ON s.tenant_id=p.tenant_id AND s.shop_id=p.shop_id AND s.order_id=p.order_id
      LEFT JOIN adjustments a ON a.tenant_id=s.tenant_id AND a.shop_id=s.shop_id AND a.order_id=s.order_id
      ORDER BY abs(p.amount-(s.receipt+coalesce(a.amount,0))) DESC,s.order_id LIMIT 100`,[shopId]);
    const orders=orderRows.map(row=>{const expectedReceiptMinor=Number(row.expectedReceiptMinor),settledMinor=Number(row.settledMinor);return {...row,expectedReceiptMinor,settledMinor,differenceMinor:settledMinor-expectedReceiptMinor};});
    const [orderSummary]=await tx.query<{reconciledOrderCount:number;unresolvedOrderCount:number}>(`WITH sales AS (
        SELECT l.tenant_id,l.shop_id,l.order_id,sum(l.net_receipt_minor)::bigint AS receipt
        FROM app.sales_lines l WHERE l.shop_id=$1 GROUP BY l.tenant_id,l.shop_id,l.order_id
      ), adjustments AS (
        SELECT e.tenant_id,e.shop_id,e.order_id,
          sum((CASE WHEN e.event_type='refund' THEN -1 ELSE 1 END)*(CASE WHEN e.reverses_event_id IS NULL THEN 1 ELSE -1 END)*e.amount_minor)::bigint AS amount
        FROM app.financial_events e WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.shop_id,e.order_id
      ), paid AS (
        SELECT e.tenant_id,e.shop_id,e.order_id,sum(CASE WHEN e.reverses_line_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END)::bigint AS amount
        FROM app.settlement_lines e WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.shop_id,e.order_id
      ), compared AS (
        SELECT p.amount-(s.receipt+coalesce(a.amount,0)) AS difference FROM paid p
        JOIN sales s ON s.tenant_id=p.tenant_id AND s.shop_id=p.shop_id AND s.order_id=p.order_id
        LEFT JOIN adjustments a ON a.tenant_id=s.tenant_id AND a.shop_id=s.shop_id AND a.order_id=s.order_id
      ) SELECT count(*) FILTER(WHERE difference=0)::int AS "reconciledOrderCount",count(*) FILTER(WHERE difference<>0)::int AS "unresolvedOrderCount" FROM compared`,[shopId]);
    type RawItem=Omit<SettlementLineItem,'settledOn'|'createdAt'>&{settledOn:string|Date;createdAt:string|Date};
    const itemRows=await tx.query<RawItem>(`SELECT e.id,e.source_line_id AS "sourceLineId",e.payout_reference AS "payoutReference",e.order_id AS "orderId",e.settled_on AS "settledOn",e.payout_total_minor AS "payoutTotalMinor",e.amount_minor AS "amountMinor",e.note,e.created_at AS "createdAt",e.reverses_line_id AS "reversesLineId",r.id AS "reversedByLineId",e.import_batch_id AS "importBatchId",e.source_record AS "sourceRecord",
      EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id) AS matched
      FROM app.settlement_lines e LEFT JOIN app.settlement_lines r ON r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_line_id=e.id
      WHERE e.shop_id=$1 ORDER BY e.settled_on DESC,e.created_at DESC LIMIT 100`,[shopId]);
    const items=itemRows.map(row=>({...row,settledOn:isoDate(row.settledOn),createdAt:new Date(row.createdAt).toISOString()}));
    const payoutCount=payoutSummary?.payoutCount??0,balancedPayoutCount=payoutSummary?.balancedPayoutCount??0;
    return {summary:{payoutCount,balancedPayoutCount,unresolvedPayoutCount:payoutCount-balancedPayoutCount,reportedPayoutMinor:Number(payoutSummary?.reportedPayoutMinor??0),allocatedMinor:Number(payoutSummary?.allocatedMinor??0),unmatchedLineCount:payoutSummary?.unmatchedLineCount??0,reconciledOrderCount:orderSummary?.reconciledOrderCount??0,unresolvedOrderCount:orderSummary?.unresolvedOrderCount??0},payouts,orders,items,limit:100,asOf:new Date().toISOString()};
  });
}

export const shopExpenseTypes=['advertising','shipping','packaging','payroll','travel','other'] as const;
export type ShopExpenseType=typeof shopExpenseTypes[number];
export const expenseAllocationScopes=['shop_direct','shared_allocated'] as const;
export type ExpenseAllocationScope=typeof expenseAllocationScopes[number];

const expenseInput=z.object({
  shopId:uuid,
  sourceExpenseId:z.string().trim().min(1).max(150),
  expenseType:z.enum(shopExpenseTypes),
  occurredOn:z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value,'วันที่ไม่ถูกต้อง'),
  amountMinor:z.number().int().min(1).max(1_000_000_000),
  allocationScope:z.enum(expenseAllocationScopes),
  allocationBasis:z.string().trim().min(3).max(300).nullable(),
  note:z.string().trim().min(3).max(500),
  confirmedOutsideImportedReceipt:z.literal(true),
}).strict().superRefine((value,ctx)=>{
  if(value.allocationScope==='shared_allocated'&&!value.allocationBasis)ctx.addIssue({code:'custom',path:['allocationBasis'],message:'กรุณาระบุวิธีแบ่งค่าใช้จ่ายส่วนกลางให้ร้านนี้'});
  if(value.allocationScope==='shop_direct'&&value.allocationBasis!==null)ctx.addIssue({code:'custom',path:['allocationBasis'],message:'ค่าใช้จ่ายของร้านโดยตรงไม่ต้องระบุวิธีแบ่ง'});
});
const expenseReversalInput=z.object({
  shopId:uuid,
  occurredOn:z.string().refine(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value,'วันที่ไม่ถูกต้อง'),
  note:z.string().trim().min(3).max(500),
  confirmedCorrection:z.literal(true),
}).strict();

function expenseAccess(role:string,write=true){
  if(!(write?['owner','finance']:['owner','finance','auditor']).includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการค่าใช้จ่ายของร้าน');
}

export type ShopExpenseItem={
  id:string;sourceExpenseId:string;expenseType:ShopExpenseType;occurredOn:string;amountMinor:number;
  allocationScope:ExpenseAllocationScope;allocationBasis:string|null;note:string;createdAt:string;
  reversesExpenseId:string|null;reversedByExpenseId:string|null;
};
export type ShopExpenseCategoryTotal={expenseType:ShopExpenseType;amountMinor:number};
export type ShopExpenseSummary={entryCount:number;activeExpenseCount:number;reversedExpenseCount:number;activeAmountMinor:number};
export type ShopExpenseLedger={summary:ShopExpenseSummary;categoryTotals:ShopExpenseCategoryTotal[];items:ShopExpenseItem[];limit:number;asOf:string};

export async function recordShopExpense(ctx:Context,input:unknown){
  const d=expenseInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    expenseAccess(role);await assertShop(tx,ctx,d.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:expense:${d.sourceExpenseId}`]);
    const [existing]=await tx.query<{id:string;expenseType:ShopExpenseType;occurredOn:string|Date;amountMinor:number;allocationScope:ExpenseAllocationScope;allocationBasis:string|null;note:string}>(`SELECT id,expense_type AS "expenseType",occurred_on AS "occurredOn",amount_minor AS "amountMinor",allocation_scope AS "allocationScope",allocation_basis AS "allocationBasis",note
      FROM app.shop_expenses WHERE shop_id=$1 AND source_expense_id=$2`,[d.shopId,d.sourceExpenseId]);
    if(existing){
      const same=existing.expenseType===d.expenseType&&isoDate(existing.occurredOn)===d.occurredOn&&existing.amountMinor===d.amountMinor&&existing.allocationScope===d.allocationScope&&existing.allocationBasis===d.allocationBasis&&existing.note===d.note;
      if(!same)throw new AppError(409,'EXPENSE_ID_CONFLICT','รหัสอ้างอิงนี้มีข้อมูลต่างจากรายการเดิม กรุณาตรวจเอกสารต้นทาง');
      return {id:existing.id,duplicate:true};
    }
    const id=randomUUID();
    await tx.query(`INSERT INTO app.shop_expenses(tenant_id,id,shop_id,source_expense_id,expense_type,occurred_on,amount_minor,allocation_scope,allocation_basis,source_scope,note,actor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'outside_imported_net_receipt',$10,$11)`,[ctx.tenantId,id,d.shopId,d.sourceExpenseId,d.expenseType,d.occurredOn,d.amountMinor,d.allocationScope,d.allocationBasis,d.note,ctx.userId]);
    await audit(tx,ctx,'shop_expense.recorded',id,{shopId:d.shopId,sourceExpenseId:d.sourceExpenseId,expenseType:d.expenseType,amountMinor:d.amountMinor,allocationScope:d.allocationScope,allocationBasis:d.allocationBasis,sourceScope:'outside_imported_net_receipt'});
    return {id,duplicate:false};
  });
}

export async function reverseShopExpense(ctx:Context,expenseId:string,input:unknown){
  const id=uuid.parse(expenseId),d=expenseReversalInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    expenseAccess(role);await assertShop(tx,ctx,d.shopId);
    const sourceExpenseId=`REV-${id}`;
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:expense-reversal:${id}`]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.shopId}:expense:${sourceExpenseId}`]);
    const [existing]=await tx.query<{id:string;reversesExpenseId:string|null;occurredOn:string|Date;note:string}>(`SELECT id,reverses_expense_id AS "reversesExpenseId",occurred_on AS "occurredOn",note
      FROM app.shop_expenses WHERE shop_id=$1 AND source_expense_id=$2`,[d.shopId,sourceExpenseId]);
    if(existing){
      const same=existing.reversesExpenseId===id&&isoDate(existing.occurredOn)===d.occurredOn&&existing.note===d.note;
      if(!same)throw new AppError(409,'EXPENSE_ID_CONFLICT','รหัสรายการแก้กลับนี้มีข้อมูลต่างจากรายการเดิม');
      return {id:existing.id,sourceExpenseId,duplicate:true,reversedExpenseId:id};
    }
    const [original]=await tx.query<{expenseType:ShopExpenseType;amountMinor:number;allocationScope:ExpenseAllocationScope;allocationBasis:string|null;reversesExpenseId:string|null;reversedByExpenseId:string|null}>(`SELECT e.expense_type AS "expenseType",e.amount_minor AS "amountMinor",e.allocation_scope AS "allocationScope",e.allocation_basis AS "allocationBasis",e.reverses_expense_id AS "reversesExpenseId",r.id AS "reversedByExpenseId"
      FROM app.shop_expenses e LEFT JOIN app.shop_expenses r ON r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_expense_id=e.id
      WHERE e.shop_id=$1 AND e.id=$2`,[d.shopId,id]);
    if(!original)throw new AppError(404,'EXPENSE_NOT_FOUND','ไม่พบค่าใช้จ่ายที่ต้องการแก้กลับ');
    if(original.reversesExpenseId)throw new AppError(409,'REVERSAL_NOT_REVERSIBLE','รายการแก้กลับไม่สามารถถูกแก้กลับซ้ำได้');
    if(original.reversedByExpenseId)throw new AppError(409,'EXPENSE_ALREADY_REVERSED','ค่าใช้จ่ายนี้ถูกแก้กลับไว้แล้ว');
    const reversalId=randomUUID();
    await tx.query(`INSERT INTO app.shop_expenses(tenant_id,id,shop_id,source_expense_id,expense_type,occurred_on,amount_minor,allocation_scope,allocation_basis,source_scope,note,actor_id,reverses_expense_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'expense_reversal',$10,$11,$12)`,[ctx.tenantId,reversalId,d.shopId,sourceExpenseId,original.expenseType,d.occurredOn,original.amountMinor,original.allocationScope,original.allocationBasis,d.note,ctx.userId,id]);
    await audit(tx,ctx,'shop_expense.reversed',reversalId,{shopId:d.shopId,sourceExpenseId,reversedExpenseId:id,expenseType:original.expenseType,amountMinor:original.amountMinor});
    return {id:reversalId,sourceExpenseId,duplicate:false,reversedExpenseId:id};
  });
}

export async function shopExpenses(ctx:Context,shopId:string):Promise<ShopExpenseLedger>{
  return withTenant(ctx,async(tx,role)=>{
    expenseAccess(role,false);await assertShop(tx,ctx,shopId);
    type RawSummary={entryCount:number;activeExpenseCount:number;reversedExpenseCount:number;activeAmountMinor:string};
    const [raw]=await tx.query<RawSummary>(`SELECT count(*)::int AS "entryCount",
      count(*) FILTER(WHERE e.reverses_expense_id IS NULL AND NOT EXISTS(SELECT 1 FROM app.shop_expenses r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_expense_id=e.id))::int AS "activeExpenseCount",
      count(*) FILTER(WHERE e.reverses_expense_id IS NULL AND EXISTS(SELECT 1 FROM app.shop_expenses r WHERE r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_expense_id=e.id))::int AS "reversedExpenseCount",
      coalesce(sum(CASE WHEN e.reverses_expense_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END),0)::text AS "activeAmountMinor"
      FROM app.shop_expenses e WHERE e.shop_id=$1`,[shopId]);
    type RawCategory={expenseType:ShopExpenseType;amountMinor:string};
    const categoryRows=await tx.query<RawCategory>(`SELECT e.expense_type AS "expenseType",coalesce(sum(CASE WHEN e.reverses_expense_id IS NULL THEN e.amount_minor ELSE -e.amount_minor END),0)::text AS "amountMinor"
      FROM app.shop_expenses e WHERE e.shop_id=$1 GROUP BY e.expense_type ORDER BY e.expense_type`,[shopId]);
    type RawItem=Omit<ShopExpenseItem,'occurredOn'|'createdAt'>&{occurredOn:string|Date;createdAt:string|Date};
    const rows=await tx.query<RawItem>(`SELECT e.id,e.source_expense_id AS "sourceExpenseId",e.expense_type AS "expenseType",e.occurred_on AS "occurredOn",e.amount_minor AS "amountMinor",e.allocation_scope AS "allocationScope",e.allocation_basis AS "allocationBasis",e.note,e.created_at AS "createdAt",e.reverses_expense_id AS "reversesExpenseId",r.id AS "reversedByExpenseId"
      FROM app.shop_expenses e LEFT JOIN app.shop_expenses r ON r.tenant_id=e.tenant_id AND r.shop_id=e.shop_id AND r.reverses_expense_id=e.id
      WHERE e.shop_id=$1 ORDER BY e.occurred_on DESC,e.created_at DESC LIMIT 100`,[shopId]);
    return {summary:{...raw,activeAmountMinor:Number(raw.activeAmountMinor)},categoryTotals:categoryRows.map(row=>({...row,amountMinor:Number(row.amountMinor)})),items:rows.map(row=>({...row,occurredOn:isoDate(row.occurredOn),createdAt:new Date(row.createdAt).toISOString()})),limit:100,asOf:new Date().toISOString()};
  });
}

export function applyShopExpenses(adjustedContributionMinor:number|null,activeExpenseMinor:number){
  return adjustedContributionMinor===null?null:adjustedContributionMinor-activeExpenseMinor;
}
