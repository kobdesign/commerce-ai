import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createChannelListingMapping,createCommerceOrder,createInventoryReservation,createProductFamily,demo,recordInventoryMovement,transitionCommerceOrder,transitionInventoryReservation } from '@commerce/domain';
import { claimOutboxDeliveries,completeOutboxDelivery,failOutboxDelivery,recordOutboxReceipt } from '@commerce/integrations';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL});
const consumers:string[]=[];
afterAll(async()=>{
  for(const consumer of consumers){
    await admin.query('DELETE FROM app.integration_consumer_receipts WHERE consumer_name=$1',[consumer]);
    await admin.query('DELETE FROM app.integration_outbox_deliveries WHERE consumer_name=$1',[consumer]);
    await admin.query('DELETE FROM app.integration_outbox_consumers WHERE consumer_name=$1',[consumer]);
  }
  await Promise.all([closePools(),admin.end(),queue.end()]);
});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function consumer(eventTypes=['commerce.order_created.v1'],maxAttempts=5){
  const name=`test.${randomUUID()}.v1`;consumers.push(name);
  await admin.query('INSERT INTO app.integration_outbox_consumers(consumer_name,event_types,max_attempts) VALUES($1,$2,$3)',[name,eventTypes,maxAttempts]);return name;
}
async function fixture(stock=5){
  const ctx=await owner(),stamp=randomUUID(),created=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:`Outbox ${stamp}`,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku:`OUT-${stamp}`,attributes:{ขนาด:'M'},priceMinor:25000,costMinor:9000}]});
  if(stock)await recordInventoryMovement(ctx,{shopId:demo.shops.tiktok,productId:created.id,variantId:created.variantIds[0],movementType:'receipt',quantity:stock,sourceReference:`IN-${stamp}`,reason:'รับสินค้าเพื่อทดสอบ outbox',confirmed:true});
  const mapping=await createChannelListingMapping(ctx,{shopId:demo.shops.tiktok,productId:created.id,variantId:created.variantIds[0],externalProductId:`PRODUCT-${stamp}`,externalVariantId:`MODEL-${stamp}`,externalSku:'',listingName:'รายการทดสอบ',confirmed:true});
  return {ctx,productId:created.id,variantId:created.variantIds[0],mapping};
}
function payload(row:Awaited<ReturnType<typeof fixture>>,paymentState:'pending'|'paid'='paid',quantity=2){
  return {shopId:demo.shops.tiktok,externalOrderId:`ORDER-${randomUUID()}`,orderedAt:new Date().toISOString(),paymentState,reservationExpiresAt:paymentState==='paid'?new Date(Date.now()+86400000).toISOString():null,reason:'ตรวจออเดอร์เพื่อทดสอบ outbox',lines:[{externalLineId:'LINE-1',listingMappingId:row.mapping.id,quantity,unitPriceMinor:25000}],confirmed:true as const};
}
function action(version:number,kind:'confirm_payment'|'ship'|'cancel'){
  return {shopId:demo.shops.tiktok,version,action:kind,reason:'ตรวจสถานะก่อนสร้าง integration event',confirmed:true as const,...(kind==='confirm_payment'?{reservationExpiresAt:new Date(Date.now()+86400000).toISOString()}:{})};
}

describe('Transactional integration outbox',()=>{
  it('commits typed order, reservation and inventory events with the same business transaction',async()=>{
    const row=await fixture(4),input=payload(row,'pending'),order=await createCommerceOrder(row.ctx,input);
    await transitionCommerceOrder(row.ctx,order.id,action(1,'confirm_payment'));
    await transitionCommerceOrder(row.ctx,order.id,action(2,'ship'));
    const events=(await admin.query<{event_type:string;aggregate_type:string;aggregate_version:number;payload:Record<string,unknown>}>(`SELECT event_type,aggregate_type,aggregate_version,payload FROM app.integration_outbox_events
      WHERE tenant_id=$1 AND (aggregate_id=$2 OR payload->>'orderId'=$2::text) ORDER BY position`,[row.ctx.tenantId,order.id])).rows;
    expect(events.map(event=>event.event_type)).toEqual(['commerce.order_created.v1','commerce.order_payment_confirmed.v1','commerce.order_shipped.v1']);
    const reservationEvents=(await admin.query<{event_type:string}>(`SELECT event_type FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_type='inventory_reservation' AND payload->>'sourceReference'=$2 ORDER BY position`,[row.ctx.tenantId,`${input.externalOrderId}:LINE-1`])).rows;
    expect(reservationEvents.map(event=>event.event_type)).toEqual(['inventory.reservation_reserved.v1','inventory.reservation_committed.v1']);
    const movement=(await admin.query<{event_type:string}>(`SELECT event_type FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_type='inventory_movement' AND payload->>'sourceReference' IN(
      SELECT id::text FROM app.inventory_reservations WHERE tenant_id=$1 AND source_reference=$2)`,[row.ctx.tenantId,`${input.externalOrderId}:LINE-1`])).rows;
    expect(movement).toEqual([{event_type:'inventory.movement_recorded.v1'}]);
    expect(events[0].payload).toMatchObject({schemaVersion:1,orderId:order.id,paymentState:'pending'});
  });

  it('rolls outbox events back when the business transition fails',async()=>{
    const row=await fixture(0),order=await createCommerceOrder(row.ctx,payload(row,'paid',2));
    const before=Number((await admin.query(`SELECT count(*) FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2`,[row.ctx.tenantId,order.id])).rows[0].count);
    await expect(transitionCommerceOrder(row.ctx,order.id,action(1,'ship'))).rejects.toMatchObject({code:'ORDER_NOT_READY_TO_SHIP'});
    const after=Number((await admin.query(`SELECT count(*) FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2`,[row.ctx.tenantId,order.id])).rows[0].count);
    expect(after).toBe(before);
  });

  it('emits a new version when a shortage retry remains short',async()=>{
    const row=await fixture(0),reference=`RETRY-${randomUUID()}`,reservation=await createInventoryReservation(row.ctx,{shopId:demo.shops.tiktok,productId:row.productId,variantId:row.variantId,quantity:2,sourceReference:reference,expiresAt:new Date(Date.now()+7200000).toISOString(),reason:'ทดสอบการจองที่ของไม่พอ',confirmed:true});
    await transitionInventoryReservation(row.ctx,reservation.id,{shopId:demo.shops.tiktok,productId:row.productId,version:1,action:'retry',expiresAt:new Date(Date.now()+7200000).toISOString(),reason:'ตรวจสต็อกซ้ำแล้วยังไม่พอ',confirmed:true});
    const events=(await admin.query<{event_type:string;aggregate_version:number}>('SELECT event_type,aggregate_version FROM app.integration_outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY position',[row.ctx.tenantId,reservation.id])).rows;
    expect(events).toEqual([{event_type:'inventory.reservation_shortage.v1',aggregate_version:1},{event_type:'inventory.reservation_retried_shortage.v1',aggregate_version:2}]);
  });

  it('tracks each consumer independently and enforces a valid lease owner',async()=>{
    const first=await consumer(),second=await consumer(),row=await fixture(1),order=await createCommerceOrder(row.ctx,payload(row,'pending'));
    const a=(await claimOutboxDeliveries(queue,first,'worker-a',10,60)).find(item=>item.aggregateId===order.id)!;
    const b=(await claimOutboxDeliveries(queue,second,'worker-b',10,60)).find(item=>item.aggregateId===order.id)!;
    expect(a.eventId).toBe(b.eventId);
    expect(await recordOutboxReceipt(queue,a,first,'worker-a')).toBe(false);
    expect(await completeOutboxDelivery(queue,a,first,'wrong-worker')).toBe(false);
    expect(await completeOutboxDelivery(queue,a,first,'worker-a')).toBe(true);
    const states=(await admin.query<{consumer_name:string;status:string}>('SELECT consumer_name,status FROM app.integration_outbox_deliveries WHERE tenant_id=$1 AND event_id=$2 AND consumer_name=ANY($3) ORDER BY consumer_name',[a.tenantId,a.eventId,[first,second]])).rows;
    expect(states.map(item=>item.status).sort()).toEqual(['processing','succeeded']);
    expect(await recordOutboxReceipt(queue,b,second,'worker-b')).toBe(false);
    expect(await completeOutboxDelivery(queue,b,second,'worker-b')).toBe(true);
  });

  it('recovers an expired claim and makes the internal effect idempotent after a crash',async()=>{
    const name=await consumer(),row=await fixture(1),order=await createCommerceOrder(row.ctx,payload(row,'pending'));
    const first=(await claimOutboxDeliveries(queue,name,'crashed-worker',10,60)).find(item=>item.aggregateId===order.id)!;
    expect(await recordOutboxReceipt(queue,first,name,'crashed-worker')).toBe(false);
    await admin.query("UPDATE app.integration_outbox_deliveries SET leased_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND event_id=$2 AND consumer_name=$3",[first.tenantId,first.eventId,name]);
    const retried=(await claimOutboxDeliveries(queue,name,'recovery-worker',10,60)).find(item=>item.eventId===first.eventId)!;
    expect(retried.attemptCount).toBe(2);
    expect(await recordOutboxReceipt(queue,retried,name,'recovery-worker')).toBe(true);
    expect(await completeOutboxDelivery(queue,retried,name,'recovery-worker')).toBe(true);
    const receiptCount=Number((await admin.query('SELECT count(*) FROM app.integration_consumer_receipts WHERE tenant_id=$1 AND event_id=$2 AND consumer_name=$3',[first.tenantId,first.eventId,name])).rows[0].count);
    expect(receiptCount).toBe(1);
  });

  it('backs off failures and dead-letters only after the configured attempt limit',async()=>{
    const name=await consumer(['commerce.order_created.v1'],2),row=await fixture(1),order=await createCommerceOrder(row.ctx,payload(row,'pending'));
    const first=(await claimOutboxDeliveries(queue,name,'failure-worker',10,60)).find(item=>item.aggregateId===order.id)!;
    expect(await failOutboxDelivery(queue,first,name,'failure-worker','SYNTHETIC_FAILURE')).toBe('pending');
    await admin.query('UPDATE app.integration_outbox_deliveries SET next_attempt_at=clock_timestamp() WHERE tenant_id=$1 AND event_id=$2 AND consumer_name=$3',[first.tenantId,first.eventId,name]);
    const second=(await claimOutboxDeliveries(queue,name,'failure-worker',10,60)).find(item=>item.eventId===first.eventId)!;
    expect(await failOutboxDelivery(queue,second,name,'failure-worker','SYNTHETIC_FAILURE')).toBe('dead_letter');
    const state=(await admin.query<{status:string;attempt_count:number;last_error_code:string}>('SELECT status,attempt_count,last_error_code FROM app.integration_outbox_deliveries WHERE tenant_id=$1 AND event_id=$2 AND consumer_name=$3',[first.tenantId,first.eventId,name])).rows[0];
    expect(state).toEqual({status:'dead_letter',attempt_count:2,last_error_code:'SYNTHETIC_FAILURE'});
  });

  it('keeps operational records tenant-scoped and denies queue-role direct mutation',async()=>{
    const row=await fixture(1),order=await createCommerceOrder(row.ctx,payload(row,'pending'));
    const ownerRows=await withTenant(row.ctx,tx=>tx.query<{id:string}>('SELECT id FROM app.integration_outbox_events WHERE aggregate_id=$1',[order.id]));
    expect(ownerRows).toHaveLength(1);
    const marketing=await resolveContext(demo.users.marketing,row.ctx.tenantId);
    expect(await withTenant(marketing,tx=>tx.query('SELECT id FROM app.integration_outbox_events WHERE aggregate_id=$1',[order.id]))).toEqual([]);
    await expect(queue.query("UPDATE app.integration_outbox_events SET event_type='tampered' WHERE tenant_id=$1 AND id=$2",[row.ctx.tenantId,ownerRows[0].id])).rejects.toMatchObject({code:'42501'});
  });
});
