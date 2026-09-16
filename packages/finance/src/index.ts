import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError,uuid,type Context } from '@commerce/contracts';
import { withTenant } from '@commerce/db';
import { assertShop,audit } from '@commerce/domain';

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
function access(role:string,write=true){
  if(!(write?['owner','finance']:['owner','finance','auditor']).includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการรายการปรับยอด');
}
function isoDate(value:string|Date){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}

export type FinancialEventItem={
  id:string;sourceEventId:string;orderId:string;eventType:FinancialEventType;occurredOn:string;
  amountMinor:number;note:string;createdAt:string;matchedLineCount:number;
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

export async function financialEvents(ctx:Context,shopId:string):Promise<FinancialEventLedger>{
  return withTenant(ctx,async(tx,role)=>{
    access(role,false);await assertShop(tx,ctx,shopId);
    type RawSummary={total:number;matched:number;unmatched:number;matchedRefundMinor:string;matchedFeeRebateMinor:string;unmatchedAmountMinor:string};
    const [raw]=await tx.query<RawSummary>(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id))::int AS matched,
      count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id))::int AS unmatched,
      coalesce(sum(e.amount_minor) FILTER(WHERE e.event_type='refund' AND EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)),0)::text AS "matchedRefundMinor",
      coalesce(sum(e.amount_minor) FILTER(WHERE e.event_type='fee_rebate' AND EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)),0)::text AS "matchedFeeRebateMinor",
      coalesce(sum(e.amount_minor) FILTER(WHERE NOT EXISTS(SELECT 1 FROM app.sales_lines l WHERE l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id)),0)::text AS "unmatchedAmountMinor"
      FROM app.financial_events e WHERE e.shop_id=$1`,[shopId]);
    const matchedRefundMinor=Number(raw.matchedRefundMinor),matchedFeeRebateMinor=Number(raw.matchedFeeRebateMinor);
    const summary:FinancialEventSummary={...raw,matchedRefundMinor,matchedFeeRebateMinor,unmatchedAmountMinor:Number(raw.unmatchedAmountMinor),netAdjustmentMinor:matchedFeeRebateMinor-matchedRefundMinor};
    type RawItem=Omit<FinancialEventItem,'occurredOn'|'createdAt'>&{occurredOn:string|Date;createdAt:string|Date};
    const rows=await tx.query<RawItem>(`SELECT e.id,e.source_event_id AS "sourceEventId",e.order_id AS "orderId",e.event_type AS "eventType",e.occurred_on AS "occurredOn",e.amount_minor AS "amountMinor",e.note,e.created_at AS "createdAt",count(l.id)::int AS "matchedLineCount"
      FROM app.financial_events e LEFT JOIN app.sales_lines l ON l.tenant_id=e.tenant_id AND l.shop_id=e.shop_id AND l.order_id=e.order_id
      WHERE e.shop_id=$1 GROUP BY e.tenant_id,e.id ORDER BY e.occurred_on DESC,e.created_at DESC LIMIT 100`,[shopId]);
    type RawOrder={orderId:string;eventCount:number;refundMinor:string;feeRebateMinor:string};
    const orders=await tx.query<RawOrder>(`SELECT e.order_id AS "orderId",count(*)::int AS "eventCount",
      coalesce(sum(e.amount_minor) FILTER(WHERE e.event_type='refund'),0)::text AS "refundMinor",
      coalesce(sum(e.amount_minor) FILTER(WHERE e.event_type='fee_rebate'),0)::text AS "feeRebateMinor"
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
