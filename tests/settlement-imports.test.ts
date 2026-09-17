import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll,describe,expect,it } from 'vitest';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo } from '@commerce/domain';
import { commitDraft,saveDraft } from '@commerce/imports';
import { commitMarketplaceSettlement,commitSettlementImport,getSettlementImportSource,inspectMarketplaceSettlement,inspectSettlementFile,previewSettlementImport,settlementImportBatches,settlements } from '@commerce/finance';

afterAll(closePools);
const today=new Date().toISOString().slice(0,10);
const orderMapping={orderId:'order_id',sourceLineId:'source_line_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'};
const settlementMapping={payoutReference:'payout_reference',settledOn:'settled_on',payoutTotal:'payout_total',sourceLineId:'source_line_id',orderId:'order_id',amount:'allocation_amount',note:'note'};

async function sales(amounts=[31900,21900]){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),sku=`SETTLEMENT-IMPORT-${randomUUID()}`;
  await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'สินค้าทดสอบนำเข้า statement',category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{},variants:[{sku,attributes:{},priceMinor:39900,costMinor:18000}]});
  const orders=amounts.map(()=>`SETTLEMENT-IMPORT-ORDER-${randomUUID()}`);
  const rows=orders.map((order,index)=>`${order},SALE-${randomUUID()},${sku},1,${today},${(amounts[index]/100).toFixed(2)},0.00`).join('\n');
  const input={shopId:demo.shops.tiktok,filename:`orders-${randomUUID()}.csv`,delimiter:',' as const,csv:`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${rows}\n`,mapping:orderMapping};
  const draft=await saveDraft(ctx,input);await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});
  return {ctx,orders};
}
function statement(orders:string[],overrides:Partial<{filename:string;csv:string}>={}){
  const payout=`PAYOUT-IMPORT-${randomUUID()}`,lines=orders.map((order,index)=>`${payout},${today},538.00,PAYOUT-LINE-${randomUUID()},${order},${index?'219.00':'319.00'},ไฟล์ statement ทดสอบ`).join('\n');
  return {shopId:demo.shops.tiktok,filename:overrides.filename??`settlement-${randomUUID()}.csv`,delimiter:',' as const,csv:overrides.csv??`payout_reference,settled_on,payout_total,source_line_id,order_id,allocation_amount,note\n${lines}\n`,mapping:settlementMapping};
}

describe('Settlement CSV imports',()=>{
  it('previews and atomically commits a balanced multi-order payout with raw evidence',async()=>{
    const {ctx,orders}=await sales(),input=statement(orders);
    const {mapping:_,...sourceInput}=input;
    await expect(inspectSettlementFile(ctx,sourceInput)).resolves.toMatchObject({total:2,headers:['payout_reference','settled_on','payout_total','source_line_id','order_id','allocation_amount','note']});
    const preview=await previewSettlementImport(ctx,input);
    expect(preview).toMatchObject({total:2,valid:2,invalid:0,payoutCount:1,balancedPayoutCount:1,unmatchedLineCount:0});
    const committed=await commitSettlementImport(ctx,{...input,confirmedStatement:true});
    expect(committed).toMatchObject({duplicate:false,lines:2,payouts:1,unmatchedLines:0});
    const ledger=await settlements(ctx,input.shopId),payout=ledger.payouts.find(row=>row.payoutReference===preview.payouts[0].payoutReference)!;
    expect(payout).toMatchObject({payoutTotalMinor:53800,allocatedMinor:53800,differenceMinor:0,activeLineCount:2,unmatchedLineCount:0});
    expect(ledger.items.filter(row=>row.importBatchId===committed.id).map(row=>row.sourceRecord).sort()).toEqual([1,2]);
    const batches=await settlementImportBatches(ctx,input.shopId),batch=batches.find(row=>row.id===committed.id)!;
    expect(batch).toMatchObject({filename:input.filename,total:2,payoutCount:1,unmatchedLineCount:0});
    const source=await getSettlementImportSource(ctx,committed.id);
    expect(source.content.toString('utf8')).toBe(input.csv);expect(source.sourceHash).toBe(preview.sourceHash);
  });

  it('blocks duplicate source IDs and inconsistent payout summaries before commit',async()=>{
    const {ctx,orders}=await sales(),payout=`PAYOUT-INVALID-${randomUUID()}`,source=`DUPLICATE-${randomUUID()}`;
    const csv=`payout_reference,settled_on,payout_total,source_line_id,order_id,allocation_amount,note\n${payout},${today},538.00,${source},${orders[0]},319.00,บรรทัดแรก\n${payout},${today},539.00,${source},${orders[1]},219.00,บรรทัดสอง\n`;
    const input=statement(orders,{csv}),preview=await previewSettlementImport(ctx,input);
    expect(preview.invalid).toBeGreaterThan(0);expect(preview.rows.flatMap(row=>row.errors)).toEqual(expect.arrayContaining(['รหัสบรรทัดต้นทางซ้ำในไฟล์นี้','วันที่หรือยอดรวมของรอบโอนเดียวกันไม่ตรงกัน']));
    await expect(commitSettlementImport(ctx,{...input,confirmedStatement:true})).rejects.toMatchObject({code:'SETTLEMENT_IMPORT_HAS_ERRORS'});
  });

  it('is idempotent under concurrent confirmation and rejects reused source IDs in another file',async()=>{
    const {ctx,orders}=await sales(),input=statement(orders);
    const results=await Promise.all([commitSettlementImport(ctx,{...input,confirmedStatement:true}),commitSettlementImport(ctx,{...input,confirmedStatement:true})]);
    expect(results.map(result=>result.duplicate).sort()).toEqual([false,true]);expect(new Set(results.map(result=>result.id)).size).toBe(1);
    const changed={...input,filename:`changed-${input.filename}`,csv:input.csv.replace('ไฟล์ statement ทดสอบ','หลักฐานไฟล์ใหม่')};
    const preview=await previewSettlementImport(ctx,changed);expect(preview.invalid).toBe(2);
    await expect(commitSettlementImport(ctx,{...changed,confirmedStatement:true})).rejects.toMatchObject({code:'SETTLEMENT_IMPORT_HAS_ERRORS'});
  });

  it('enforces read/write roles, tenant isolation and append-only source evidence',async()=>{
    const {ctx,orders}=await sales(),input=statement(orders),saved=await commitSettlementImport(ctx,{...input,confirmedStatement:true});
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    expect((await settlementImportBatches(auditor,input.shopId)).some(row=>row.id===saved.id)).toBe(true);
    await expect(getSettlementImportSource(auditor,saved.id)).resolves.toMatchObject({filename:input.filename});
    await expect(previewSettlementImport(auditor,input)).rejects.toMatchObject({status:403});
    await expect(settlementImportBatches(marketing,input.shopId)).rejects.toMatchObject({status:403});
    await expect(getSettlementImportSource(other,saved.id)).rejects.toMatchObject({status:404});
    await expect(withTenant(ctx,tx=>tx.query('UPDATE app.settlement_import_batches SET filename=$1 WHERE id=$2',['changed.csv',saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.settlement_import_batches WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
  });

  it('detects and commits TikTok Shop, Shopee and Lazada CSV statements without manual mapping',async()=>{
    const fixtures=[
      {key:'tiktok-shop-th',file:'apps/web/public/examples/tiktok-settlement-synthetic.csv',orders:['TT-ORDER-10001','TT-ORDER-10002']},
      {key:'shopee-th',file:'apps/web/public/examples/shopee-income-synthetic.csv',orders:['SP-ORDER-10001','SP-ORDER-10002']},
      {key:'lazada-th',file:'apps/web/public/examples/lazada-statement-synthetic.csv',orders:['LZ-ORDER-10001','LZ-ORDER-10002']},
    ] as const;
    for(const fixture of fixtures){
      const {ctx,orders}=await sales(),template=await readFile(fixture.file,'utf8');
      const csv=template.replace(fixture.orders[0],orders[0]).replace(fixture.orders[1],orders[1]);
      const input={shopId:demo.shops.tiktok,filename:fixture.file.split('/').at(-1)!,contentType:'text/csv' as const,delimiter:',' as const,contentBase64:Buffer.from(csv).toString('base64')};
      const inspection=await inspectMarketplaceSettlement(ctx,input);expect(inspection.detected).toBe(true);
      if(!inspection.detected)throw new Error('adapter not detected');
      expect(inspection.preview).toMatchObject({adapterKey:fixture.key,total:2,valid:2,invalid:0,payoutCount:1,balancedPayoutCount:1,unmatchedLineCount:0});
      const saved=await commitMarketplaceSettlement(ctx,{...input,adapterKey:fixture.key,confirmedStatement:true});
      expect(saved).toMatchObject({duplicate:false,lines:2,payouts:1,unmatchedLines:0});
      await expect(commitMarketplaceSettlement(ctx,{...input,adapterKey:fixture.key,confirmedStatement:true})).resolves.toMatchObject({id:saved.id,duplicate:true});
      const source=await getSettlementImportSource(ctx,saved.id);expect(source.content.equals(Buffer.from(csv))).toBe(true);expect(source.contentType).toBe('text/csv');
    }
  });

  it('reads the TikTok multi-sheet XLSX, selects Order details and preserves the exact workbook',async()=>{
    const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),content=await readFile('tests/fixtures/tiktok-settlement-synthetic.xlsx');
    const input={shopId:demo.shops.tiktok,filename:'tiktok-settlement-synthetic.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const,contentBase64:content.toString('base64')};
    const inspection=await inspectMarketplaceSettlement(ctx,input);expect(inspection.detected).toBe(true);
    if(!inspection.detected)throw new Error('adapter not detected');
    expect(inspection.preview).toMatchObject({adapterKey:'tiktok-shop-th',sourceSheet:'Order details',total:2,valid:2,invalid:0,unmatchedLineCount:2});
    const saved=await commitMarketplaceSettlement(ctx,{...input,adapterKey:'tiktok-shop-th',confirmedStatement:true});
    const source=await getSettlementImportSource(ctx,saved.id);expect(source.content.equals(content)).toBe(true);expect(source.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('falls back for unknown CSV headers and blocks negative marketplace adjustments',async()=>{
    const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),generic='payout_reference,settled_on,payout_total,source_line_id,order_id,allocation_amount\nP-1,2026-09-17,10.00,L-1,O-1,10.00\n';
    await expect(inspectMarketplaceSettlement(ctx,{shopId:demo.shops.tiktok,filename:'generic.csv',contentType:'text/csv',delimiter:',',contentBase64:Buffer.from(generic).toString('base64')})).resolves.toMatchObject({detected:false,total:1});
    const negative='Payout ID,Order ID,Release Date,Total Released Amount,Transaction ID,Released Amount,Description\nSP-NEG,ORDER-NEG,2026-09-17,-10.00,SP-NEG-TXN,-10.00,Adjustment\n';
    const input={shopId:demo.shops.tiktok,filename:'shopee-negative.csv',contentType:'text/csv' as const,delimiter:',' as const,contentBase64:Buffer.from(negative).toString('base64')};
    const inspection=await inspectMarketplaceSettlement(ctx,input);expect(inspection.detected).toBe(true);
    if(!inspection.detected)throw new Error('adapter not detected');
    expect(inspection.preview.rows[0].errors).toContain('รายการยอดติดลบหรือศูนย์ต้องแยกเป็นค่าธรรมเนียมหรือรายการปรับยอดก่อนนำเข้า');
    await expect(commitMarketplaceSettlement(ctx,{...input,adapterKey:'shopee-th',confirmedStatement:true})).rejects.toMatchObject({code:'SETTLEMENT_IMPORT_HAS_ERRORS'});
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino);await expect(inspectMarketplaceSettlement(auditor,input)).rejects.toMatchObject({status:403});
  });
});
