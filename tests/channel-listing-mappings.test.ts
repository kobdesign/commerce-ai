import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { channelListingMappings,createChannelListingMapping,createProductFamily,demo,getProductForEdit,setChannelListingLifecycle } from '@commerce/domain';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function fixture(){
  const ctx=await owner(),saved=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'Listing '+randomUUID(),category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku:'LIST-'+randomUUID(),attributes:{ขนาด:'S'},priceMinor:19900,costMinor:8000},{sku:'LIST-'+randomUUID(),attributes:{ขนาด:'M'},priceMinor:20900,costMinor:8500}]});
  return {ctx,product:await getProductForEdit(ctx,demo.shops.tiktok,saved.id)};
}
function input(product:Awaited<ReturnType<typeof fixture>>['product'],variantId=product.variants[0].id,identity=randomUUID()){
  return {shopId:demo.shops.tiktok,productId:product.id,variantId,externalProductId:`PRODUCT-${identity}`,externalVariantId:`MODEL-${identity}`,externalSku:'CHANNEL-SKU',listingName:'รายการขายทดสอบ',confirmed:true as const};
}

describe('Channel listing mappings',()=>{
  it('links a verified marketplace identity to a canonical SKU with provenance',async()=>{
    const {ctx,product}=await fixture(),payload=input(product),saved=await createChannelListingMapping(ctx,payload);
    expect(saved).toMatchObject({shopId:payload.shopId,variantId:payload.variantId,externalProductId:payload.externalProductId,externalVariantId:payload.externalVariantId,source:'manual',version:1,archivedAt:null});
    expect(saved.verifiedAt).toBeTruthy();
    expect(await channelListingMappings(ctx,payload.shopId,product.id)).toEqual([saved]);
    expect(await withTenant(ctx,tx=>tx.query("SELECT action,details->>'source' AS source FROM app.audit_events WHERE entity_id=$1",[saved.id]))).toEqual([{action:'channel_listing.connected',source:'manual'}]);
  });

  it('prevents one active external identity from resolving to two SKUs but allows multiple listings for one SKU',async()=>{
    const {ctx,product}=await fixture(),first=input(product);
    await createChannelListingMapping(ctx,first);
    await expect(createChannelListingMapping(ctx,{...first,variantId:product.variants[1].id})).rejects.toMatchObject({status:409,code:'LISTING_IDENTITY_IN_USE'});
    await createChannelListingMapping(ctx,input(product,product.variants[0].id));
    expect(await channelListingMappings(ctx,first.shopId,product.id)).toHaveLength(2);
  });

  it('archives a wrong mapping, permits a corrected replacement, and blocks conflicting restore',async()=>{
    const {ctx,product}=await fixture(),payload=input(product),saved=await createChannelListingMapping(ctx,payload);
    const archived=await setChannelListingLifecycle(ctx,saved.id,{shopId:payload.shopId,version:1,action:'archive',reason:'เลือก SKU ผิดและต้องสร้างใหม่'});
    expect(archived).toMatchObject({version:2,archived:true});
    const corrected=await createChannelListingMapping(ctx,{...payload,variantId:product.variants[1].id});
    await expect(setChannelListingLifecycle(ctx,saved.id,{shopId:payload.shopId,version:2,action:'restore',reason:'พยายามนำรายการเดิมกลับ'})).rejects.toMatchObject({code:'LISTING_IDENTITY_IN_USE'});
    const rows=await channelListingMappings(ctx,payload.shopId,product.id);
    expect(rows.find(row=>row.id===saved.id)).toMatchObject({archivedAt:expect.any(String),archiveReason:'เลือก SKU ผิดและต้องสร้างใหม่'});
    expect(rows.find(row=>row.id===corrected.id)).toMatchObject({archivedAt:null,variantId:product.variants[1].id});
  });

  it('enforces confirmation, product membership, reason, version and role boundaries',async()=>{
    const {ctx,product}=await fixture(),other=await fixture(),payload=input(product);
    await expect(createChannelListingMapping(ctx,{...payload,confirmed:false})).rejects.toBeTruthy();
    await expect(createChannelListingMapping(ctx,{...payload,variantId:other.product.variants[0].id})).rejects.toMatchObject({code:'VARIANT_NOT_FOUND'});
    const saved=await createChannelListingMapping(ctx,payload);
    await expect(setChannelListingLifecycle(ctx,saved.id,{shopId:payload.shopId,version:1,action:'archive',reason:'x'})).rejects.toBeTruthy();
    await setChannelListingLifecycle(ctx,saved.id,{shopId:payload.shopId,version:1,action:'archive',reason:'ยกเลิกเพื่อทดสอบเวอร์ชัน'});
    await expect(setChannelListingLifecycle(ctx,saved.id,{shopId:payload.shopId,version:1,action:'restore',reason:'ข้อมูลเก่าไม่ควรบันทึก'})).rejects.toMatchObject({code:'STALE_LISTING_MAPPING'});
    const marketing=await resolveContext(demo.users.marketing,ctx.tenantId),foreign=await resolveContext(demo.users.other,demo.tenants.goods);
    await expect(createChannelListingMapping(marketing,input(product))).rejects.toMatchObject({status:403});
    await expect(channelListingMappings(marketing,payload.shopId,product.id)).rejects.toMatchObject({status:403});
    await expect(createChannelListingMapping(foreign,{...input(product),shopId:demo.shops.goods})).rejects.toMatchObject({status:404});
  });

  it('protects mapping identity and lifecycle at the database layer',async()=>{
    const {ctx,product}=await fixture(),saved=await createChannelListingMapping(ctx,input(product));
    await expect(withTenant(ctx,tx=>tx.query("UPDATE app.channel_listing_mappings SET external_product_id='rewritten' WHERE id=$1",[saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.channel_listing_mappings WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
    const marketing=await resolveContext(demo.users.marketing,ctx.tenantId);
    expect(await withTenant(marketing,tx=>tx.query("UPDATE app.channel_listing_mappings SET archived_at=clock_timestamp(),archived_by=$1,archive_reason='forbidden' WHERE id=$2 RETURNING id",[marketing.userId,saved.id]))).toEqual([]);
  });
});
