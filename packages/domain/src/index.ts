import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withActor,withTenant,type Tx } from '@commerce/db';
import { AppError,canReadCosts,canWriteCatalog,productInput,productFamilyInput,productUpdateInput,normalizeLabel,shopInput,nameSchema,uuid,type Context,type Role } from '@commerce/contracts';
export * from './auth';
export { demo } from './demo';
export type Shop={id:string;name:string;channel:string};
export type CatalogItem={id:string;productId:string;name:string;category:string;salesUnit:string;sku:string;attributes:Record<string,string>;sharedAttributes:Record<string,string>;optionAttributes:Record<string,string>;priceMinor:number;currency:string;costMinor?:number|null};
export async function audit(tx:Tx,ctx:Context,action:string,entityId:string|null,details:Record<string,unknown>={}){
  await tx.query('INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',[ctx.tenantId,randomUUID(),ctx.userId,action,entityId,JSON.stringify(details)]);
}
export async function assertShop(tx:Tx,ctx:Context,shopId:string){
  uuid.parse(shopId);
  const rows=await tx.query('SELECT id FROM app.shops WHERE tenant_id=$1 AND id=$2',[ctx.tenantId,shopId]);
  if(!rows.length)throw new AppError(403,'SHOP_FORBIDDEN','คุณไม่มีสิทธิ์เข้าถึงร้านนี้');
}
export async function shops(ctx:Context){return withTenant(ctx,tx=>tx.query<Shop>('SELECT id,name,channel FROM app.shops ORDER BY name'));}
export async function createOrganization(userId:string,input:unknown){
  const name=nameSchema.parse(input);
  return withActor(userId,null,async tx=>(await tx.query<{id:string}>('SELECT app.create_organization($1) AS id',[name]))[0].id);
}
export async function createShop(ctx:Context,input:unknown){
  const data=shopInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าขององค์กรเพิ่มร้านได้');
    const id=randomUUID();
    await tx.query('INSERT INTO app.shops(tenant_id,id,name,channel) VALUES($1,$2,$3,$4)',[ctx.tenantId,id,data.name,data.channel]);
    await audit(tx,ctx,'shop.created',id,{name:data.name});return id;
  });
}
export async function catalog(ctx:Context,shopId:string){
  return withTenant(ctx,async(tx,role)=>{
    await assertShop(tx,ctx,shopId);
    const result=await tx.orm.execute(sql`
      SELECT v.id,p.id AS "productId",p.name,p.category,p.sales_unit AS "salesUnit",v.sku,p.attributes || v.attributes AS attributes,p.attributes AS "sharedAttributes",v.attributes AS "optionAttributes",v.price_minor AS "priceMinor",v.currency
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      JOIN app.shop_products sp ON sp.tenant_id=p.tenant_id AND sp.product_id=p.id
      WHERE sp.shop_id=${shopId}::uuid AND sp.tenant_id=${ctx.tenantId}::uuid ORDER BY p.created_at DESC,p.name,v.sku LIMIT 200`);
    const items=result.rows as CatalogItem[];
    if(canReadCosts(role)){
      const costs=await tx.query<{variant_id:string;amount_minor:number|null}>(`SELECT DISTINCT ON(variant_id) variant_id,amount_minor FROM app.cost_versions WHERE effective_at<=clock_timestamp() ORDER BY variant_id,effective_at DESC,created_at DESC`);
      const byId=new Map(costs.map(c=>[c.variant_id,c.amount_minor]));
      for(const item of items)item.costMinor=byId.get(item.id)??null;
    }
    return {items,canReadCosts:canReadCosts(role),canWrite:canWriteCatalog(role),limit:200};
  });
}
export async function createProduct(ctx:Context,input:unknown){
  const d=productInput.parse(input);
  const result=await createProductFamily(ctx,{shopId:d.shopId,name:d.name,category:d.category,salesUnit:d.salesUnit,attributes:d.attributes,variants:[{sku:d.sku,attributes:{},priceMinor:d.priceMinor,costMinor:d.costMinor}]});
  return {id:result.id,variantId:result.variantIds[0]};
}
export async function createProductFamily(ctx:Context,input:unknown){
  const d=productFamilyInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เพิ่มสินค้า');
    await assertShop(tx,ctx,d.shopId);
    const id=randomUUID(),variantIds:string[]=[];
    const existing=await tx.query<{sku:string}>('SELECT sku FROM app.variants WHERE tenant_id=$1 AND sku=ANY($2::text[])',[ctx.tenantId,d.variants.map(v=>v.sku)]);
    if(existing.length)throw new AppError(409,'DUPLICATE',`รหัส SKU ${existing.map(v=>v.sku).join(', ')} มีอยู่แล้ว`);
    await tx.query('INSERT INTO app.products(tenant_id,id,name,category,sales_unit,attributes) VALUES($1,$2,$3,$4,$5,$6)',[ctx.tenantId,id,d.name,d.category,d.salesUnit,JSON.stringify(d.attributes)]);
    await tx.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3)',[ctx.tenantId,d.shopId,id]);
    for(const v of d.variants){
      const variantId=randomUUID();variantIds.push(variantId);
      await tx.query('INSERT INTO app.variants(tenant_id,id,product_id,sku,attributes,price_minor) VALUES($1,$2,$3,$4,$5,$6)',[ctx.tenantId,variantId,id,v.sku,JSON.stringify(v.attributes),v.priceMinor]);
      if(v.costMinor!==null)await tx.query('INSERT INTO app.cost_versions(tenant_id,id,variant_id,amount_minor) VALUES($1,$2,$3,$4)',[ctx.tenantId,randomUUID(),variantId,v.costMinor]);
    }
    await audit(tx,ctx,'product.created',id,{variantCount:d.variants.length,shopId:d.shopId});return {id,variantIds};
  });
}
type EditableProduct={id:string;name:string;category:string;salesUnit:string;attributes:Record<string,string>;version:number};
type EditableVariant={id:string;sku:string;attributes:Record<string,string>;priceMinor:number;costMinor:number|null};
export type ProductForEdit=EditableProduct&{variants:EditableVariant[];history:{id:string;sku:string;amountMinor:number|null;effectiveAt:string;note:string|null}[];historyLimited:boolean};
async function lockProduct(tx:Tx,ctx:Context,shopId:string,productId:string,write:boolean){
  await assertShop(tx,ctx,shopId);
  const [product]=await tx.query<EditableProduct>(`SELECT p.id,p.name,p.category,p.sales_unit AS "salesUnit",p.attributes,p.version
    FROM app.products p JOIN app.shop_products sp ON sp.tenant_id=p.tenant_id AND sp.product_id=p.id
    WHERE p.tenant_id=$1 AND p.id=$2 AND sp.shop_id=$3 AND app.product_edit_allowed(p.tenant_id,p.id)
    FOR ${write?'UPDATE':'SHARE'} OF p`,[ctx.tenantId,productId,shopId]);
  if(!product)throw new AppError(404,'NOT_FOUND','ไม่พบสินค้าที่คุณมีสิทธิ์แก้ไขในร้านนี้');
  return product;
}
async function editableVariants(tx:Tx,ctx:Context,productId:string){
  return tx.query<EditableVariant>(`SELECT v.id,v.sku,v.attributes,v.price_minor AS "priceMinor",
    (SELECT c.amount_minor FROM app.cost_versions c WHERE c.tenant_id=v.tenant_id AND c.variant_id=v.id
     AND c.effective_at<=clock_timestamp() ORDER BY c.effective_at DESC,c.created_at DESC LIMIT 1) AS "costMinor"
    FROM app.variants v WHERE v.tenant_id=$1 AND v.product_id=$2 ORDER BY v.sku`,[ctx.tenantId,productId]);
}
export async function getProductForEdit(ctx:Context,shopId:string,productId:string):Promise<ProductForEdit>{
  uuid.parse(productId);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์แก้ไขสินค้า');
    // Hold a shared lock so details, version, prices and costs describe one revision.
    const product=await lockProduct(tx,ctx,shopId,productId,false);
    const variants=await editableVariants(tx,ctx,productId);
    const history=await tx.query<{id:string;sku:string;amountMinor:number|null;effectiveAt:Date;note:string|null}>(`SELECT c.id,v.sku,c.amount_minor AS "amountMinor",c.effective_at AS "effectiveAt",c.note
      FROM app.cost_versions c JOIN app.variants v ON v.tenant_id=c.tenant_id AND v.id=c.variant_id
      WHERE v.tenant_id=$1 AND v.product_id=$2 AND c.effective_at<=clock_timestamp()
      ORDER BY c.effective_at DESC,c.created_at DESC,c.id LIMIT 101`,[ctx.tenantId,productId]);
    return {...product,variants,history:history.slice(0,100).map(h=>({...h,effectiveAt:h.effectiveAt.toISOString()})),historyLimited:history.length>100};
  });
}
export async function updateProduct(ctx:Context,productId:string,input:unknown){
  uuid.parse(productId);const d=productUpdateInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์แก้ไขสินค้า');
    const product=await lockProduct(tx,ctx,d.shopId,productId,true);
    if(product.version!==d.version)throw new AppError(409,'STALE_PRODUCT','สินค้านี้ถูกแก้ไขหลังจากคุณเปิดหน้า ข้อมูลที่กรอกยังอยู่ กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง');
    const previous=await editableVariants(tx,ctx,productId),byId=new Map(previous.map(v=>[v.id,v]));
    if(previous.length!==d.variants.length||d.variants.some(v=>!byId.has(v.id)))throw new AppError(400,'INVALID_VARIANTS','รายการ SKU ไม่ตรงกับสินค้านี้ กรุณาโหลดข้อมูลล่าสุด');
    const shared=new Set(Object.keys(d.attributes).map(normalizeLabel));
    if(previous.some(v=>Object.keys(v.attributes).some(k=>shared.has(normalizeLabel(k)))))throw new AppError(400,'ATTRIBUTE_CONFLICT','รายละเอียดสินค้าและตัวเลือกขายต้องใช้ชื่อต่างกัน');
    const changedCosts=d.variants.filter(v=>v.costMinor!==byId.get(v.id)!.costMinor);
    if(changedCosts.length&&d.reason.length<3)throw new AppError(400,'COST_REASON_REQUIRED','กรุณาระบุเหตุผลที่เปลี่ยนต้นทุนอย่างน้อย 3 ตัวอักษร');
    await tx.query('UPDATE app.products SET name=$1,category=$2,sales_unit=$3,attributes=$4,version=version+1 WHERE tenant_id=$5 AND id=$6',[d.name,d.category,d.salesUnit,JSON.stringify(d.attributes),ctx.tenantId,productId]);
    for(const v of d.variants){
      if(v.priceMinor!==byId.get(v.id)!.priceMinor)await tx.query('UPDATE app.variants SET price_minor=$1 WHERE tenant_id=$2 AND id=$3',[v.priceMinor,ctx.tenantId,v.id]);
    }
    for(const v of changedCosts)await tx.query(`INSERT INTO app.cost_versions(tenant_id,id,variant_id,amount_minor,note,effective_at,created_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp())`,[ctx.tenantId,randomUUID(),v.id,v.costMinor,d.reason]);
    await audit(tx,ctx,'product.updated',productId,{shopId:d.shopId,version:product.version+1,changedCostCount:changedCosts.length});
    return {id:productId,version:product.version+1};
  });
}
export type Member={user_id:string;name:string;email:string;role:Role;active:boolean;all_shops:boolean};
export async function members(ctx:Context){return withTenant(ctx,async(tx,role)=>{
  if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าขององค์กรดูรายชื่อทีมได้');
  return tx.query<Member>('SELECT * FROM app.member_profiles() ORDER BY name');
});}
export async function changeMember(ctx:Context,userId:string,role:Role,active:boolean){
  uuid.parse(userId);
  return withTenant(ctx,async(tx,currentRole)=>{
    if(currentRole!=='owner'||userId===ctx.userId)throw new AppError(403,'FORBIDDEN','ไม่สามารถเปลี่ยนสิทธิ์นี้ได้');
    const rows=await tx.query('UPDATE app.memberships SET role=$1,active=$2 WHERE tenant_id=$3 AND user_id=$4 RETURNING user_id',[role,active,ctx.tenantId,userId]);
    if(!rows.length)throw new AppError(404,'NOT_FOUND','ไม่พบสมาชิก');
    await audit(tx,ctx,'member.updated',userId,{role,active});
  });
}
export async function activity(ctx:Context){return withTenant(ctx,async(tx,role)=>{
  if(!['owner','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูประวัติองค์กร');
  return tx.query<{id:string;action:string;created_at:Date;details:Record<string,unknown>}>('SELECT id,action,created_at,details FROM app.audit_events ORDER BY created_at DESC LIMIT 50');
});}
