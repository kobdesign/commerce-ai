import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { centralInventoryOverview,createProductFamily,demo,inventoryCompanyDistributionPolicy,inventorySkuDistributionPolicy,recordInventoryMovement,updateInventoryCompanyDistributionPolicy,updateInventorySkuDistributionPolicy } from '@commerce/domain';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function fixture(){
  const ctx=await owner(),sku=`DIST-${randomUUID()}`,created=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:`Distribution ${randomUUID()}`,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:25000,costMinor:9000}]});
  await withTenant(ctx,tx=>tx.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3)',[ctx.tenantId,demo.shops.shopee,created.id]));
  await recordInventoryMovement(ctx,{shopId:demo.shops.tiktok,productId:created.id,variantId:created.variantIds[0],movementType:'opening',quantity:100,sourceReference:`OPEN-${randomUUID()}`,reason:'ตั้งยอดสำหรับทดสอบนโยบายกระจายสต็อก',confirmed:true});
  return {ctx,productId:created.id,variantId:created.variantIds[0],sku};
}

describe('Inventory distribution policy',()=>{
  it('stores an optimistic company default without authorizing marketplace writes',async()=>{
    const ctx=await owner(),before=await inventoryCompanyDistributionPolicy(ctx);
    const saved=await updateInventoryCompanyDistributionPolicy(ctx,{mode:'hybrid',safetyStock:7,version:before.version,confirmed:true});
    expect(saved).toMatchObject({mode:'hybrid',safetyStock:7,version:before.version+1,configured:true,canWrite:true,planningOnly:true});
    await expect(updateInventoryCompanyDistributionPolicy(ctx,{mode:'shared',safetyStock:0,version:before.version,confirmed:true})).rejects.toMatchObject({status:409,code:'STALE_DISTRIBUTION_POLICY'});
  });

  it('allows hybrid exposure caps above the shared pool and projects them on central stock',async()=>{
    const row=await fixture(),saved=await updateInventorySkuDistributionPolicy(row.ctx,{variantId:row.variantId,source:'override',mode:'hybrid',safetyStock:10,version:0,confirmed:true,channels:[{shopId:demo.shops.tiktok,quantity:70},{shopId:demo.shops.shopee,quantity:60}]});
    expect(saved).toMatchObject({source:'override',mode:'hybrid',safetyStock:10,version:1,balance:{onHand:100,reserved:0,available:100,distributable:90},planningOnly:true});
    expect(saved.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({shopId:demo.shops.tiktok,quantity:70,plannedQuantity:70}),
      expect.objectContaining({shopId:demo.shops.shopee,quantity:60,plannedQuantity:60}),
    ]));
    const central=await centralInventoryOverview(row.ctx,{search:row.sku});
    expect(central.rows[0]).toMatchObject({variantId:row.variantId,distributionMode:'hybrid',distributionSource:'sku',safetyStock:10,available:100,distributable:90});
    expect(central.rows[0].channels).toEqual(expect.arrayContaining([expect.objectContaining({shopId:demo.shops.tiktok,configuredQuantity:70,publishedQuantity:null})]));
    expect(await withTenant(row.ctx,tx=>tx.query('SELECT action FROM app.audit_events WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 1',[row.variantId]))).toEqual([{action:'inventory.distribution_sku_updated'}]);
  });

  it('rejects an unsafe fixed quota and can return a SKU to the company policy',async()=>{
    const row=await fixture(),unsafe={variantId:row.variantId,source:'override' as const,mode:'fixed' as const,safetyStock:10,version:0,confirmed:true as const,channels:[{shopId:demo.shops.tiktok,quantity:50},{shopId:demo.shops.shopee,quantity:50}]};
    await expect(updateInventorySkuDistributionPolicy(row.ctx,unsafe)).rejects.toMatchObject({status:409,code:'FIXED_QUOTA_EXCEEDS_STOCK'});
    const fixed=await updateInventorySkuDistributionPolicy(row.ctx,{...unsafe,channels:[{shopId:demo.shops.tiktok,quantity:45},{shopId:demo.shops.shopee,quantity:45}]});
    expect(fixed).toMatchObject({mode:'fixed',fixedTotal:90,fixedOverAllocated:false,version:1});
    const inherited=await updateInventorySkuDistributionPolicy(row.ctx,{variantId:row.variantId,source:'inherit',mode:fixed.companyPolicy.mode,safetyStock:fixed.companyPolicy.safetyStock,version:fixed.version,confirmed:true,channels:[]});
    expect(inherited).toMatchObject({source:'inherit',mode:fixed.companyPolicy.mode,safetyStock:fixed.companyPolicy.safetyStock,version:0});
  });

  it('enforces role, shop grant and tenant boundaries',async()=>{
    const row=await fixture(),operator=await resolveContext(demo.users.limited,row.ctx.tenantId),marketing=await resolveContext(demo.users.marketing,row.ctx.tenantId),foreign=await resolveContext(demo.users.other,demo.tenants.goods);
    const readable=await inventorySkuDistributionPolicy(operator,row.variantId);
    expect(readable.canWrite).toBe(false);expect(readable.channels.map(channel=>channel.shopId)).toEqual([demo.shops.tiktok]);
    await expect(updateInventorySkuDistributionPolicy(operator,{variantId:row.variantId,source:'inherit',mode:'hybrid',safetyStock:0,version:0,confirmed:true,channels:[]})).rejects.toMatchObject({status:403});
    await expect(inventoryCompanyDistributionPolicy(marketing)).rejects.toMatchObject({status:403});
    await expect(inventorySkuDistributionPolicy(foreign,row.variantId)).rejects.toMatchObject({status:404});
  });
});
