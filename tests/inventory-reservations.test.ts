import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createInventoryReservation,createProductFamily,demo,inventoryOverview,recordInventoryMovement,transitionInventoryReservation } from '@commerce/domain';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function fixture(stock=5){
  const ctx=await owner(),created=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'Reservation '+randomUUID(),category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku:'RSV-'+randomUUID(),attributes:{ขนาด:'M'},priceMinor:25000,costMinor:9000}]});
  const row={ctx,productId:created.id,variantId:created.variantIds[0]};
  if(stock)await recordInventoryMovement(ctx,{shopId:demo.shops.tiktok,productId:row.productId,variantId:row.variantId,movementType:'receipt',quantity:stock,sourceReference:'IN-'+randomUUID(),reason:'รับสินค้าเพื่อทดสอบการจอง',confirmed:true});
  return row;
}
function expires(hours=2){return new Date(Date.now()+hours*60*60*1000).toISOString();}
function reserve(row:Awaited<ReturnType<typeof fixture>>,quantity:number,sourceReference:string='ORDER-'+randomUUID(),expiresAt=expires()){
  return {shopId:demo.shops.tiktok,productId:row.productId,variantId:row.variantId,quantity,sourceReference,expiresAt,reason:'ลูกค้าชำระแล้วและรอจัดสินค้า',confirmed:true as const};
}
function action(row:Awaited<ReturnType<typeof fixture>>,version:number,kind:'commit'|'release'|'expire'|'retry',reason='ตรวจสอบสถานะและยอดสต็อกแล้ว'){
  return {shopId:demo.shops.tiktok,productId:row.productId,version,action:kind,reason,confirmed:true as const,...(kind==='retry'?{expiresAt:expires()}:{})};
}

describe('Inventory reservations',()=>{
  it('reserves available stock without changing physical on-hand or creating a movement',async()=>{
    const row=await fixture(5),before=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    const saved=await createInventoryReservation(row.ctx,reserve(row,2));
    expect(saved).toMatchObject({duplicate:false,status:'reserved',reserved:2,available:3,version:1});
    const overview=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(overview.variants[0]).toMatchObject({onHand:5,reserved:2});
    expect(overview.movements).toHaveLength(before.movements.length);
    expect(overview.reservations[0]).toMatchObject({id:saved.id,status:'reserved',requestedQuantity:2,reservedQuantity:2,version:1});
  });

  it('records shortage without a false reservation or physical movement',async()=>{
    const row=await fixture(2),before=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    const saved=await createInventoryReservation(row.ctx,reserve(row,3));
    expect(saved).toMatchObject({status:'shortage',reserved:0,available:2});
    const overview=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(overview.variants[0]).toMatchObject({onHand:2,reserved:0});
    expect(overview.movements).toHaveLength(before.movements.length);
    expect(overview.reservations[0]).toMatchObject({status:'shortage',reservedQuantity:0});
  });

  it('serializes competing reservations for the last available item',async()=>{
    const row=await fixture(1);
    const results=await Promise.all([
      createInventoryReservation(row.ctx,reserve(row,1,'ORDER-A-'+randomUUID())),
      createInventoryReservation(row.ctx,reserve(row,1,'ORDER-B-'+randomUUID())),
    ]);
    expect(results.map(result=>result.status).sort()).toEqual(['reserved','shortage']);
    const overview=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(overview.variants[0]).toMatchObject({onHand:1,reserved:1});
  });

  it('commits once by reducing on-hand and reserved together with one sale movement',async()=>{
    const row=await fixture(5),payload=reserve(row,2),reservation=await createInventoryReservation(row.ctx,payload);
    const committed=await transitionInventoryReservation(row.ctx,reservation.id,action(row,1,'commit','แพ็กสินค้าออกจากคลังแล้ว'));
    expect(committed).toMatchObject({status:'committed',onHand:3,reserved:0,available:3,version:2});
    const overview=await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId);
    expect(overview.movements[0]).toMatchObject({movementType:'sale_commit',quantityDelta:-2,balanceAfter:3,sourceReference:payload.sourceReference});
    await expect(transitionInventoryReservation(row.ctx,reservation.id,action(row,1,'commit'))).rejects.toMatchObject({code:'STALE_RESERVATION'});
    expect((await inventoryOverview(row.ctx,demo.shops.tiktok,row.productId)).variants[0].onHand).toBe(3);
  });

  it('releases and expires reservations without changing physical stock',async()=>{
    const row=await fixture(5),released=await createInventoryReservation(row.ctx,reserve(row,2));
    expect(await transitionInventoryReservation(row.ctx,released.id,action(row,1,'release','ลูกค้ายกเลิกก่อนจัดสินค้า'))).toMatchObject({status:'released',onHand:5,reserved:0});
    const due=await createInventoryReservation(row.ctx,reserve(row,1,'DUE-'+randomUUID()));
    await admin.query("UPDATE app.inventory_reservations SET expires_at=clock_timestamp()-interval '1 minute' WHERE tenant_id=$1 AND id=$2",[row.ctx.tenantId,due.id]);
    expect(await transitionInventoryReservation(row.ctx,due.id,action(row,1,'expire','ปิดรายการที่เลยเวลาจอง'))).toMatchObject({status:'expired',onHand:5,reserved:0});
  });

  it('retries shortage after stock arrives and keeps create requests idempotent',async()=>{
    const row=await fixture(0),reference='ORDER-'+randomUUID(),payload=reserve(row,2,reference),shortage=await createInventoryReservation(row.ctx,payload);
    const duplicate=await createInventoryReservation(row.ctx,payload);
    expect(duplicate).toMatchObject({id:shortage.id,duplicate:true,status:'shortage'});
    await expect(createInventoryReservation(row.ctx,{...payload,quantity:3})).rejects.toMatchObject({code:'RESERVATION_REFERENCE_CONFLICT'});
    await recordInventoryMovement(row.ctx,{shopId:demo.shops.tiktok,productId:row.productId,variantId:row.variantId,movementType:'receipt',quantity:2,sourceReference:'RESTOCK-'+randomUUID(),reason:'เติมสินค้าสำหรับรายการค้าง',confirmed:true});
    expect(await transitionInventoryReservation(row.ctx,shortage.id,action(row,1,'retry','มีสินค้าเข้าและตรวจยอดใหม่แล้ว'))).toMatchObject({status:'reserved',reserved:2,available:0,version:2});
  });

  it('enforces role, tenant and append-only database boundaries',async()=>{
    const row=await fixture(3),operator=await resolveContext(demo.users.limited,row.ctx.tenantId),auditor=await resolveContext(demo.users.consultant,row.ctx.tenantId),marketing=await resolveContext(demo.users.marketing,row.ctx.tenantId),foreign=await resolveContext(demo.users.other,demo.tenants.goods);
    const saved=await createInventoryReservation(operator,reserve(row,1));
    await expect(createInventoryReservation(auditor,reserve(row,1))).rejects.toMatchObject({status:403});
    await expect(createInventoryReservation(marketing,reserve(row,1))).rejects.toMatchObject({status:403});
    await expect(transitionInventoryReservation(foreign,saved.id,{...action(row,1,'release'),shopId:demo.shops.goods})).rejects.toMatchObject({status:404});
    await expect(withTenant(row.ctx,tx=>tx.query("UPDATE app.inventory_reservations SET status='released' WHERE tenant_id=$1 AND id=$2",[row.ctx.tenantId,saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(row.ctx,tx=>tx.query('DELETE FROM app.inventory_reservations WHERE tenant_id=$1 AND id=$2',[row.ctx.tenantId,saved.id]))).rejects.toMatchObject({code:'42501'});
  });
});
