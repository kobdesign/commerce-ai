import { randomUUID } from 'node:crypto';
import { withActor,withTenant,type Tx } from '@commerce/db';
import { AppError,canReadCosts,canReadInventory,canWriteCatalog,canWriteInventory,channelListingInput,channelListingLifecycleInput,commerceOrderActionInput,commerceOrderInput,inventoryCompanyDistributionInput,inventoryMovementInput,inventoryReservationActionInput,inventoryReservationInput,inventorySkuDistributionInput,productInput,productFamilyInput,productUpdateInput,productLifecycleInput,normalizeLabel,shopInput,nameSchema,uuid,type Context,type InventoryDistributionMode,type InventoryLedgerMovementType,type Role } from '@commerce/contracts';
export * from './auth';
export { demo } from './demo';
export type Shop={id:string;name:string;channel:string};
export type CatalogItem={id:string;productId:string;name:string;category:string;salesUnit:string;sku:string;attributes:Record<string,string>;sharedAttributes:Record<string,string>;optionAttributes:Record<string,string>;priceMinor:number;currency:string;productArchived:boolean;variantArchived:boolean;archiveReason:string|null;version:number;costMinor?:number|null};
export type CatalogStatus='active'|'archived'|'all';
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
export async function catalog(ctx:Context,shopId:string,search='',status:CatalogStatus='active'){
  return withTenant(ctx,async(tx,role)=>{
    await assertShop(tx,ctx,shopId);const query=search.trim();
    if(query.length>100)throw new AppError(400,'INVALID_SEARCH','คำค้นยาวเกิน 100 ตัวอักษร');
    if(!['active','archived','all'].includes(status))throw new AppError(400,'INVALID_STATUS','สถานะสินค้าไม่ถูกต้อง');
    const result=await tx.query<CatalogItem>(`SELECT v.id,p.id AS "productId",p.name,p.category,p.sales_unit AS "salesUnit",v.sku,p.attributes || v.attributes AS attributes,p.attributes AS "sharedAttributes",v.attributes AS "optionAttributes",v.price_minor AS "priceMinor",v.currency,
      p.archived_at IS NOT NULL AS "productArchived",v.archived_at IS NOT NULL AS "variantArchived",COALESCE(v.archive_reason,p.archive_reason) AS "archiveReason",p.version
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      JOIN app.shop_products sp ON sp.tenant_id=p.tenant_id AND sp.product_id=p.id
      WHERE sp.shop_id=$1 AND sp.tenant_id=$2
      AND ($3='' OR p.name ILIKE '%'||$3||'%' OR v.sku ILIKE '%'||$3||'%')
      AND ($4='all' OR ($4='active' AND p.archived_at IS NULL AND v.archived_at IS NULL)
        OR ($4='archived' AND (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL)))
      ORDER BY p.created_at DESC,p.name,v.sku LIMIT 200`,[shopId,ctx.tenantId,query,status]);
    const items=result;
    if(canReadCosts(role)){
      const costs=items.length?await tx.query<{variant_id:string;amount_minor:number|null}>(`SELECT DISTINCT ON(variant_id) variant_id,amount_minor FROM app.cost_versions WHERE variant_id=ANY($1::uuid[]) AND effective_at<=clock_timestamp() ORDER BY variant_id,effective_at DESC,created_at DESC`,[items.map(item=>item.id)]):[];
      const byId=new Map(costs.map(c=>[c.variant_id,c.amount_minor]));
      for(const item of items)item.costMinor=byId.get(item.id)??null;
    }
    const [counts]=await tx.query<{activeCount:number;archivedCount:number}>(`SELECT
      count(*) FILTER(WHERE p.archived_at IS NULL AND v.archived_at IS NULL)::int AS "activeCount",
      count(*) FILTER(WHERE p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL)::int AS "archivedCount"
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      JOIN app.shop_products sp ON sp.tenant_id=p.tenant_id AND sp.product_id=p.id
      WHERE sp.shop_id=$1 AND sp.tenant_id=$2
      AND ($3='' OR p.name ILIKE '%'||$3||'%' OR v.sku ILIKE '%'||$3||'%')`,[shopId,ctx.tenantId,query]);
    return {items,canReadCosts:canReadCosts(role),canWrite:canWriteCatalog(role),canReadInventory:canReadInventory(role),limit:200,counts};
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
type LockedProduct={id:string;name:string;category:string;salesUnit:string;attributes:Record<string,string>;version:number;archivedAt:Date|null;archiveReason:string|null};
type LockedVariant={id:string;sku:string;attributes:Record<string,string>;priceMinor:number;costMinor:number|null;archivedAt:Date|null;archiveReason:string|null};
type EditableProduct=Omit<LockedProduct,'archivedAt'>&{archived:boolean};
type EditableVariant=Omit<LockedVariant,'archivedAt'>&{archived:boolean};
export type ProductForEdit=EditableProduct&{variants:EditableVariant[];history:{id:string;sku:string;amountMinor:number|null;effectiveAt:string;note:string|null}[];historyLimited:boolean};
type ChannelListingRow={id:string;shopId:string;shopName:string;channel:string;variantId:string;sku:string;variantAttributes:Record<string,string>;externalProductId:string;externalVariantId:string;externalSku:string|null;listingName:string|null;source:'manual'|'file'|'api';sourceReference:string|null;verifiedAt:Date;archivedAt:Date|null;archiveReason:string|null;version:number;createdAt:Date};
export type ChannelListingMapping=Omit<ChannelListingRow,'verifiedAt'|'archivedAt'|'createdAt'>&{verifiedAt:string;archivedAt:string|null;createdAt:string};
async function lockProduct(tx:Tx,ctx:Context,shopId:string,productId:string,write:boolean){
  await assertShop(tx,ctx,shopId);
  const [product]=await tx.query<LockedProduct>(`SELECT p.id,p.name,p.category,p.sales_unit AS "salesUnit",p.attributes,p.version,p.archived_at AS "archivedAt",p.archive_reason AS "archiveReason"
    FROM app.products p JOIN app.shop_products sp ON sp.tenant_id=p.tenant_id AND sp.product_id=p.id
    WHERE p.tenant_id=$1 AND p.id=$2 AND sp.shop_id=$3 AND app.product_edit_allowed(p.tenant_id,p.id)
    FOR ${write?'UPDATE':'SHARE'} OF p`,[ctx.tenantId,productId,shopId]);
  if(!product)throw new AppError(404,'NOT_FOUND','ไม่พบสินค้าที่คุณมีสิทธิ์แก้ไขในร้านนี้');
  return product;
}
async function editableVariants(tx:Tx,ctx:Context,productId:string){
  return tx.query<LockedVariant>(`SELECT v.id,v.sku,v.attributes,v.price_minor AS "priceMinor",v.archived_at AS "archivedAt",v.archive_reason AS "archiveReason",
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
    const {archivedAt,...editableProduct}=product;
    return {...editableProduct,archived:archivedAt!==null,variants:variants.map(({archivedAt,...v})=>({...v,archived:archivedAt!==null})),history:history.slice(0,100).map(h=>({...h,effectiveAt:h.effectiveAt.toISOString()})),historyLimited:history.length>100};
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
export async function setProductLifecycle(ctx:Context,productId:string,input:unknown){
  uuid.parse(productId);const d=productLifecycleInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เปลี่ยนสถานะสินค้า');
    const product=await lockProduct(tx,ctx,d.shopId,productId,true);
    if(product.version!==d.version)throw new AppError(409,'STALE_PRODUCT','สถานะสินค้านี้เปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุด');
    const archive=d.action==='archive',nowSql=archive?'clock_timestamp()':'NULL';
    if(d.target.type==='product'){
      if((product.archivedAt!==null)===archive)throw new AppError(409,'LIFECYCLE_UNCHANGED',archive?'สินค้านี้หยุดขายอยู่แล้ว':'สินค้านี้เปิดขายอยู่แล้ว');
      await tx.query(`UPDATE app.products SET archived_at=${nowSql},archived_by=$1,archive_reason=$2,version=version+1 WHERE tenant_id=$3 AND id=$4`,[archive?ctx.userId:null,archive?d.reason:null,ctx.tenantId,productId]);
      await audit(tx,ctx,archive?'product.archived':'product.restored',productId,{shopId:d.shopId,reason:d.reason,version:product.version+1});
      return {id:productId,version:product.version+1,archived:archive};
    }
    const variantId=d.target.variantId,variants=await editableVariants(tx,ctx,productId),variant=variants.find(v=>v.id===variantId);
    if(!variant)throw new AppError(404,'VARIANT_NOT_FOUND','ไม่พบ SKU ในสินค้านี้');
    if(!archive&&product.archivedAt)throw new AppError(409,'PRODUCT_ARCHIVED','เปิดขายสินค้าก่อน แล้วจึงเปิดขาย SKU นี้');
    if((variant.archivedAt!==null)===archive)throw new AppError(409,'LIFECYCLE_UNCHANGED',archive?'SKU นี้หยุดขายอยู่แล้ว':'SKU นี้เปิดขายอยู่แล้ว');
    await tx.query(`UPDATE app.variants SET archived_at=${nowSql},archived_by=$1,archive_reason=$2 WHERE tenant_id=$3 AND id=$4 AND product_id=$5`,[archive?ctx.userId:null,archive?d.reason:null,ctx.tenantId,variant.id,productId]);
    await tx.query('UPDATE app.products SET version=version+1 WHERE tenant_id=$1 AND id=$2',[ctx.tenantId,productId]);
    await audit(tx,ctx,archive?'variant.archived':'variant.restored',variant.id,{productId,shopId:d.shopId,sku:variant.sku,reason:d.reason,version:product.version+1});
    return {id:productId,variantId:variant.id,version:product.version+1,archived:archive};
  });
}
function serializeListing(row:ChannelListingRow):ChannelListingMapping{
  return {...row,verifiedAt:row.verifiedAt.toISOString(),archivedAt:row.archivedAt?.toISOString()??null,createdAt:row.createdAt.toISOString()};
}
const listingSelect=`SELECT m.id,m.shop_id AS "shopId",s.name AS "shopName",s.channel,m.variant_id AS "variantId",v.sku,v.attributes AS "variantAttributes",
  m.external_product_id AS "externalProductId",m.external_variant_id AS "externalVariantId",m.external_sku AS "externalSku",m.listing_name AS "listingName",
  m.source,m.source_reference AS "sourceReference",m.verified_at AS "verifiedAt",m.archived_at AS "archivedAt",m.archive_reason AS "archiveReason",
  m.version,m.created_at AS "createdAt"
  FROM app.channel_listing_mappings m
  JOIN app.variants v ON v.tenant_id=m.tenant_id AND v.id=m.variant_id
  JOIN app.shops s ON s.tenant_id=m.tenant_id AND s.id=m.shop_id`;
export async function channelListingMappings(ctx:Context,shopId:string,productId:string){
  uuid.parse(productId);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการรหัสสินค้าบนช่องทางขาย');
    await lockProduct(tx,ctx,shopId,productId,false);
    const rows=await tx.query<ChannelListingRow>(`${listingSelect}
      WHERE m.tenant_id=$1 AND m.shop_id=$2 AND v.product_id=$3
      ORDER BY (m.archived_at IS NOT NULL),m.created_at DESC,m.id`,[ctx.tenantId,shopId,productId]);
    return rows.map(serializeListing);
  });
}
export async function createChannelListingMapping(ctx:Context,input:unknown){
  const d=channelListingInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เชื่อมรหัสสินค้าบนช่องทางขาย');
    await lockProduct(tx,ctx,d.shopId,d.productId,false);
    const variant=(await editableVariants(tx,ctx,d.productId)).find(row=>row.id===d.variantId);
    if(!variant)throw new AppError(400,'VARIANT_NOT_FOUND','SKU ที่เลือกไม่ได้อยู่ในสินค้านี้');
    const duplicate=await tx.query<{id:string;sku:string}>(`${listingSelect}
      WHERE m.tenant_id=$1 AND m.shop_id=$2 AND m.external_product_id=$3 AND m.external_variant_id=$4 AND m.archived_at IS NULL`,[ctx.tenantId,d.shopId,d.externalProductId,d.externalVariantId]);
    if(duplicate.length)throw new AppError(409,'LISTING_IDENTITY_IN_USE',`รหัสบนช่องทางนี้เชื่อมกับ SKU ${duplicate[0].sku} อยู่แล้ว`);
    const id=randomUUID();
    await tx.query(`INSERT INTO app.channel_listing_mappings(
      tenant_id,id,shop_id,variant_id,external_product_id,external_variant_id,external_sku,listing_name,source,verified_at,verified_by,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'manual',clock_timestamp(),$9,$9)`,[
        ctx.tenantId,id,d.shopId,d.variantId,d.externalProductId,d.externalVariantId,d.externalSku,d.listingName,ctx.userId,
      ]);
    await audit(tx,ctx,'channel_listing.connected',id,{shopId:d.shopId,productId:d.productId,variantId:d.variantId,externalProductId:d.externalProductId,externalVariantId:d.externalVariantId,source:'manual'});
    const [saved]=await tx.query<ChannelListingRow>(`${listingSelect} WHERE m.tenant_id=$1 AND m.id=$2`,[ctx.tenantId,id]);
    return serializeListing(saved);
  });
}
export async function setChannelListingLifecycle(ctx:Context,mappingId:string,input:unknown){
  uuid.parse(mappingId);const d=channelListingLifecycleInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteCatalog(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เปลี่ยนสถานะการเชื่อมช่องทางขาย');
    await assertShop(tx,ctx,d.shopId);
    const [mapping]=await tx.query<Pick<ChannelListingRow,'id'|'variantId'|'externalProductId'|'externalVariantId'|'archivedAt'|'version'>&{productId:string}>(`SELECT
      m.id,m.variant_id AS "variantId",m.external_product_id AS "externalProductId",m.external_variant_id AS "externalVariantId",
      m.archived_at AS "archivedAt",m.version,v.product_id AS "productId"
      FROM app.channel_listing_mappings m JOIN app.variants v ON v.tenant_id=m.tenant_id AND v.id=m.variant_id
      WHERE m.tenant_id=$1 AND m.id=$2 AND m.shop_id=$3 AND app.product_edit_allowed(v.tenant_id,v.product_id)
      FOR UPDATE OF m`,[ctx.tenantId,mappingId,d.shopId]);
    if(!mapping)throw new AppError(404,'NOT_FOUND','ไม่พบการเชื่อมรหัสสินค้านี้');
    if(mapping.version!==d.version)throw new AppError(409,'STALE_LISTING_MAPPING','รายการนี้ถูกเปลี่ยนหลังจากคุณเปิดหน้า กรุณาโหลดข้อมูลล่าสุด');
    const archive=d.action==='archive';
    if((mapping.archivedAt!==null)===archive)throw new AppError(409,'LIFECYCLE_UNCHANGED',archive?'ยกเลิกการเชื่อมนี้แล้ว':'การเชื่อมนี้ใช้งานอยู่แล้ว');
    if(!archive){
      const duplicate=await tx.query<{id:string;sku:string}>(`${listingSelect}
        WHERE m.tenant_id=$1 AND m.shop_id=$2 AND m.external_product_id=$3 AND m.external_variant_id=$4
          AND m.archived_at IS NULL AND m.id<>$5`,[ctx.tenantId,d.shopId,mapping.externalProductId,mapping.externalVariantId,mapping.id]);
      if(duplicate.length)throw new AppError(409,'LISTING_IDENTITY_IN_USE',`รหัสบนช่องทางนี้เชื่อมกับ SKU ${duplicate[0].sku} อยู่แล้ว`);
    }
    await tx.query(`UPDATE app.channel_listing_mappings SET archived_at=${archive?'clock_timestamp()':'NULL'},archived_by=$1,archive_reason=$2,
      version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$3 AND id=$4`,[archive?ctx.userId:null,archive?d.reason:null,ctx.tenantId,mapping.id]);
    await audit(tx,ctx,archive?'channel_listing.archived':'channel_listing.restored',mapping.id,{shopId:d.shopId,productId:mapping.productId,variantId:mapping.variantId,reason:d.reason,version:mapping.version+1});
    return {id:mapping.id,version:mapping.version+1,archived:archive};
  });
}

type InventoryVariantRow={id:string;sku:string;attributes:Record<string,string>;archived:boolean;onHand:number;reserved:number;version:number};
type InventoryMovementRow={id:string;variantId:string;sku:string;movementType:InventoryLedgerMovementType;quantityDelta:number;balanceAfter:number;sourceReference:string;reason:string;confirmedAt:Date};
export type InventoryMovement=Omit<InventoryMovementRow,'confirmedAt'>&{confirmedAt:string};
export type InventoryReservationStatus='reserved'|'shortage'|'committed'|'released'|'expired';
type InventoryReservationRow={id:string;variantId:string;sku:string;sourceReference:string;requestedQuantity:number;reservedQuantity:number;status:InventoryReservationStatus;expiresAt:Date;reason:string;confirmedAt:Date;resolvedAt:Date|null;resolutionReason:string|null;version:number};
export type InventoryReservation=Omit<InventoryReservationRow,'expiresAt'|'confirmedAt'|'resolvedAt'>&{expiresAt:string;confirmedAt:string;resolvedAt:string|null};
export type InventoryOverview={
  product:{id:string;name:string;salesUnit:string};
  location:{id:string;code:string;name:string}|null;
  variants:InventoryVariantRow[];
  movements:InventoryMovement[];
  reservations:InventoryReservation[];
  canWrite:boolean;
  authority:'manual_ledger';
};
export type CentralInventoryStatus='all'|'available'|'out'|'reserved'|'archived';
export type CentralInventoryChannel={shopId:string;shopName:string;channel:string;mapped:boolean;configuredQuantity:number|null;publishedQuantity:null;syncedAt:null};
export type CentralInventoryRow={
  productId:string;productName:string;category:string;salesUnit:string;
  variantId:string;sku:string;attributes:Record<string,string>;archived:boolean;
  onHand:number;reserved:number;available:number;safetyStock:number;distributable:number;
  distributionMode:InventoryDistributionMode;distributionSource:'company'|'sku';channels:CentralInventoryChannel[];
};
export type CentralInventoryOverview={
  location:{id:string;code:string;name:string}|null;
  rows:CentralInventoryRow[];
  summary:{productCount:number;skuCount:number;availableCount:number;outCount:number;reservedCount:number;archivedCount:number};
  query:{search:string;status:CentralInventoryStatus;page:number;pageSize:number;totalRows:number};
  canWrite:boolean;
  authority:'manual_ledger';
  asOf:string;
};
export type InventoryCompanyDistributionPolicy={
  mode:InventoryDistributionMode;safetyStock:number;version:number;configured:boolean;canWrite:boolean;planningOnly:true;
};
export type InventorySkuDistributionChannel={
  shopId:string;shopName:string;channel:string;quantity:number|null;plannedQuantity:number|null;
};
export type InventorySkuDistributionOverview={
  product:{id:string;name:string;salesUnit:string};variant:{id:string;sku:string;attributes:Record<string,string>};
  balance:{onHand:number;reserved:number;available:number;distributable:number};
  companyPolicy:InventoryCompanyDistributionPolicy;
  source:'inherit'|'override';mode:InventoryDistributionMode;safetyStock:number;version:number;
  channels:InventorySkuDistributionChannel[];fixedTotal:number;fixedOverAllocated:boolean;
  canWrite:boolean;planningOnly:true;
};

const canWriteDistribution=(role:Role)=>['owner','finance'].includes(role);
type CompanyDistributionRow={mode:InventoryDistributionMode;safetyStock:number;version:number};
async function companyDistributionPolicy(tx:Tx,ctx:Context,role:Role):Promise<InventoryCompanyDistributionPolicy>{
  const [row]=await tx.query<CompanyDistributionRow>(`SELECT mode,safety_stock AS "safetyStock",version
    FROM app.inventory_distribution_defaults WHERE tenant_id=$1`,[ctx.tenantId]);
  return {mode:row?.mode??'hybrid',safetyStock:row?.safetyStock??0,version:row?.version??0,configured:Boolean(row),canWrite:canWriteDistribution(role),planningOnly:true};
}

export async function inventoryCompanyDistributionPolicy(ctx:Context):Promise<InventoryCompanyDistributionPolicy>{
  return withTenant(ctx,async(tx,role)=>{
    if(!canReadInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูนโยบายสต็อก');
    return companyDistributionPolicy(tx,ctx,role);
  });
}

export async function updateInventoryCompanyDistributionPolicy(ctx:Context,input:unknown):Promise<InventoryCompanyDistributionPolicy>{
  const data=inventoryCompanyDistributionInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    if(!canWriteDistribution(role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของหรือฝ่ายการเงินแก้นโยบายสต็อกได้');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`inventory-distribution-default:${ctx.tenantId}`]);
    const [current]=await tx.query<CompanyDistributionRow>(`SELECT mode,safety_stock AS "safetyStock",version
      FROM app.inventory_distribution_defaults WHERE tenant_id=$1 FOR UPDATE`,[ctx.tenantId]);
    if((current?.version??0)!==data.version)throw new AppError(409,'STALE_DISTRIBUTION_POLICY','นโยบายบริษัทถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด');
    const nextVersion=(current?.version??0)+1;
    await tx.query(`INSERT INTO app.inventory_distribution_defaults(tenant_id,mode,safety_stock,version,updated_by)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET
      mode=EXCLUDED.mode,safety_stock=EXCLUDED.safety_stock,version=EXCLUDED.version,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by`,
      [ctx.tenantId,data.mode,data.safetyStock,nextVersion,ctx.userId]);
    await audit(tx,ctx,'inventory.distribution_default_updated',null,{before:current??null,after:{mode:data.mode,safetyStock:data.safetyStock,version:nextVersion},planningOnly:true});
    return {mode:data.mode,safetyStock:data.safetyStock,version:nextVersion,configured:true,canWrite:true,planningOnly:true};
  });
}

export async function inventorySkuDistributionPolicy(ctx:Context,variantId:string):Promise<InventorySkuDistributionOverview>{
  uuid.parse(variantId);
  return withTenant(ctx,async(tx,role)=>{
    if(!canReadInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูนโยบายสต็อก');
    const [variant]=await tx.query<{id:string;sku:string;attributes:Record<string,string>;productId:string;productName:string;salesUnit:string;onHand:number;reserved:number}>(`SELECT
      v.id,v.sku,v.attributes,p.id AS "productId",p.name AS "productName",p.sales_unit AS "salesUnit",
      COALESCE(b.on_hand,0)::int AS "onHand",COALESCE(b.reserved,0)::int AS reserved
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      LEFT JOIN app.inventory_locations l ON l.tenant_id=v.tenant_id AND l.is_default AND l.active
      LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.location_id=l.id AND b.variant_id=v.id
      WHERE v.tenant_id=$1 AND v.id=$2 AND app.variant_allowed(v.tenant_id,v.id)`,[ctx.tenantId,variantId]);
    if(!variant)throw new AppError(404,'NOT_FOUND','ไม่พบ SKU ที่คุณมีสิทธิ์ดู');
    const companyPolicy=await companyDistributionPolicy(tx,ctx,role);
    const [override]=await tx.query<CompanyDistributionRow>(`SELECT mode,safety_stock AS "safetyStock",version
      FROM app.inventory_distribution_policies WHERE tenant_id=$1 AND variant_id=$2`,[ctx.tenantId,variantId]);
    const shops=await tx.query<{shopId:string;shopName:string;channel:string}>(`SELECT s.id AS "shopId",s.name AS "shopName",s.channel
      FROM app.shop_products sp JOIN app.shops s ON s.tenant_id=sp.tenant_id AND s.id=sp.shop_id
      WHERE sp.tenant_id=$1 AND sp.product_id=$2 AND app.shop_allowed(s.tenant_id,s.id) ORDER BY s.name,s.id`,[ctx.tenantId,variant.productId]);
    const rules=override?await tx.query<{shopId:string;quantity:number}>(`SELECT shop_id AS "shopId",quantity FROM app.inventory_channel_policies
      WHERE tenant_id=$1 AND variant_id=$2`,[ctx.tenantId,variantId]):[];
    const quantities=new Map(rules.map(rule=>[rule.shopId,rule.quantity])),mode=override?.mode??companyPolicy.mode,safetyStock=override?.safetyStock??companyPolicy.safetyStock;
    const available=variant.onHand-variant.reserved,distributable=Math.max(0,available-safetyStock),fixedTotal=mode==='fixed'?rules.reduce((sum,rule)=>sum+rule.quantity,0):0;
    return {
      product:{id:variant.productId,name:variant.productName,salesUnit:variant.salesUnit},variant:{id:variant.id,sku:variant.sku,attributes:variant.attributes},
      balance:{onHand:variant.onHand,reserved:variant.reserved,available,distributable},companyPolicy,
      source:override?'override':'inherit',mode,safetyStock,version:override?.version??0,
      channels:shops.map(shop=>{const quantity=quantities.get(shop.shopId)??null;return {...shop,quantity,plannedQuantity:mode==='shared'?distributable:quantity===null?null:mode==='hybrid'?Math.min(quantity,distributable):quantity};}),
      fixedTotal,fixedOverAllocated:mode==='fixed'&&fixedTotal>distributable,canWrite:canWriteDistribution(role),planningOnly:true,
    };
  });
}

export async function updateInventorySkuDistributionPolicy(ctx:Context,input:unknown):Promise<InventorySkuDistributionOverview>{
  const data=inventorySkuDistributionInput.parse(input);
  await withTenant(ctx,async(tx,role)=>{
    if(!canWriteDistribution(role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของหรือฝ่ายการเงินแก้นโยบายสต็อกได้');
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`inventory-distribution-sku:${ctx.tenantId}:${data.variantId}`]);
    const [variant]=await tx.query<{productId:string;onHand:number;reserved:number}>(`SELECT v.product_id AS "productId",COALESCE(b.on_hand,0)::int AS "onHand",COALESCE(b.reserved,0)::int AS reserved
      FROM app.variants v LEFT JOIN app.inventory_locations l ON l.tenant_id=v.tenant_id AND l.is_default AND l.active
      LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.location_id=l.id AND b.variant_id=v.id
      WHERE v.tenant_id=$1 AND v.id=$2 AND app.variant_allowed(v.tenant_id,v.id)`,[ctx.tenantId,data.variantId]);
    if(!variant)throw new AppError(404,'NOT_FOUND','ไม่พบ SKU ที่คุณมีสิทธิ์จัดการ');
    const [current]=await tx.query<CompanyDistributionRow>(`SELECT mode,safety_stock AS "safetyStock",version
      FROM app.inventory_distribution_policies WHERE tenant_id=$1 AND variant_id=$2 FOR UPDATE`,[ctx.tenantId,data.variantId]);
    if((current?.version??0)!==data.version)throw new AppError(409,'STALE_DISTRIBUTION_POLICY','นโยบาย SKU ถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด');
    if(data.source==='inherit'){
      if(current){await tx.query('DELETE FROM app.inventory_distribution_policies WHERE tenant_id=$1 AND variant_id=$2',[ctx.tenantId,data.variantId]);await audit(tx,ctx,'inventory.distribution_sku_inherited',data.variantId,{before:current,planningOnly:true});}
      return;
    }
    const allowedShops=await tx.query<{id:string}>(`SELECT s.id FROM app.shop_products sp JOIN app.shops s ON s.tenant_id=sp.tenant_id AND s.id=sp.shop_id
      WHERE sp.tenant_id=$1 AND sp.product_id=$2 AND app.shop_allowed(s.tenant_id,s.id)`,[ctx.tenantId,variant.productId]);
    const allowed=new Set(allowedShops.map(shop=>shop.id));
    if(data.channels.some(channel=>!allowed.has(channel.shopId)))throw new AppError(403,'SHOP_FORBIDDEN','มีช่องทางที่คุณไม่มีสิทธิ์จัดการ');
    if(data.mode!=='shared'&&(data.channels.length!==allowed.size||data.channels.some(channel=>channel.quantity===null)))throw new AppError(400,'CHANNEL_QUANTITY_REQUIRED','กรอกจำนวนของทุกช่องทางให้ครบ');
    const distributable=Math.max(0,variant.onHand-variant.reserved-data.safetyStock),configuredTotal=data.channels.reduce((sum,channel)=>sum+(channel.quantity??0),0);
    if(data.mode==='fixed'&&configuredTotal>distributable)throw new AppError(409,'FIXED_QUOTA_EXCEEDS_STOCK',`โควตารวม ${configuredTotal} มากกว่าสต็อกที่จัดสรรได้ ${distributable}`);
    const nextVersion=(current?.version??0)+1;
    await tx.query(`INSERT INTO app.inventory_distribution_policies(tenant_id,variant_id,mode,safety_stock,version,updated_by)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,variant_id) DO UPDATE SET
      mode=EXCLUDED.mode,safety_stock=EXCLUDED.safety_stock,version=EXCLUDED.version,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by`,
      [ctx.tenantId,data.variantId,data.mode,data.safetyStock,nextVersion,ctx.userId]);
    await tx.query('DELETE FROM app.inventory_channel_policies WHERE tenant_id=$1 AND variant_id=$2',[ctx.tenantId,data.variantId]);
    for(const channel of data.channels)if(channel.quantity!==null)await tx.query(`INSERT INTO app.inventory_channel_policies(tenant_id,variant_id,shop_id,quantity,updated_by)
      VALUES($1,$2,$3,$4,$5)`,[ctx.tenantId,data.variantId,channel.shopId,channel.quantity,ctx.userId]);
    await audit(tx,ctx,'inventory.distribution_sku_updated',data.variantId,{before:current??null,after:{mode:data.mode,safetyStock:data.safetyStock,channels:data.channels,version:nextVersion},planningOnly:true});
  });
  return inventorySkuDistributionPolicy(ctx,data.variantId);
}

export async function centralInventoryOverview(ctx:Context,input:{search?:string;status?:string;page?:number}={}):Promise<CentralInventoryOverview>{
  const search=(input.search??'').trim(),status=(input.status||'all') as CentralInventoryStatus,page=Math.max(1,Math.floor(input.page??1)),pageSize=50;
  if(search.length>100)throw new AppError(400,'INVALID_SEARCH','คำค้นยาวเกิน 100 ตัวอักษร');
  if(!['all','available','out','reserved','archived'].includes(status))throw new AppError(400,'INVALID_STATUS','สถานะสต็อกไม่ถูกต้อง');
  return withTenant(ctx,async(tx,role)=>{
    if(!canReadInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูข้อมูลสต็อก');
    const [location]=await tx.query<{id:string;code:string;name:string}>(`SELECT id,code,name FROM app.inventory_locations
      WHERE tenant_id=$1 AND is_default AND active LIMIT 1`,[ctx.tenantId]);
    const locationId=location?.id??null;
    const [summary]=await tx.query<CentralInventoryOverview['summary']>(`SELECT
      count(DISTINCT p.id)::int AS "productCount",count(*)::int AS "skuCount",
      count(*) FILTER(WHERE GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)-COALESCE(dp.safety_stock,dd.safety_stock,0))>0)::int AS "availableCount",
      count(*) FILTER(WHERE GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)-COALESCE(dp.safety_stock,dd.safety_stock,0))=0)::int AS "outCount",
      count(*) FILTER(WHERE COALESCE(b.reserved,0)>0)::int AS "reservedCount",
      count(*) FILTER(WHERE p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL)::int AS "archivedCount"
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.variant_id=v.id AND b.location_id=$2
      LEFT JOIN app.inventory_distribution_defaults dd ON dd.tenant_id=v.tenant_id
      LEFT JOIN app.inventory_distribution_policies dp ON dp.tenant_id=v.tenant_id AND dp.variant_id=v.id
      WHERE p.tenant_id=$1 AND app.product_allowed(p.tenant_id,p.id)`,[ctx.tenantId,locationId]);
    const filter=`p.tenant_id=$1 AND app.product_allowed(p.tenant_id,p.id)
      AND ($3='' OR p.name ILIKE '%'||$3||'%' OR v.sku ILIKE '%'||$3||'%')
      AND ($4='all' OR ($4='available' AND GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)-COALESCE(dp.safety_stock,dd.safety_stock,0))>0)
        OR ($4='out' AND GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)-COALESCE(dp.safety_stock,dd.safety_stock,0))=0)
        OR ($4='reserved' AND COALESCE(b.reserved,0)>0)
        OR ($4='archived' AND (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL)))`;
    const [count]=await tx.query<{totalRows:number}>(`SELECT count(*)::int AS "totalRows"
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.variant_id=v.id AND b.location_id=$2
      LEFT JOIN app.inventory_distribution_defaults dd ON dd.tenant_id=v.tenant_id
      LEFT JOIN app.inventory_distribution_policies dp ON dp.tenant_id=v.tenant_id AND dp.variant_id=v.id
      WHERE ${filter}`,[ctx.tenantId,locationId,search,status]);
    const totalRows=count?.totalRows??0,effectivePage=Math.min(page,Math.max(1,Math.ceil(totalRows/pageSize)));
    const rows=await tx.query<CentralInventoryRow>(`SELECT p.id AS "productId",p.name AS "productName",p.category,p.sales_unit AS "salesUnit",
      v.id AS "variantId",v.sku,v.attributes,(p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL) AS archived,
      COALESCE(b.on_hand,0)::int AS "onHand",COALESCE(b.reserved,0)::int AS reserved,
      (COALESCE(b.on_hand,0)-COALESCE(b.reserved,0))::int AS available,
      COALESCE(dp.safety_stock,dd.safety_stock,0)::int AS "safetyStock",
      GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)-COALESCE(dp.safety_stock,dd.safety_stock,0))::int AS distributable,
      COALESCE(dp.mode,dd.mode,'hybrid') AS "distributionMode",CASE WHEN dp.variant_id IS NULL THEN 'company' ELSE 'sku' END AS "distributionSource",
      COALESCE(channel_scope.channels,'[]'::jsonb) AS channels
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.variant_id=v.id AND b.location_id=$2
      LEFT JOIN app.inventory_distribution_defaults dd ON dd.tenant_id=v.tenant_id
      LEFT JOIN app.inventory_distribution_policies dp ON dp.tenant_id=v.tenant_id AND dp.variant_id=v.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'shopId',s.id,'shopName',s.name,'channel',s.channel,
          'mapped',EXISTS(SELECT 1 FROM app.channel_listing_mappings m WHERE m.tenant_id=v.tenant_id AND m.shop_id=s.id AND m.variant_id=v.id AND m.archived_at IS NULL),
          'configuredQuantity',channel_policy.quantity,
          'publishedQuantity',NULL,'syncedAt',NULL
        ) ORDER BY s.name,s.id) AS channels
        FROM app.shop_products channel_product JOIN app.shops s
          ON s.tenant_id=channel_product.tenant_id AND s.id=channel_product.shop_id
        LEFT JOIN app.inventory_channel_policies channel_policy
          ON channel_policy.tenant_id=v.tenant_id AND channel_policy.variant_id=v.id AND channel_policy.shop_id=s.id
        WHERE channel_product.tenant_id=p.tenant_id AND channel_product.product_id=p.id AND app.shop_allowed(s.tenant_id,s.id)
      ) channel_scope ON true
      WHERE ${filter}
      ORDER BY (GREATEST(0,COALESCE(b.on_hand,0)-COALESCE(b.reserved,0)-COALESCE(dp.safety_stock,dd.safety_stock,0))=0) DESC,p.archived_at IS NOT NULL,v.archived_at IS NOT NULL,p.name,v.sku
      LIMIT $5 OFFSET $6`,[ctx.tenantId,locationId,search,status,pageSize,(effectivePage-1)*pageSize]);
    return {location:location??null,rows,summary:summary??{productCount:0,skuCount:0,availableCount:0,outCount:0,reservedCount:0,archivedCount:0},
      query:{search,status,page:effectivePage,pageSize,totalRows},canWrite:canWriteInventory(role),authority:'manual_ledger',asOf:new Date().toISOString()};
  });
}

async function inventoryProduct(tx:Tx,ctx:Context,shopId:string,productId:string){
  await assertShop(tx,ctx,shopId);
  const [product]=await tx.query<{id:string;name:string;salesUnit:string}>(`SELECT p.id,p.name,p.sales_unit AS "salesUnit"
    FROM app.products p JOIN app.shop_products sp ON sp.tenant_id=p.tenant_id AND sp.product_id=p.id
    WHERE p.tenant_id=$1 AND p.id=$2 AND sp.shop_id=$3 AND app.product_allowed(p.tenant_id,p.id)`,[ctx.tenantId,productId,shopId]);
  if(!product)throw new AppError(404,'NOT_FOUND','ไม่พบสินค้าที่คุณมีสิทธิ์ดูในร้านนี้');
  return product;
}

export async function inventoryOverview(ctx:Context,shopId:string,productId:string):Promise<InventoryOverview>{
  uuid.parse(productId);
  return withTenant(ctx,async(tx,role)=>{
    if(!canReadInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูข้อมูลสต็อก');
    const product=await inventoryProduct(tx,ctx,shopId,productId);
    const [location]=await tx.query<{id:string;code:string;name:string}>(`SELECT id,code,name FROM app.inventory_locations
      WHERE tenant_id=$1 AND is_default AND active LIMIT 1`,[ctx.tenantId]);
    const variants=await tx.query<InventoryVariantRow>(`SELECT v.id,v.sku,v.attributes,
      (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL) AS archived,
      COALESCE(b.on_hand,0)::int AS "onHand",COALESCE(b.reserved,0)::int AS reserved,COALESCE(b.version,0)::int AS version
      FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.variant_id=v.id AND b.location_id=$3
      WHERE v.tenant_id=$1 AND v.product_id=$2 ORDER BY v.sku`,[ctx.tenantId,productId,location?.id??null]);
    const movements=location?await tx.query<InventoryMovementRow>(`SELECT m.id,m.variant_id AS "variantId",v.sku,m.movement_type AS "movementType",
      m.quantity_delta::int AS "quantityDelta",m.balance_after::int AS "balanceAfter",COALESCE(r.source_reference,m.source_reference) AS "sourceReference",
      m.reason,m.confirmed_at AS "confirmedAt"
      FROM app.inventory_movements m JOIN app.variants v ON v.tenant_id=m.tenant_id AND v.id=m.variant_id
      LEFT JOIN app.inventory_reservations r ON r.tenant_id=m.tenant_id AND r.id::text=m.source_reference AND m.source='reservation'
      WHERE m.tenant_id=$1 AND m.location_id=$2 AND v.product_id=$3
      ORDER BY m.created_at DESC,m.id LIMIT 100`,[ctx.tenantId,location.id,productId]):[];
    const reservations=location?await tx.query<InventoryReservationRow>(`SELECT r.id,r.variant_id AS "variantId",v.sku,r.source_reference AS "sourceReference",
      r.requested_quantity::int AS "requestedQuantity",r.reserved_quantity::int AS "reservedQuantity",r.status,
      r.expires_at AS "expiresAt",r.reason,r.confirmed_at AS "confirmedAt",r.resolved_at AS "resolvedAt",
      r.resolution_reason AS "resolutionReason",r.version
      FROM app.inventory_reservations r JOIN app.variants v ON v.tenant_id=r.tenant_id AND v.id=r.variant_id
      WHERE r.tenant_id=$1 AND r.location_id=$2 AND r.shop_id=$3 AND v.product_id=$4
      ORDER BY CASE r.status WHEN 'reserved' THEN 0 WHEN 'shortage' THEN 1 ELSE 2 END,r.created_at DESC,r.id LIMIT 100`,[ctx.tenantId,location.id,shopId,productId]):[];
    return {product,location:location??null,variants,
      movements:movements.map(row=>({...row,confirmedAt:row.confirmedAt.toISOString()})),
      reservations:reservations.map(row=>({...row,expiresAt:row.expiresAt.toISOString(),confirmedAt:row.confirmedAt.toISOString(),resolvedAt:row.resolvedAt?.toISOString()??null})),
      canWrite:canWriteInventory(role),authority:'manual_ledger'};
  });
}

type RecordedInventoryMovement={id:string;duplicate:boolean;onHand:number;reserved:number;version:number};
export async function recordInventoryMovement(ctx:Context,input:unknown):Promise<RecordedInventoryMovement>{
  const d=inventoryMovementInput.parse(input),movementId=randomUUID();
  try{
    return await withTenant(ctx,async(tx,role)=>{
      if(!canWriteInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์บันทึกสต็อก');
      const [saved]=await tx.query<RecordedInventoryMovement>(`SELECT id,duplicate,on_hand::int AS "onHand",reserved::int,version::int
        FROM app.record_inventory_movement($1,$2,$3,$4,$5,$6,$7,$8)`,[
          d.shopId,d.productId,d.variantId,movementId,d.movementType,d.quantity,d.sourceReference,d.reason,
        ]);
      if(!saved.duplicate)await audit(tx,ctx,'inventory.movement_recorded',saved.id,{shopId:d.shopId,productId:d.productId,variantId:d.variantId,movementType:d.movementType,quantity:d.quantity,sourceReference:d.sourceReference,onHand:saved.onHand});
      return saved;
    });
  }catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('INSUFFICIENT_STOCK'))throw new AppError(409,'INSUFFICIENT_STOCK','ยอดคงเหลือไม่พอสำหรับการลดสต็อกนี้');
    if(message.includes('INVENTORY_REFERENCE_CONFLICT'))throw new AppError(409,'INVENTORY_REFERENCE_CONFLICT','รหัสอ้างอิงนี้เคยใช้กับข้อมูลที่ต่างกัน กรุณาตรวจรายการเดิมหรือใช้รหัสใหม่');
    if(message.includes('INVENTORY_OPENING_EXISTS'))throw new AppError(409,'INVENTORY_OPENING_EXISTS','SKU นี้มียอดตั้งต้นหรือรายการเคลื่อนไหวแล้ว ให้ใช้รับสินค้าเข้าหรือปรับเพิ่มแทน');
    if(message.includes('INVENTORY_PRODUCT_FORBIDDEN'))throw new AppError(404,'NOT_FOUND','ไม่พบสินค้าและ SKU ที่เลือกในร้านนี้');
    if(message.includes('INVENTORY_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์บันทึกสต็อก');
    if(message.includes('INVALID_INVENTORY_MOVEMENT'))throw new AppError(400,'INVALID_INVENTORY_MOVEMENT','ข้อมูลรายการสต็อกไม่ถูกต้อง');
    throw error;
  }
}

type RecordedInventoryReservation={id:string;duplicate:boolean;status:InventoryReservationStatus;reserved:number;available:number;version:number};
export async function createInventoryReservation(ctx:Context,input:unknown):Promise<RecordedInventoryReservation>{
  const d=inventoryReservationInput.parse(input),reservationId=randomUUID();
  try{
    return await withTenant(ctx,async(tx,role)=>{
      if(!canWriteInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จองสต็อก');
      const [saved]=await tx.query<RecordedInventoryReservation>(`SELECT id,duplicate,status,reserved::int,available::int,version::int
        FROM app.create_inventory_reservation($1,$2,$3,$4,$5,$6,$7,$8)`,[
          d.shopId,d.productId,d.variantId,reservationId,d.quantity,d.sourceReference,d.expiresAt,d.reason,
        ]);
      if(!saved.duplicate)await audit(tx,ctx,saved.status==='shortage'?'inventory.reservation_shortage':'inventory.reservation_created',saved.id,{shopId:d.shopId,productId:d.productId,variantId:d.variantId,quantity:d.quantity,sourceReference:d.sourceReference,expiresAt:d.expiresAt,status:saved.status});
      return saved;
    });
  }catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('RESERVATION_REFERENCE_CONFLICT'))throw new AppError(409,'RESERVATION_REFERENCE_CONFLICT','รหัสอ้างอิงนี้เคยใช้กับการจองที่มีข้อมูลต่างกัน');
    if(message.includes('INVENTORY_PRODUCT_FORBIDDEN'))throw new AppError(404,'NOT_FOUND','ไม่พบสินค้าและ SKU ที่เลือกในร้านนี้');
    if(message.includes('INVENTORY_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จองสต็อก');
    if(message.includes('INVALID_RESERVATION'))throw new AppError(400,'INVALID_RESERVATION','ข้อมูลการจองหรือเวลาหมดอายุไม่ถูกต้อง');
    throw error;
  }
}

type TransitionedInventoryReservation={id:string;status:InventoryReservationStatus;onHand:number;reserved:number;available:number;version:number};
export async function transitionInventoryReservation(ctx:Context,reservationId:string,input:unknown):Promise<TransitionedInventoryReservation>{
  uuid.parse(reservationId);const d=inventoryReservationActionInput.parse(input);
  try{
    return await withTenant(ctx,async(tx,role)=>{
      if(!canWriteInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เปลี่ยนสถานะการจอง');
      const [saved]=await tx.query<TransitionedInventoryReservation>(`SELECT id,status,on_hand::int AS "onHand",reserved::int,available::int,version::int
        FROM app.transition_inventory_reservation($1,$2,$3,$4,$5,$6,$7)`,[
          d.shopId,d.productId,reservationId,d.version,d.action,d.reason,d.action==='retry'?d.expiresAt:null,
        ]);
      await audit(tx,ctx,`inventory.reservation_${d.action}`,saved.id,{shopId:d.shopId,productId:d.productId,status:saved.status,reason:d.reason,version:saved.version});
      return saved;
    });
  }catch(error){
    if(error instanceof AppError)throw error;
    const message=error instanceof Error?error.message:'';
    if(message.includes('STALE_RESERVATION'))throw new AppError(409,'STALE_RESERVATION','การจองนี้ถูกเปลี่ยนหลังจากคุณเปิดหน้า กรุณาโหลดข้อมูลล่าสุด');
    if(message.includes('RESERVATION_DUE'))throw new AppError(409,'RESERVATION_DUE','การจองหมดเวลาแล้ว กรุณาปิดรายการหมดอายุก่อน');
    if(message.includes('RESERVATION_NOT_DUE'))throw new AppError(409,'RESERVATION_NOT_DUE','การจองนี้ยังไม่ถึงเวลาหมดอายุ');
    if(message.includes('RESERVATION_NOT_ACTIVE'))throw new AppError(409,'RESERVATION_NOT_ACTIVE','การจองนี้ไม่ได้อยู่ในสถานะจองแล้ว');
    if(message.includes('RESERVATION_NOT_RETRYABLE'))throw new AppError(409,'RESERVATION_NOT_RETRYABLE','สถานะนี้ไม่สามารถลองจองอีกครั้งได้');
    if(message.includes('RESERVATION_NOT_FOUND'))throw new AppError(404,'NOT_FOUND','ไม่พบการจองนี้');
    if(message.includes('INVALID_RESERVATION'))throw new AppError(400,'INVALID_RESERVATION','เวลาหมดอายุใหม่ไม่ถูกต้อง');
    if(message.includes('INVALID_RESERVATION_ACTION'))throw new AppError(400,'INVALID_RESERVATION_ACTION','ข้อมูลเปลี่ยนสถานะการจองไม่ถูกต้อง');
    if(message.includes('INVENTORY_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เปลี่ยนสถานะการจอง');
    if(message.includes('INVENTORY_INVARIANT'))throw new AppError(409,'INVENTORY_INVARIANT','ยอดสต็อกเปลี่ยนและไม่ตรงกับการจอง กรุณาตรวจประวัติก่อนดำเนินการ');
    throw error;
  }
}

export type OrderListingChoice={id:string;variantId:string;productId:string;sku:string;productName:string;externalProductId:string;externalVariantId:string;listingName:string|null};
export type CommerceOrderLine={id:string;externalLineId:string;listingMappingId:string;variantId:string;productId:string;sku:string;productName:string;externalProductId:string;externalVariantId:string;quantity:number;unitPriceMinor:number|null;allocationStatus:'awaiting_payment'|'reserved'|'shortage'|'committed'|'cancelled';reservationId:string|null};
type CommerceOrderRow={id:string;externalOrderId:string;orderState:'open'|'completed'|'cancelled';paymentState:'pending'|'paid';fulfillmentState:'unfulfilled'|'shipped'|'cancelled';orderedAt:Date;reservationExpiresAt:Date|null;reason:string;cancellationReason:string|null;version:number;createdAt:Date};
export type CommerceOrder=Omit<CommerceOrderRow,'orderedAt'|'reservationExpiresAt'|'createdAt'>&{orderedAt:string;reservationExpiresAt:string|null;createdAt:string;lines:CommerceOrderLine[]};
export type CommerceOrdersWorkspace={orders:CommerceOrder[];listingChoices:OrderListingChoice[];canWrite:boolean};

export async function commerceOrdersWorkspace(ctx:Context,shopId:string):Promise<CommerceOrdersWorkspace>{
  return withTenant(ctx,async(tx,role)=>{
    if(!canReadInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูคำสั่งซื้อ');
    await assertShop(tx,ctx,shopId);
    const orders=await tx.query<CommerceOrderRow>(`SELECT o.id,o.external_order_id AS "externalOrderId",o.order_state AS "orderState",o.payment_state AS "paymentState",
      o.fulfillment_state AS "fulfillmentState",o.ordered_at AS "orderedAt",o.reservation_expires_at AS "reservationExpiresAt",o.reason,
      o.cancellation_reason AS "cancellationReason",o.version,o.created_at AS "createdAt"
      FROM app.commerce_orders o WHERE o.tenant_id=$1 AND o.shop_id=$2 ORDER BY o.ordered_at DESC,o.created_at DESC,o.id LIMIT 100`,[ctx.tenantId,shopId]);
    const lines=orders.length?await tx.query<CommerceOrderLine&{orderId:string}>(`SELECT l.id,l.order_id AS "orderId",l.external_line_id AS "externalLineId",l.listing_mapping_id AS "listingMappingId",
      l.variant_id AS "variantId",v.product_id AS "productId",l.sku_snapshot AS sku,p.name AS "productName",l.external_product_id AS "externalProductId",
      l.external_variant_id AS "externalVariantId",l.quantity::int,l.unit_price_minor AS "unitPriceMinor",l.allocation_status AS "allocationStatus",l.reservation_id AS "reservationId"
      FROM app.commerce_order_lines l JOIN app.variants v ON v.tenant_id=l.tenant_id AND v.id=l.variant_id
      JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      WHERE l.tenant_id=$1 AND l.order_id=ANY($2::uuid[]) ORDER BY l.created_at,l.id`,[ctx.tenantId,orders.map(order=>order.id)]):[];
    const byOrder=new Map<string,CommerceOrderLine[]>();
    for(const {orderId,...line} of lines)byOrder.set(orderId,[...(byOrder.get(orderId)??[]),line]);
    const listingChoices=await tx.query<OrderListingChoice>(`SELECT m.id,m.variant_id AS "variantId",v.product_id AS "productId",v.sku,p.name AS "productName",
      m.external_product_id AS "externalProductId",m.external_variant_id AS "externalVariantId",m.listing_name AS "listingName"
      FROM app.channel_listing_mappings m JOIN app.variants v ON v.tenant_id=m.tenant_id AND v.id=m.variant_id
      JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      WHERE m.tenant_id=$1 AND m.shop_id=$2 AND m.archived_at IS NULL AND v.archived_at IS NULL AND p.archived_at IS NULL
      ORDER BY p.name,v.sku,m.external_product_id,m.external_variant_id`,[ctx.tenantId,shopId]);
    return {orders:orders.map(order=>({...order,orderedAt:order.orderedAt.toISOString(),reservationExpiresAt:order.reservationExpiresAt?.toISOString()??null,createdAt:order.createdAt.toISOString(),lines:byOrder.get(order.id)??[]})),listingChoices,canWrite:canWriteInventory(role)};
  });
}

type RecordedCommerceOrder={id:string;duplicate:boolean;paymentState:'pending'|'paid';reservedLines:number;shortageLines:number;version:number};
export async function createCommerceOrder(ctx:Context,input:unknown):Promise<RecordedCommerceOrder>{
  const d=commerceOrderInput.parse(input),id=randomUUID();
  const payload={externalOrderId:d.externalOrderId,orderedAt:d.orderedAt,paymentState:d.paymentState,reservationExpiresAt:d.reservationExpiresAt,reason:d.reason,lines:d.lines};
  try{return await withTenant(ctx,async(tx,role)=>{
    if(!canWriteInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์บันทึกคำสั่งซื้อ');
    const [saved]=await tx.query<RecordedCommerceOrder>(`SELECT id,duplicate,payment_state AS "paymentState",reserved_lines::int AS "reservedLines",shortage_lines::int AS "shortageLines",version::int
      FROM app.create_commerce_order($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[d.shopId,id,d.externalOrderId,d.orderedAt,d.paymentState,d.reservationExpiresAt,d.reason,JSON.stringify(payload)]);
    if(!saved.duplicate)await audit(tx,ctx,'commerce_order.created',saved.id,{shopId:d.shopId,externalOrderId:d.externalOrderId,paymentState:saved.paymentState,reservedLines:saved.reservedLines,shortageLines:saved.shortageLines,lineCount:d.lines.length});
    return saved;
  });}catch(error){throw mapCommerceOrderError(error);}
}

type TransitionedCommerceOrder={id:string;orderState:'open'|'completed'|'cancelled';paymentState:'pending'|'paid';fulfillmentState:'unfulfilled'|'shipped'|'cancelled';reservedLines:number;shortageLines:number;version:number};
export async function transitionCommerceOrder(ctx:Context,orderId:string,input:unknown):Promise<TransitionedCommerceOrder>{
  uuid.parse(orderId);const d=commerceOrderActionInput.parse(input);
  try{return await withTenant(ctx,async(tx,role)=>{
    if(!canWriteInventory(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์เปลี่ยนสถานะคำสั่งซื้อ');
    const [saved]=await tx.query<TransitionedCommerceOrder>(`SELECT id,order_state AS "orderState",payment_state AS "paymentState",fulfillment_state AS "fulfillmentState",
      reserved_lines::int AS "reservedLines",shortage_lines::int AS "shortageLines",version::int
      FROM app.transition_commerce_order($1,$2,$3,$4,$5,$6)`,[d.shopId,orderId,d.version,d.action,d.reason,d.action==='confirm_payment'?d.reservationExpiresAt:null]);
    await audit(tx,ctx,`commerce_order.${d.action}`,saved.id,{shopId:d.shopId,reason:d.reason,orderState:saved.orderState,paymentState:saved.paymentState,fulfillmentState:saved.fulfillmentState,version:saved.version});
    return saved;
  });}catch(error){throw mapCommerceOrderError(error);}
}

function mapCommerceOrderError(error:unknown):never{
  if(error instanceof AppError)throw error;
  const message=error instanceof Error?error.message:'';
  if(message.includes('ORDER_REFERENCE_CONFLICT'))throw new AppError(409,'ORDER_REFERENCE_CONFLICT','รหัสออเดอร์นี้เคยใช้กับข้อมูลที่ต่างกัน กรุณาตรวจรายการเดิม');
  if(message.includes('ORDER_LISTING_NOT_ACTIVE'))throw new AppError(409,'ORDER_LISTING_NOT_ACTIVE','รหัสสินค้าบนช่องทางไม่ได้เชื่อมกับ SKU ที่เปิดใช้งานอยู่');
  if(message.includes('STALE_ORDER'))throw new AppError(409,'STALE_ORDER','ออเดอร์นี้ถูกเปลี่ยนหลังจากคุณเปิดหน้า กรุณาโหลดข้อมูลล่าสุด');
  if(message.includes('ORDER_NOT_READY_TO_SHIP'))throw new AppError(409,'ORDER_NOT_READY_TO_SHIP','ยังส่งไม่ได้ กรุณายืนยันการชำระเงินและแก้รายการของไม่พอให้ครบก่อน');
  if(message.includes('ORDER_RESERVATION_DUE'))throw new AppError(409,'ORDER_RESERVATION_DUE','มีการจองหมดอายุแล้ว กรุณาตรวจสต็อกก่อนส่งสินค้า');
  if(message.includes('INVALID_PAYMENT_CONFIRMATION'))throw new AppError(409,'INVALID_PAYMENT_CONFIRMATION','ยืนยันการชำระเงินไม่ได้ หรือเวลาจองไม่ถูกต้อง');
  if(message.includes('ORDER_NOT_OPEN'))throw new AppError(409,'ORDER_NOT_OPEN','ออเดอร์นี้ปิดแล้วและเปลี่ยนสถานะไม่ได้');
  if(message.includes('ORDER_NOT_FOUND')||message.includes('ORDER_LINE_NOT_FOUND'))throw new AppError(404,'NOT_FOUND','ไม่พบคำสั่งซื้อนี้');
  if(message.includes('ORDER_FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการคำสั่งซื้อ');
  if(message.includes('INVALID_ORDER'))throw new AppError(400,'INVALID_ORDER','ข้อมูลคำสั่งซื้อหรือเวลาจองไม่ถูกต้อง');
  if(message.includes('INVALID_ORDER_LINE'))throw new AppError(400,'INVALID_ORDER_LINE','ข้อมูลรายการสินค้าในออเดอร์ไม่ถูกต้อง');
  if(message.includes('INVALID_ORDER_ACTION'))throw new AppError(400,'INVALID_ORDER_ACTION','ข้อมูลเปลี่ยนสถานะคำสั่งซื้อไม่ถูกต้อง');
  if(message.includes('INVENTORY_INVARIANT'))throw new AppError(409,'INVENTORY_INVARIANT','ยอดสต็อกไม่ตรงกับการจอง กรุณาตรวจสอบก่อนส่งสินค้า');
  throw error;
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
