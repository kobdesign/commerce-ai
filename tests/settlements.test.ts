import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo } from '@commerce/domain';
import { commitDraft,saveDraft } from '@commerce/imports';
import { recordFinancialEvent,recordSettlementLine,reverseSettlementLine,settlements } from '@commerce/finance';

afterAll(closePools);
const today=new Date().toISOString().slice(0,10);
const mapping={orderId:'order_id',sourceLineId:'source_line_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'};

async function sale(amounts=[31900]){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),sku=`SETTLE-${randomUUID()}`,orderId=`SETTLE-ORDER-${randomUUID()}`;
  await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'สินค้าทดสอบกระทบยอด',category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{},variants:[{sku,attributes:{},priceMinor:39900,costMinor:18000}]});
  const rows=amounts.map(amount=>`${orderId},SETTLE-SALE-${randomUUID()},${sku},1,${today},${(amount/100).toFixed(2)},0.00`).join('\n');
  const input={shopId:demo.shops.tiktok,filename:`settlement-sale-${randomUUID()}.csv`,delimiter:',' as const,csv:`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${rows}\n`,mapping};
  const draft=await saveDraft(ctx,input);await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
  return {ctx,orderId};
}
function line(orderId:string,payoutReference=`PAYOUT-${randomUUID()}`,amountMinor=31900,payoutTotalMinor=amountMinor,sourceLineId=`PAYOUT-LINE-${randomUUID()}`){
  return {shopId:demo.shops.tiktok,sourceLineId,payoutReference,orderId,settledOn:today,payoutTotalMinor,amountMinor,note:'Statement เงินโอนจากแพลตฟอร์ม',confirmedStatement:true as const};
}

describe('Settlement reconciliation',()=>{
  it('balances one payout with multiple allocations and reconciles the order total',async()=>{
    const {ctx,orderId}=await sale([31900,10000]),payoutReference=`PAYOUT-MULTI-${randomUUID()}`;
    await recordSettlementLine(ctx,line(orderId,payoutReference,31900,41900));
    await recordSettlementLine(ctx,line(orderId,payoutReference,10000,41900));
    const ledger=await settlements(ctx,demo.shops.tiktok),payout=ledger.payouts.find(row=>row.payoutReference===payoutReference)!,order=ledger.orders.find(row=>row.orderId===orderId)!;
    expect(payout).toMatchObject({payoutTotalMinor:41900,allocatedMinor:41900,differenceMinor:0,activeLineCount:2,unmatchedLineCount:0});
    expect(order).toMatchObject({expectedReceiptMinor:41900,settledMinor:41900,differenceMinor:0,settlementLineCount:2});
    expect(ledger.summary.balancedPayoutCount).toBeGreaterThan(0);
  });

  it('reconciles one order paid across multiple payouts after a recorded refund',async()=>{
    const {ctx,orderId}=await sale();
    await recordFinancialEvent(ctx,{shopId:demo.shops.tiktok,sourceEventId:`SETTLE-REFUND-${randomUUID()}`,orderId,eventType:'refund',occurredOn:today,amountMinor:10000,note:'คืนเงินบางส่วนก่อนรอบโอน',confirmedOutsideImportedReceipt:true});
    await recordSettlementLine(ctx,line(orderId,`PAYOUT-A-${randomUUID()}`,10000));
    await recordSettlementLine(ctx,line(orderId,`PAYOUT-B-${randomUUID()}`,11900));
    const order=(await settlements(ctx,demo.shops.tiktok)).orders.find(row=>row.orderId===orderId)!;
    expect(order).toMatchObject({expectedReceiptMinor:21900,settledMinor:21900,differenceMinor:0,settlementLineCount:2});
  });

  it('keeps a fully allocated payout unresolved when its order is not imported',async()=>{
    const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),orderId=`MISSING-${randomUUID()}`,input=line(orderId);
    await recordSettlementLine(ctx,input);
    const ledger=await settlements(ctx,input.shopId),payout=ledger.payouts.find(row=>row.payoutReference===input.payoutReference)!;
    expect(payout).toMatchObject({differenceMinor:0,unmatchedLineCount:1});
    expect(ledger.items.find(row=>row.sourceLineId===input.sourceLineId)).toMatchObject({matched:false});
    expect(ledger.orders.some(row=>row.orderId===orderId)).toBe(false);
  });

  it('is idempotent and rejects conflicting source or payout summary data',async()=>{
    const {ctx,orderId}=await sale(),payoutReference=`PAYOUT-REPLAY-${randomUUID()}`,sourceLineId=`PAYOUT-REPLAY-LINE-${randomUUID()}`,input=line(orderId,payoutReference,10000,31900,sourceLineId);
    const results=await Promise.all([recordSettlementLine(ctx,input),recordSettlementLine(ctx,input)]);
    expect(results.map(result=>result.duplicate).sort()).toEqual([false,true]);
    await expect(recordSettlementLine(ctx,{...input,amountMinor:11000})).rejects.toMatchObject({code:'SETTLEMENT_LINE_CONFLICT'});
    await expect(recordSettlementLine(ctx,line(orderId,payoutReference,21900,32000))).rejects.toMatchObject({code:'PAYOUT_SUMMARY_CONFLICT'});
  });

  it('reverses one allocation once and preserves both rows',async()=>{
    const {ctx,orderId}=await sale(),input=line(orderId),saved=await recordSettlementLine(ctx,input),correction={shopId:input.shopId,note:'เลือกเลขคำสั่งซื้อผิดจาก statement',confirmedCorrection:true as const};
    const reversed=await reverseSettlementLine(ctx,saved.id,correction);
    await expect(reverseSettlementLine(ctx,saved.id,correction)).resolves.toMatchObject({id:reversed.id,duplicate:true});
    const ledger=await settlements(ctx,input.shopId),payout=ledger.payouts.find(row=>row.payoutReference===input.payoutReference)!,order=ledger.orders.find(row=>row.orderId===orderId)!;
    expect(payout).toMatchObject({allocatedMinor:0,differenceMinor:-31900,activeLineCount:0});
    expect(order).toMatchObject({expectedReceiptMinor:31900,settledMinor:0,differenceMinor:-31900,settlementLineCount:0});
    expect(ledger.items.filter(row=>row.sourceLineId===input.sourceLineId||row.reversesLineId===saved.id)).toHaveLength(2);
    expect(await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE action='settlement.line.reversed' AND details->>'reversedLineId'=$1",[saved.id]))).toHaveLength(1);
  });

  it('enforces roles, tenant isolation, reversal integrity and append-only history',async()=>{
    const {ctx,orderId}=await sale(),input=line(orderId),saved=await recordSettlementLine(ctx,input);
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    expect((await settlements(auditor,input.shopId)).items.some(row=>row.id===saved.id)).toBe(true);
    await expect(recordSettlementLine(auditor,line(orderId))).rejects.toMatchObject({status:403});
    await expect(reverseSettlementLine(auditor,saved.id,{shopId:input.shopId,note:'ผู้ตรวจไม่ควรแก้กลับ',confirmedCorrection:true})).rejects.toMatchObject({status:403});
    await expect(settlements(marketing,input.shopId)).rejects.toMatchObject({status:403});
    await expect(settlements(other,demo.shops.tiktok)).rejects.toMatchObject({status:403});
    await expect(withTenant(ctx,tx=>tx.query(`INSERT INTO app.settlement_lines(tenant_id,id,shop_id,source_line_id,payout_reference,order_id,settled_on,payout_total_minor,amount_minor,source_scope,note,actor_id,reverses_line_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'settlement_reversal','ข้อมูลปลอม',$9,$10)`,[ctx.tenantId,randomUUID(),input.shopId,`FORGED-${randomUUID()}`,input.payoutReference,orderId,today,input.payoutTotalMinor,ctx.userId,saved.id]))).rejects.toMatchObject({code:'23514'});
    await expect(withTenant(ctx,tx=>tx.query('UPDATE app.settlement_lines SET amount_minor=1 WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.settlement_lines WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
  });
});
