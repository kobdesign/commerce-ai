import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { commerceOrdersWorkspace,createChannelListingMapping,createCommerceOrder,createProductFamily,demo,inventoryOverview,recordInventoryMovement,setChannelListingLifecycle,transitionCommerceOrder } from '@commerce/domain';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function fixture(stock=5){
  const ctx=await owner(),stamp=randomUUID(),created=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:`Order ${stamp}`,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku:`ORD-${stamp}`,attributes:{ขนาด:'M'},priceMinor:25000,costMinor:9000}]});
  if(stock)await recordInventoryMovement(ctx,{shopId:demo.shops.tiktok,productId:created.id,variantId:created.variantIds[0],movementType:'receipt',quantity:stock,sourceReference:`IN-${stamp}`,reason:'รับสินค้าเพื่อทดสอบออเดอร์',confirmed:true});
  const mapping=await createChannelListingMapping(ctx,{shopId:demo.shops.tiktok,productId:created.id,variantId:created.variantIds[0],externalProductId:`PRODUCT-${stamp}`,externalVariantId:`MODEL-${stamp}`,externalSku:'',listingName:'รายการทดสอบ',confirmed:true});
  return {ctx,productId:created.id,variantId:created.variantIds[0],mapping};
}
function order(row:Awaited<ReturnType<typeof fixture>>,paymentState:'pending'|'paid'='paid',externalOrderId=`ORDER-${randomUUID()}`,quantity=2){
  return {shopId:demo.shops.tiktok,externalOrderId,orderedAt:new Date().toISOString(),paymentState,reservationExpiresAt:paymentState==='paid'?new Date(Date.now()+86400000).toISOString():null,reason:'ตรวจออเดอร์จาก Seller Center แล้ว',lines:[{externalLineId:'LINE-1',listingMappingId:row.mapping.id,quantity,unitPriceMinor:25000}],confirmed:true as const};
}
function action(row:Awaited<ReturnType<typeof fixture>>,version:number,kind:'confirm_payment'|'ship'|'cancel'){
  return {shopId:demo.shops.tiktok,version,action:kind,reason:kind==='ship'?'แพ็กและส่งสินค้าออกจากคลังแล้ว':'ตรวจหลักฐานและสถานะออเดอร์แล้ว',confirmed:true as const,...(kind==='confirm_payment'?{reservationExpiresAt:new Date(Date.now()+86400000).toISOString()}:{})};
}

describe('Internal commerce orders',()=>{
  it('keeps pending payment separate and allocates only after human payment confirmation',async()=>{
    const row=await fixture(5),saved=await createCommerceOrder(row.ctx,order(row,'pending'));
    expect(saved).toMatchObject({duplicate:false,paymentState:'pending',reservedLines:0,shortageLines:0,version:1});
    let workspace=await commerceOrdersWorkspace(row.ctx,demo.shops.tiktok);
    expect(workspace.orders[0]).toMatchObject({paymentState:'pending',fulfillmentState:'unfulfilled',lines:[{allocationStatus:'awaiting_payment',sku:row.mapping.sku}]});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0]).toMatchObject({onHand:5,reserved:0});
    const paid=await transitionCommerceOrder(row.ctx,saved.id,action(row,1,'confirm_payment'));
    expect(paid).toMatchObject({paymentState:'paid',reservedLines:1,shortageLines:0,version:2});
    workspace=await commerceOrdersWorkspace(row.ctx,demo.shops.tiktok);
    expect(workspace.orders[0].lines[0]).toMatchObject({allocationStatus:'reserved'});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0]).toMatchObject({onHand:5,reserved:2});
  });

  it('records shortage without negative stock and blocks shipping the whole order',async()=>{
    const row=await fixture(1),saved=await createCommerceOrder(row.ctx,order(row,'paid',undefined,2));
    expect(saved).toMatchObject({reservedLines:0,shortageLines:1});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0]).toMatchObject({onHand:1,reserved:0});
    await expect(transitionCommerceOrder(row.ctx,saved.id,action(row,1,'ship'))).rejects.toMatchObject({code:'ORDER_NOT_READY_TO_SHIP'});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0]).toMatchObject({onHand:1,reserved:0});
  });

  it('ships an allocated order atomically and records physical movement once',async()=>{
    const row=await fixture(5),payload=order(row,'paid'),saved=await createCommerceOrder(row.ctx,payload);
    const shipped=await transitionCommerceOrder(row.ctx,saved.id,action(row,1,'ship'));
    expect(shipped).toMatchObject({orderState:'completed',paymentState:'paid',fulfillmentState:'shipped',reservedLines:0,shortageLines:0,version:2});
    const inventory=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(inventory.variants[0]).toMatchObject({onHand:3,reserved:0});
    expect(inventory.movements[0]).toMatchObject({movementType:'sale_commit',quantityDelta:-2,sourceReference:`${payload.externalOrderId}:LINE-1`});
    await expect(transitionCommerceOrder(row.ctx,saved.id,action(row,1,'ship'))).rejects.toMatchObject({code:'STALE_ORDER'});
  });

  it('cancels without pretending to refund and releases only allocated stock',async()=>{
    const row=await fixture(5),saved=await createCommerceOrder(row.ctx,order(row,'paid'));
    const cancelled=await transitionCommerceOrder(row.ctx,saved.id,action(row,1,'cancel'));
    expect(cancelled).toMatchObject({orderState:'cancelled',paymentState:'paid',fulfillmentState:'cancelled'});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0]).toMatchObject({onHand:5,reserved:0});
    const stored=(await commerceOrdersWorkspace(row.ctx,demo.shops.tiktok)).orders.find(item=>item.id===saved.id)!;
    expect(stored.lines[0]).toMatchObject({allocationStatus:'cancelled'});
  });

  it('is idempotent and refuses inactive listing identities',async()=>{
    const row=await fixture(3),payload=order(row,'paid'),saved=await createCommerceOrder(row.ctx,payload);
    expect(await createCommerceOrder(row.ctx,payload)).toMatchObject({id:saved.id,duplicate:true});
    await expect(createCommerceOrder(row.ctx,{...payload,reason:'ข้อมูลคนละชุด'})).rejects.toMatchObject({code:'ORDER_REFERENCE_CONFLICT'});
    await setChannelListingLifecycle(row.ctx,row.mapping.id,{shopId:demo.shops.tiktok,version:row.mapping.version,action:'archive',reason:'ปิดเพื่อทดสอบออเดอร์'});
    await expect(createCommerceOrder(row.ctx,order(row,'pending'))).rejects.toMatchObject({code:'ORDER_LISTING_NOT_ACTIVE'});
  });

  it('serializes concurrent retries and closes shortage tracking when cancelled',async()=>{
    const row=await fixture(0),payload=order(row,'paid',`RACE-${randomUUID()}`,2);
    const results=await Promise.all([createCommerceOrder(row.ctx,payload),createCommerceOrder(row.ctx,payload)]);
    expect(new Set(results.map(result=>result.id)).size).toBe(1);
    expect(results.filter(result=>result.duplicate)).toHaveLength(1);
    const created=results.find(result=>!result.duplicate)!;
    await transitionCommerceOrder(row.ctx,created.id,action(row,1,'cancel'));
    const inventory=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(inventory.reservations.find(item=>item.sourceReference===`${payload.externalOrderId}:LINE-1`)).toMatchObject({status:'released',reservedQuantity:0});
  });

  it('enforces role, tenant and no-direct-write boundaries',async()=>{
    const row=await fixture(3),operator=await resolveContext(demo.users.limited,row.ctx.tenantId),auditor=await resolveContext(demo.users.consultant,row.ctx.tenantId),marketing=await resolveContext(demo.users.marketing,row.ctx.tenantId),foreign=await resolveContext(demo.users.other,demo.tenants.goods);
    const saved=await createCommerceOrder(operator,order(row,'pending'));
    expect((await commerceOrdersWorkspace(auditor,demo.shops.tiktok)).orders.some(item=>item.id===saved.id)).toBe(true);
    await expect(createCommerceOrder(auditor,order(row,'pending'))).rejects.toMatchObject({status:403});
    await expect(commerceOrdersWorkspace(marketing,demo.shops.tiktok)).rejects.toMatchObject({status:403});
    await expect(transitionCommerceOrder(foreign,saved.id,{...action(row,1,'cancel'),shopId:demo.shops.goods})).rejects.toMatchObject({status:404});
    await expect(withTenant(row.ctx,tx=>tx.query("UPDATE app.commerce_orders SET payment_state='paid' WHERE tenant_id=$1 AND id=$2",[row.ctx.tenantId,saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(row.ctx,tx=>tx.query('DELETE FROM app.commerce_order_lines WHERE tenant_id=$1 AND order_id=$2',[row.ctx.tenantId,saved.id]))).rejects.toMatchObject({code:'42501'});
    const raw=await admin.query('SELECT count(*)::int AS count FROM app.commerce_orders WHERE tenant_id=$1 AND id=$2',[row.ctx.tenantId,saved.id]);
    expect(raw.rows[0].count).toBe(1);
  });
});
