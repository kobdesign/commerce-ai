import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo } from '@commerce/domain';
import { commitDraft,financialSummary,saveDraft } from '@commerce/imports';
import { applyFinancialEvents,financialEvents,recordFinancialEvent,type FinancialEventType } from '@commerce/finance';

afterAll(closePools);
const today=new Date().toISOString().slice(0,10);
const mapping={orderId:'order_id',sourceLineId:'source_line_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'};

async function sale(lines=1){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),sku=`EVENT-${randomUUID()}`,orderId=`EVENT-ORDER-${randomUUID()}`;
  await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'สินค้าทดสอบรายการปรับยอด',category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{},variants:[{sku,attributes:{},priceMinor:39900,costMinor:18000}]});
  const rows=Array.from({length:lines},(_,index)=>`${orderId},EVENT-LINE-${randomUUID()},${sku},1,${today},${index?100:319}.00,${index?10:80}.00`).join('\n');
  const input={shopId:demo.shops.tiktok,filename:`events-${randomUUID()}.csv`,delimiter:',' as const,csv:`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${rows}\n`,mapping};
  const draft=await saveDraft(ctx,input);const batch=await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
  return {ctx,sku,orderId,batch};
}
function event(orderId:string,eventType:FinancialEventType,amountMinor:number,sourceEventId=`EVENT-${randomUUID()}`){
  return {shopId:demo.shops.tiktok,sourceEventId,orderId,eventType,occurredOn:today,amountMinor,note:eventType==='refund'?'คืนเงินบางส่วน ลูกค้ายังเก็บสินค้า':'แพลตฟอร์มคืนค่าธรรมเนียม',confirmedOutsideImportedReceipt:true as const};
}

describe('Append-only financial events',()=>{
  it('applies a partial refund and fee rebate once without rewriting the sales fact',async()=>{
    const {ctx,orderId,batch}=await sale(),before=(await financialSummary(ctx,demo.shops.tiktok)).orders.find(row=>row.orderId===orderId)!;
    expect(before).toMatchObject({netReceiptMinor:31900,cogsMinor:18000,contributionMinor:13900});
    expect(await recordFinancialEvent(ctx,event(orderId,'refund',10000))).toMatchObject({duplicate:false,matchedLineCount:1});
    expect(await recordFinancialEvent(ctx,event(orderId,'fee_rebate',1000))).toMatchObject({duplicate:false,matchedLineCount:1});
    const ledger=await financialEvents(ctx,demo.shops.tiktok),adjustment=ledger.byOrder.find(row=>row.orderId===orderId)!;
    expect(adjustment).toMatchObject({eventCount:2,refundMinor:10000,feeRebateMinor:1000,netAdjustmentMinor:-9000});
    expect(applyFinancialEvents(before.netReceiptMinor,before.cogsMinor,adjustment.refundMinor,adjustment.feeRebateMinor)).toEqual({adjustedReceiptMinor:22900,adjustedContributionMinor:4900});
    const [stored]=await withTenant(ctx,tx=>tx.query<{net_receipt_minor:number;cogs_minor:string}>('SELECT net_receipt_minor,cogs_minor::text FROM app.sales_lines WHERE batch_id=$1',[batch.id]));
    expect(stored).toEqual({net_receipt_minor:31900,cogs_minor:'18000'});
    expect(await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE action='financial_event.recorded' AND details->>'orderId'=$1",[orderId]))).toHaveLength(2);
  });

  it('matches one order to multiple sale lines and keeps unmatched amounts outside matched totals',async()=>{
    const {ctx,orderId}=await sale(2);
    const matched=await recordFinancialEvent(ctx,event(orderId,'refund',5000)),missingOrder=`MISSING-${randomUUID()}`;
    expect(matched.matchedLineCount).toBe(2);
    expect(await recordFinancialEvent(ctx,event(missingOrder,'refund',7000))).toMatchObject({matchedLineCount:0});
    const ledger=await financialEvents(ctx,demo.shops.tiktok);
    expect(ledger.summary.unmatchedAmountMinor).toBe(7000);
    expect(ledger.byOrder.find(row=>row.orderId===orderId)).toMatchObject({refundMinor:5000,feeRebateMinor:0,netAdjustmentMinor:-5000});
    expect(ledger.items.find(row=>row.orderId===missingOrder)).toMatchObject({matchedLineCount:0});
    expect(ledger.byOrder.find(row=>row.orderId===missingOrder)).toBeUndefined();
  });

  it('is idempotent under replay and rejects changed data under the same source identity',async()=>{
    const {ctx,orderId}=await sale(),sourceEventId=`REPLAY-${randomUUID()}`,input=event(orderId,'refund',1200,sourceEventId);
    const results=await Promise.all([recordFinancialEvent(ctx,input),recordFinancialEvent(ctx,input)]);
    expect(results.map(row=>row.duplicate).sort()).toEqual([false,true]);
    await expect(recordFinancialEvent(ctx,{...input,amountMinor:1300})).rejects.toMatchObject({code:'EVENT_ID_CONFLICT'});
    const [{count}]=await withTenant(ctx,tx=>tx.query<{count:number}>('SELECT count(*)::int AS count FROM app.financial_events WHERE shop_id=$1 AND source_event_id=$2',[demo.shops.tiktok,sourceEventId]));
    expect(count).toBe(1);
  });

  it('enforces roles, tenant isolation and append-only history at the database layer',async()=>{
    const {ctx,orderId}=await sale(),saved=await recordFinancialEvent(ctx,event(orderId,'refund',900));
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    expect((await financialEvents(auditor,demo.shops.tiktok)).items.some(row=>row.id===saved.id)).toBe(true);
    await expect(recordFinancialEvent(auditor,event(orderId,'refund',100))).rejects.toMatchObject({status:403});
    await expect(financialEvents(marketing,demo.shops.tiktok)).rejects.toMatchObject({status:403});
    await expect(financialEvents(other,demo.shops.tiktok)).rejects.toMatchObject({status:403});
    await expect(withTenant(ctx,tx=>tx.query('UPDATE app.financial_events SET amount_minor=1 WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.financial_events WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
  });
});
