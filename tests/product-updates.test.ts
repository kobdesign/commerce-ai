import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { catalog,createProductFamily,demo,getProductForEdit,updateProduct,type ProductForEdit } from '@commerce/domain';
import { previewImport } from '@commerce/imports';
import { productFamilyInput,productUpdateInput } from '@commerce/contracts';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const owner=()=>resolveContext(demo.users.owner,demo.tenants.chino);
async function fixture(){
 const ctx=await owner(),input={shopId:demo.shops.tiktok,name:'แก้ไขสินค้า '+randomUUID(),category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ไม้'},variants:[{sku:'EDIT-'+randomUUID(),attributes:{ขนาด:'S'},priceMinor:25000,costMinor:10000},{sku:'EDIT-'+randomUUID(),attributes:{ขนาด:'M'},priceMinor:30000,costMinor:null}]};
 const saved=await createProductFamily(ctx,input);return {ctx,product:await getProductForEdit(ctx,input.shopId,saved.id)};
}
function payload(p:ProductForEdit){return {shopId:demo.shops.tiktok,name:p.name,category:p.category,salesUnit:p.salesUnit,attributes:p.attributes,version:p.version,variants:p.variants.map(({id,priceMinor,costMinor})=>({id,priceMinor,costMinor})),reason:''};}

describe('Existing product editing',()=>{
 it('persists metadata and exact prices, appends costs with an actor, and preserves historical amounts',async()=>{
  const {ctx,product}=await fixture(),input=payload(product),v=input.variants.find(v=>v.costMinor===10000)!;
  input.name='แก้ไขชื่อสินค้า';input.attributes={วัสดุ:'เหล็ก'};v.priceMinor=25999;v.costMinor=11999;input.reason='ราคาตามใบสั่งซื้อ';
  await updateProduct(ctx,product.id,input);
  const saved=await getProductForEdit(ctx,input.shopId,product.id);
  expect(saved).toMatchObject({name:input.name,attributes:input.attributes,version:2});
  expect(saved.variants.find(x=>x.id===v.id)).toMatchObject({priceMinor:25999,costMinor:11999});
  expect(saved.history.map(x=>x.amountMinor)).toEqual([11999,10000]);expect(saved.history[0].note).toBe(input.reason);
  expect(await withTenant(ctx,tx=>tx.query('SELECT created_by FROM app.cost_versions WHERE id=$1',[saved.history[0].id]))).toEqual([{created_by:ctx.userId}]);
  await updateProduct(ctx,product.id,{...payload(saved),category:'ของใช้'});
  expect((await getProductForEdit(ctx,input.shopId,product.id)).history).toEqual(saved.history);
  expect(await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE entity_id=$1 AND action='product.updated'",[product.id]))).toHaveLength(2);
 });
 it('clears a cost to unknown, while zero remains a known cost in catalog and import checks',async()=>{
  const {ctx,product}=await fixture(),input=payload(product),known=input.variants.find(v=>v.costMinor!==null)!,unknown=input.variants.find(v=>v.costMinor===null)!;
  known.costMinor=null;unknown.costMinor=0;input.reason='รอตรวจสอบต้นทุน';await updateProduct(ctx,product.id,input);
  const current=await getProductForEdit(ctx,input.shopId,product.id);expect(current.history).toHaveLength(3);
  const rows=(await catalog(ctx,input.shopId)).items.filter(r=>r.productId===product.id);expect(rows.find(r=>r.id===known.id)?.costMinor).toBeNull();expect(rows.find(r=>r.id===unknown.id)?.costMinor).toBe(0);
  const skus=[known.id,unknown.id].map(id=>product.variants.find(v=>v.id===id)!.sku);
  const preview=await previewImport(ctx,{shopId:input.shopId,filename:'cost-check.csv',delimiter:',',csv:`order_id,sku,quantity,date,net_sales\n1,${skus[0]},1,2026-09-16,100\n2,${skus[1]},1,2026-09-16,100`,mapping:{orderId:'order_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_sales'}});
  expect(preview.rows[0].warnings).toContain('ยังไม่มีต้นทุนสินค้า');expect(preview.rows[1].warnings).toEqual([]);
 });
 it('allows exactly one concurrent save and does not append history for the stale request',async()=>{
  const {ctx,product}=await fixture(),a=payload(product),b=payload(product);a.variants[0].costMinor=12000;b.variants[0].costMinor=13000;a.reason='ต้นทุนรอบแรก';b.reason='ต้นทุนรอบถัดไป';
  const results=await Promise.allSettled([updateProduct(ctx,product.id,a),updateProduct(ctx,product.id,b)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409,code:'STALE_PRODUCT'}});
  const saved=await getProductForEdit(ctx,a.shopId,product.id);expect(saved.version).toBe(2);expect(saved.history).toHaveLength(2);
 });
 it('rejects foreign SKU IDs, missing reasons and detail/option conflicts atomically',async()=>{
  const {ctx,product}=await fixture(),other=await fixture(),input=payload(product);
  input.name='must not persist';input.variants[0].priceMinor=1;input.variants[0].id=other.product.variants[0].id;
  await expect(updateProduct(ctx,product.id,input)).rejects.toMatchObject({code:'INVALID_VARIANTS'});
  const noReason=payload(product);noReason.variants[0].costMinor=500;
  await expect(updateProduct(ctx,product.id,noReason)).rejects.toMatchObject({code:'COST_REASON_REQUIRED'});
  await expect(updateProduct(ctx,product.id,{...payload(product),attributes:{ขนาด:'L'}})).rejects.toMatchObject({code:'ATTRIBUTE_CONFLICT'});
  expect(await getProductForEdit(ctx,input.shopId,product.id)).toEqual(product);
  expect(productUpdateInput.safeParse({...payload(product),variants:[input.variants[0],input.variants[0]]}).success).toBe(false);
  expect(productFamilyInput.safeParse({shopId:input.shopId,name:'Empty',category:'other',salesUnit:'ชิ้น',attributes:{},variants:[]}).success).toBe(false);
 });
 it('denies unauthorized readers, cross-tenant writes and direct SQL mutations; history is immutable',async()=>{
  const {ctx,product}=await fixture(),marketing=await resolveContext(demo.users.marketing,ctx.tenantId),other=await resolveContext(demo.users.other,demo.tenants.goods);
  await expect(getProductForEdit(marketing,demo.shops.tiktok,product.id)).rejects.toMatchObject({status:403});
  await expect(updateProduct(marketing,product.id,payload(product))).rejects.toMatchObject({status:403});
  await expect(updateProduct(other,product.id,{...payload(product),shopId:demo.shops.goods})).rejects.toMatchObject({status:404});
  for(const actor of [marketing,other]){
   expect(await withTenant(actor,tx=>tx.query("UPDATE app.products SET name='forbidden' WHERE id=$1 RETURNING id",[product.id]))).toEqual([]);
   expect(await withTenant(actor,tx=>tx.query('UPDATE app.variants SET price_minor=1 WHERE id=$1 RETURNING id',[product.variants[0].id]))).toEqual([]);
  }
  await expect(withTenant(ctx,tx=>tx.query('UPDATE app.cost_versions SET amount_minor=1 WHERE id=$1',[product.history[0].id]))).rejects.toMatchObject({code:'42501'});
  await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.cost_versions WHERE id=$1',[product.history[0].id]))).rejects.toMatchObject({code:'42501'});
 });
 it('requires access to every linked shop before editing a shared product, also at the database layer',async()=>{
  const {ctx,product}=await fixture();
  await admin.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3)',[ctx.tenantId,demo.shops.shopee,product.id]);
  await admin.query("UPDATE app.memberships SET role='finance' WHERE tenant_id=$1 AND user_id=$2",[ctx.tenantId,demo.users.limited]);
  try{
   const limited=await resolveContext(demo.users.limited,ctx.tenantId);
   expect((await catalog(limited,demo.shops.tiktok)).items.some(r=>r.productId===product.id)).toBe(true);
   await expect(updateProduct(limited,product.id,payload(product))).rejects.toMatchObject({status:404});
   expect(await withTenant(limited,tx=>tx.query('UPDATE app.variants SET price_minor=1 WHERE id=$1 RETURNING id',[product.variants[0].id]))).toEqual([]);
   await expect(withTenant(limited,tx=>tx.query('INSERT INTO app.cost_versions(tenant_id,id,variant_id,amount_minor) VALUES($1,$2,$3,$4)',[ctx.tenantId,randomUUID(),product.variants[0].id,1]))).rejects.toMatchObject({code:'42501'});
  }finally{await admin.query("UPDATE app.memberships SET role='operator' WHERE tenant_id=$1 AND user_id=$2",[ctx.tenantId,demo.users.limited]);}
  await updateProduct(ctx,product.id,{...payload(product),name:'Owner can edit shared product'});
 });
});
