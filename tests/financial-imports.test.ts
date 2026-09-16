import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo,getProductForEdit,updateProduct } from '@commerce/domain';
import { commitDraft,financialSummary,resolveMissingCost,reviewItems,saveDraft } from '@commerce/imports';

afterAll(closePools);
const today=new Date().toISOString().slice(0,10);
const mapping={orderId:'order_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'};
async function fixture(costMinor:number|null=18000){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),sku=`FIN-${randomUUID()}`;
  const created=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'สินค้าทดสอบการเงิน',category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{},variants:[{sku,attributes:{},priceMinor:39900,costMinor}]});
  return {ctx,sku,productId:created.id};
}
function source(sku:string,rows=`ORDER-${randomUUID()},${sku},1,${today},319.00,80.00`){
  return {shopId:demo.shops.tiktok,filename:`financial-${randomUUID()}.csv`,delimiter:',' as const,csv:`order_id,sku,quantity,date,net_receipt,platform_fee\n${rows}\n`,mapping};
}

describe('Committed order lines and deterministic contribution',()=>{
  it('commits exact minor units once, snapshots cost and exposes source evidence',async()=>{
    const {ctx,sku,productId}=await fixture(),input=source(sku),draft=await saveDraft(ctx,input);
    const [a,b]=await Promise.all([commitDraft(ctx,{shopId:input.shopId,draftId:draft.id}),commitDraft(ctx,{shopId:input.shopId,draftId:draft.id})]);
    expect(a.id).toBe(b.id);expect([a.duplicate,b.duplicate].sort()).toEqual([false,true]);
    let summary=await financialSummary(ctx,input.shopId),row=summary.bySku.find(r=>r.sku===sku)!;
    expect(row).toMatchObject({quantity:1,lineCount:1,netReceiptMinor:31900,platformFeeMinor:8000,feeLineCount:1,cogsMinor:18000,contributionMinor:13900,missingCostLines:0});
    expect(summary.orders.find(r=>r.draftId===draft.id)).toMatchObject({netReceiptMinor:31900,cogsMinor:18000,contributionMinor:13900});
    const product=await getProductForEdit(ctx,input.shopId,productId),change={shopId:input.shopId,version:product.version,name:product.name,category:product.category,salesUnit:product.salesUnit,attributes:product.attributes,variants:product.variants.map(v=>({id:v.id,priceMinor:v.priceMinor,costMinor:20000})),reason:'ต้นทุนรอบใหม่'};
    await updateProduct(ctx,productId,change);summary=await financialSummary(ctx,input.shopId);row=summary.bySku.find(r=>r.sku===sku)!;
    expect(row.cogsMinor).toBe(18000);expect(row.contributionMinor).toBe(13900);
    expect(await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE action='import.batch.committed' AND entity_id=$1",[a.id]))).toHaveLength(1);
  });

  it('keeps incomplete contribution null when cost is missing and distinguishes absent fee data',async()=>{
    const {ctx,sku}=await fixture(null),input={...source(sku),mapping:{...mapping,platformFee:''},csv:`order_id,sku,quantity,date,net_receipt\nMISSING-${randomUUID()},${sku},2,${today},500.00\n`};
    const draft=await saveDraft(ctx,input);await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
    const row=(await financialSummary(ctx,input.shopId)).bySku.find(r=>r.sku===sku)!;
    expect(row).toMatchObject({quantity:2,netReceiptMinor:50000,platformFeeMinor:0,feeLineCount:0,missingCostLines:1,cogsMinor:null,contributionMinor:null});
  });

  it('aggregates a multi-SKU order, preserves partial fee coverage and allows a known zero cost',async()=>{
    const first=await fixture(10000),second=await fixture(0),order=`MULTI-${randomUUID()}`;
    const input=source(first.sku,`${order},${first.sku},2,${today},150.00,10.00\n${order},${second.sku},1,${today},20.00,`);
    const draft=await saveDraft(first.ctx,input);await commitDraft(first.ctx,{shopId:input.shopId,draftId:draft.id});
    const summary=await financialSummary(first.ctx,input.shopId),row=summary.orders.find(r=>r.orderId===order)!;
    expect(row).toMatchObject({lineCount:2,netReceiptMinor:17000,platformFeeMinor:1000,feeLineCount:1,missingCostLines:0,cogsMinor:20000,contributionMinor:-3000});
    expect(summary.bySku.find(r=>r.sku===second.sku)).toMatchObject({cogsMinor:0,contributionMinor:2000,missingCostLines:0});
  });

  it('selects the latest cost effective by each sale date instead of the current cost',async()=>{
    const {ctx,sku,productId}=await fixture(null),product=await getProductForEdit(ctx,demo.shops.tiktok,productId),variantId=product.variants[0].id;
    await withTenant(ctx,async tx=>{
      await tx.query('INSERT INTO app.cost_versions(tenant_id,id,variant_id,amount_minor,effective_at,note) VALUES($1,$2,$3,$4,$5,$6)',[ctx.tenantId,randomUUID(),variantId,10000,'2026-01-01T00:00:00+07:00','ต้นทุนช่วงแรก']);
      await tx.query('INSERT INTO app.cost_versions(tenant_id,id,variant_id,amount_minor,effective_at,note) VALUES($1,$2,$3,$4,$5,$6)',[ctx.tenantId,randomUUID(),variantId,20000,'2026-01-10T00:00:00+07:00','ต้นทุนช่วงถัดมา']);
    });
    const early=`COST-EARLY-${randomUUID()}`,late=`COST-LATE-${randomUUID()}`;
    const input=source(sku,`${early},${sku},1,2026-01-05,300.00,\n${late},${sku},1,2026-01-15,300.00,`),draft=await saveDraft(ctx,input);
    await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
    const orders=(await financialSummary(ctx,input.shopId)).orders;
    expect(orders.find(r=>r.orderId===early)).toMatchObject({cogsMinor:10000,contributionMinor:20000});
    expect(orders.find(r=>r.orderId===late)).toMatchObject({cogsMinor:20000,contributionMinor:10000});
  });

  it('blocks invalid and repeated source rows before creating a batch',async()=>{
    const {ctx,sku}=await fixture(),bad=source(sku,`DUP-${randomUUID()},${sku},1,${today},319.00,80.00\nDUP-${randomUUID()},UNKNOWN,0,not-a-date,-1,-1`);
    const invalid=await saveDraft(ctx,bad);await expect(commitDraft(ctx,{shopId:bad.shopId,draftId:invalid.id})).rejects.toMatchObject({code:'IMPORT_HAS_ERRORS'});
    const same=`SAME-${randomUUID()},${sku},1,${today},319.00,80.00`,duplicate=source(sku,`${same}\n${same}`),draft=await saveDraft(ctx,duplicate);
    await expect(commitDraft(ctx,{shopId:duplicate.shopId,draftId:draft.id})).rejects.toMatchObject({code:'DUPLICATE_ROWS'});
    expect(await withTenant(ctx,tx=>tx.query('SELECT id FROM app.import_batches WHERE draft_id=ANY($1::uuid[])',[[invalid.id,draft.id]]))).toEqual([]);
  });

  it('enforces tenant, role and append-only boundaries at the database layer',async()=>{
    const {ctx,sku}=await fixture(),input=source(sku),draft=await saveDraft(ctx,input),batch=await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
    const marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    expect(await withTenant(marketing,tx=>tx.query('SELECT * FROM app.sales_lines'))).toEqual([]);
    await expect(financialSummary(marketing,input.shopId)).rejects.toMatchObject({status:403});
    expect((await financialSummary(auditor,input.shopId)).bySku.some(r=>r.sku===sku)).toBe(true);
    await expect(commitDraft(auditor,{shopId:input.shopId,draftId:draft.id})).rejects.toMatchObject({status:403});
    await expect(commitDraft(other,{shopId:demo.shops.goods,draftId:draft.id})).rejects.toMatchObject({status:404});
    await expect(withTenant(ctx,tx=>tx.query('UPDATE app.sales_lines SET net_receipt_minor=1 WHERE batch_id=$1',[batch.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.sales_lines WHERE batch_id=$1',[batch.id]))).rejects.toMatchObject({code:'42501'});
  });

  it('resolves a missing imported cost with an append-only calculation version',async()=>{
    const {ctx,sku}=await fixture(null),order=`REVIEW-${randomUUID()}`,input=source(sku,`${order},${sku},2,${today},500.00,20.00`);
    const draft=await saveDraft(ctx,input),batch=await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
    const before=await reviewItems(ctx,input.shopId),item=before.items.find(r=>r.orderId===order)!;
    expect(item).toMatchObject({version:1,sku,quantity:2,netReceiptMinor:50000,currentCostMinor:null});
    expect((await financialSummary(ctx,input.shopId)).orders.find(r=>r.orderId===order)).toMatchObject({missingCostLines:1,cogsMinor:null,contributionMinor:null});
    await resolveMissingCost(ctx,{shopId:input.shopId,lineId:item.lineId,version:item.version,costMinor:20000,reason:'ยืนยันจากใบแจ้งต้นทุนรอบเดือน'});
    expect((await reviewItems(ctx,input.shopId)).items.some(r=>r.lineId===item.lineId)).toBe(false);
    expect((await financialSummary(ctx,input.shopId)).orders.find(r=>r.orderId===order)).toMatchObject({missingCostLines:0,manualCostLines:1,cogsMinor:40000,contributionMinor:10000});
    const [sourceLine]=await withTenant(ctx,tx=>tx.query<{unit_cost_minor:number|null}>('SELECT unit_cost_minor FROM app.sales_lines WHERE batch_id=$1',[batch.id]));
    expect(sourceLine.unit_cost_minor).toBeNull();
    const versions=await withTenant(ctx,tx=>tx.query<{version:number;unit_cost_minor:number|null;basis:string;reason:string|null}>('SELECT version,unit_cost_minor,basis,reason FROM app.sales_line_calculations WHERE sales_line_id=$1 ORDER BY version',[item.lineId]));
    expect(versions).toEqual([{version:1,unit_cost_minor:null,basis:'import',reason:null},{version:2,unit_cost_minor:20000,basis:'manual_missing_cost',reason:'ยืนยันจากใบแจ้งต้นทุนรอบเดือน'}]);
    expect(await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE action='sales_line.cost_resolved' AND entity_id=$1",[item.lineId]))).toHaveLength(1);
  });

  it('accepts a confirmed zero cost and serializes concurrent resolutions',async()=>{
    const zero=await fixture(null),zeroOrder=`ZERO-${randomUUID()}`,zeroInput=source(zero.sku,`${zeroOrder},${zero.sku},1,${today},50.00,`),zeroDraft=await saveDraft(zero.ctx,zeroInput);
    await commitDraft(zero.ctx,{shopId:zeroInput.shopId,draftId:zeroDraft.id});
    const zeroItem=(await reviewItems(zero.ctx,zeroInput.shopId)).items.find(r=>r.orderId===zeroOrder)!;
    await resolveMissingCost(zero.ctx,{shopId:zeroInput.shopId,lineId:zeroItem.lineId,version:1,costMinor:0,reason:'สินค้าแถมจากผู้ผลิต'});
    expect((await financialSummary(zero.ctx,zeroInput.shopId)).orders.find(r=>r.orderId===zeroOrder)).toMatchObject({missingCostLines:0,cogsMinor:0,contributionMinor:5000});

    const concurrent=await fixture(null),order=`RACE-${randomUUID()}`,input=source(concurrent.sku,`${order},${concurrent.sku},1,${today},300.00,`),draft=await saveDraft(concurrent.ctx,input);
    await commitDraft(concurrent.ctx,{shopId:input.shopId,draftId:draft.id});
    const item=(await reviewItems(concurrent.ctx,input.shopId)).items.find(r=>r.orderId===order)!;
    const results=await Promise.allSettled([
      resolveMissingCost(concurrent.ctx,{shopId:input.shopId,lineId:item.lineId,version:1,costMinor:10000,reason:'หลักฐานต้นทุนชุดแรก'}),
      resolveMissingCost(concurrent.ctx,{shopId:input.shopId,lineId:item.lineId,version:1,costMinor:12000,reason:'หลักฐานต้นทุนชุดที่สอง'}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'STALE_REVIEW'});
    expect(await withTenant(concurrent.ctx,tx=>tx.query('SELECT id FROM app.sales_line_calculations WHERE sales_line_id=$1',[item.lineId]))).toHaveLength(2);
  });

  it('enforces review roles, tenant isolation and immutable calculation history',async()=>{
    const {ctx,sku}=await fixture(null),order=`ACCESS-${randomUUID()}`,input=source(sku,`${order},${sku},1,${today},250.00,`),draft=await saveDraft(ctx,input);
    await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
    const item=(await reviewItems(ctx,input.shopId)).items.find(r=>r.orderId===order)!;
    const marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    expect((await reviewItems(auditor,input.shopId)).items.some(r=>r.lineId===item.lineId)).toBe(true);
    await expect(resolveMissingCost(auditor,{shopId:input.shopId,lineId:item.lineId,version:1,costMinor:10000,reason:'ห้ามผู้ตรวจแก้'})).rejects.toMatchObject({status:403});
    await expect(reviewItems(marketing,input.shopId)).rejects.toMatchObject({status:403});
    await expect(resolveMissingCost(other,{shopId:demo.shops.goods,lineId:item.lineId,version:1,costMinor:10000,reason:'ข้ามบริษัท'})).rejects.toMatchObject({status:404});
    await expect(withTenant(ctx,tx=>tx.query('UPDATE app.sales_line_calculations SET unit_cost_minor=1 WHERE sales_line_id=$1',[item.lineId]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.sales_line_calculations WHERE sales_line_id=$1',[item.lineId]))).rejects.toMatchObject({code:'42501'});

    const known=await fixture(10000),knownOrder=`KNOWN-${randomUUID()}`,knownInput=source(known.sku,`${knownOrder},${known.sku},1,${today},250.00,`),knownDraft=await saveDraft(known.ctx,knownInput),knownBatch=await commitDraft(known.ctx,{shopId:knownInput.shopId,draftId:knownDraft.id});
    const [knownLine]=await withTenant(known.ctx,tx=>tx.query<{id:string}>('SELECT id FROM app.sales_lines WHERE batch_id=$1',[knownBatch.id]));
    await expect(resolveMissingCost(known.ctx,{shopId:knownInput.shopId,lineId:knownLine.id,version:1,costMinor:12000,reason:'ไม่ควรแก้รายการที่มีต้นทุน'})).rejects.toMatchObject({code:'ALREADY_RESOLVED'});
  });
});
