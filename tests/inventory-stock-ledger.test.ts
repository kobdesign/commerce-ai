import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { centralInventoryOverview,createProductFamily,demo,inventoryOverview,recordInventoryMovement } from '@commerce/domain';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function fixture(){
  const ctx=await owner(),sku='INV-'+randomUUID(),created=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'Inventory '+randomUUID(),category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:25000,costMinor:9000}]});
  return {ctx,productId:created.id,variantId:created.variantIds[0],sku};
}
function movement(row:Awaited<ReturnType<typeof fixture>>,movementType:'opening'|'receipt'|'adjustment_in'|'adjustment_out',quantity:number,sourceReference:string=randomUUID(),reason='ตรวจนับและยืนยันจากเอกสารแล้ว'){
  return {shopId:demo.shops.tiktok,productId:row.productId,variantId:row.variantId,movementType,quantity,sourceReference,reason,confirmed:true as const};
}

describe('Inventory authority and stock ledger',()=>{
  it('records an immutable movement and derives on-hand, reserved and available from one company warehouse',async()=>{
    const row=await fixture(),saved=await recordInventoryMovement(row.ctx,movement(row,'opening',12,'OPEN-'+randomUUID()));
    expect(saved).toMatchObject({duplicate:false,onHand:12,reserved:0,version:2});
    const overview=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(overview).toMatchObject({authority:'manual_ledger',canWrite:true,location:{code:'MAIN',name:'คลังหลัก'}});
    expect(overview.variants[0]).toMatchObject({id:row.variantId,onHand:12,reserved:0});
    expect(overview.variants[0].onHand-overview.variants[0].reserved).toBe(12);
    expect(overview.movements[0]).toMatchObject({id:saved.id,movementType:'opening',quantityDelta:12,balanceAfter:12});
    const central=await centralInventoryOverview(row.ctx,{search:row.sku});
    expect(central).toMatchObject({authority:'manual_ledger',canWrite:true,location:{code:'MAIN'},query:{totalRows:1}});
    expect(central.rows[0]).toMatchObject({productId:row.productId,variantId:row.variantId,sku:row.sku,onHand:12,reserved:0,available:12});
    expect(central.rows[0].channels).toEqual(expect.arrayContaining([expect.objectContaining({shopId:demo.shops.tiktok,channel:'tiktok',publishedQuantity:null,syncedAt:null})]));
    expect(await withTenant(row.ctx,tx=>tx.query("SELECT action FROM app.audit_events WHERE entity_id=$1",[saved.id]))).toEqual([{action:'inventory.movement_recorded'}]);
  });

  it('combines products from every authorized sales channel without inventing channel stock',async()=>{
    const ctx=await owner(),tiktok=await centralInventoryOverview(ctx,{search:'CH-L-BK-32'}),shopee=await centralInventoryOverview(ctx,{search:'SC-DAILY-30'});
    expect(tiktok.rows[0]?.channels).toEqual(expect.arrayContaining([expect.objectContaining({shopId:demo.shops.tiktok,channel:'tiktok',publishedQuantity:null})]));
    expect(shopee).toMatchObject({query:{totalRows:1},rows:[{sku:'SC-DAILY-30'}]});
    expect(shopee.rows[0]?.channels).toEqual(expect.arrayContaining([expect.objectContaining({shopId:demo.shops.shopee,channel:'shopee',publishedQuantity:null})]));
  });

  it('supports receipts and count adjustments while refusing a negative physical balance',async()=>{
    const row=await fixture();
    await recordInventoryMovement(row.ctx,movement(row,'receipt',10));
    await recordInventoryMovement(row.ctx,movement(row,'adjustment_in',2));
    const reduced=await recordInventoryMovement(row.ctx,movement(row,'adjustment_out',5));
    expect(reduced.onHand).toBe(7);
    await expect(recordInventoryMovement(row.ctx,movement(row,'adjustment_out',8))).rejects.toMatchObject({status:409,code:'INSUFFICIENT_STOCK'});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0].onHand).toBe(7);
  });

  it('is retry-safe for the same SKU and reference and rejects a changed payload',async()=>{
    const row=await fixture(),reference='PO-'+randomUUID(),payload=movement(row,'receipt',4,reference);
    const first=await recordInventoryMovement(row.ctx,payload),retry=await recordInventoryMovement(row.ctx,payload);
    expect(retry).toMatchObject({id:first.id,duplicate:true,onHand:4});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).movements).toHaveLength(1);
    await expect(recordInventoryMovement(row.ctx,{...payload,quantity:5})).rejects.toMatchObject({code:'INVENTORY_REFERENCE_CONFLICT'});
  });

  it('allows an opening balance only before the SKU has ledger history',async()=>{
    const row=await fixture();
    await recordInventoryMovement(row.ctx,movement(row,'opening',3));
    await expect(recordInventoryMovement(row.ctx,movement(row,'opening',2))).rejects.toMatchObject({code:'INVENTORY_OPENING_EXISTS'});
  });

  it('serializes concurrent reductions so only available physical stock can leave',async()=>{
    const row=await fixture();await recordInventoryMovement(row.ctx,movement(row,'receipt',1));
    const results=await Promise.allSettled([
      recordInventoryMovement(row.ctx,movement(row,'adjustment_out',1,'COUNT-A-'+randomUUID())),
      recordInventoryMovement(row.ctx,movement(row,'adjustment_out',1,'COUNT-B-'+randomUUID())),
    ]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0].onHand).toBe(0);
  });

  it('enforces operator, auditor, marketing and tenant boundaries',async()=>{
    const row=await fixture(),operator=await resolveContext(demo.users.limited,row.ctx.tenantId),auditor=await resolveContext(demo.users.consultant,row.ctx.tenantId),marketing=await resolveContext(demo.users.marketing,row.ctx.tenantId),foreign=await resolveContext(demo.users.other,demo.tenants.goods);
    expect((await recordInventoryMovement(operator,movement(row,'receipt',2))).onHand).toBe(2);
    expect((await inventoryOverview(auditor,demo.shops.tiktok,row.productId)).canWrite).toBe(false);
    expect((await centralInventoryOverview(operator,{search:'SC-DAILY-30'})).rows).toHaveLength(0);
    await expect(recordInventoryMovement(auditor,movement(row,'receipt',1))).rejects.toMatchObject({status:403});
    await expect(inventoryOverview(marketing,demo.shops.tiktok,row.productId)).rejects.toMatchObject({status:403});
    await expect(centralInventoryOverview(marketing)).rejects.toMatchObject({status:403});
    expect((await centralInventoryOverview(foreign,{search:row.sku})).rows).toHaveLength(0);
    await expect(inventoryOverview(foreign,demo.shops.goods,row.productId)).rejects.toMatchObject({status:404});
  });

  it('denies direct ledger and balance mutation to the runtime role',async()=>{
    const row=await fixture();await recordInventoryMovement(row.ctx,movement(row,'receipt',2));
    const overview=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    await expect(withTenant(row.ctx,tx=>tx.query('UPDATE app.inventory_balances SET on_hand=999 WHERE tenant_id=$1 AND variant_id=$2',[row.ctx.tenantId,row.variantId]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(row.ctx,tx=>tx.query('DELETE FROM app.inventory_movements WHERE tenant_id=$1 AND id=$2',[row.ctx.tenantId,overview.movements[0].id]))).rejects.toMatchObject({code:'42501'});
  });
});
