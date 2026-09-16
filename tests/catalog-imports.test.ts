import { afterAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { buildCombinations,productFamilyInput } from '@commerce/contracts';
import { catalog,createProductFamily,demo } from '@commerce/domain';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { getDraft,inspectFile,previewImport,saveDraft } from '@commerce/imports';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const family=()=>({shopId:demo.shops.tiktok,name:'สินค้าทดสอบหลายตัวเลือก',category:'เสื้อผ้า',salesUnit:'ตัว',attributes:{ผ้า:'คอตตอน',การดูแล:'ซักมือ',ประเทศ:'ไทย'},variants:buildCombinations([{name:'สี',values:['ดำ','กากี']},{name:'ไซซ์',values:['M','L','XL']}]).map((attributes,i)=>({sku:`VAR-${randomUUID().slice(0,8)}-${i}`,attributes,priceMinor:59900+i,costMinor:i?null:25000}))});
const mapping={orderId:'order_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_sales'};
const source=()=>({shopId:demo.shops.tiktok,filename:'test.csv',delimiter:',' as const,csv:'order_id,sku,quantity,date,net_sales\n001,CH-L-BK-32,2,2026-09-01,"1,198.50"\n002,CH-L-NV-34,1,2026-09-02,599\n003,UNKNOWN,0,2026-02-30,-5\n001,CH-L-BK-32,2,2026-09-01,"1,198.50"\n',mapping});
describe('Flexible products',()=>{
 it('builds six variants with shared details and separate exact prices/costs',async()=>{
   const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),input=family();
   const saved=await createProductFamily(ctx,input),rows=(await catalog(ctx,input.shopId)).items.filter(i=>i.productId===saved.id);
   expect(saved.variantIds).toHaveLength(6);expect(rows).toHaveLength(6);
   expect(rows[0].sharedAttributes).toEqual(input.attributes);expect(rows.map(r=>r.priceMinor).sort()).toEqual(input.variants.map(v=>v.priceMinor).sort());
   expect(rows.filter(r=>r.costMinor===null)).toHaveLength(5);expect(rows.every(r=>Object.keys(r.optionAttributes).length===2)).toBe(true);
 });
 it('rolls back the whole product when any SKU is already used',async()=>{
   const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),input=family();input.variants[3].sku='CH-L-BK-32';
   const before=await withTenant(ctx,tx=>tx.query('SELECT count(*) AS n FROM app.products'));
   await expect(createProductFamily(ctx,input)).rejects.toMatchObject({status:409});
   expect(await withTenant(ctx,tx=>tx.query('SELECT count(*) AS n FROM app.products'))).toEqual(before);
   expect(await withTenant(ctx,tx=>tx.query('SELECT id FROM app.variants WHERE sku=$1',[input.variants[0].sku]))).toEqual([]);
 });
 it('rejects duplicate SKU combinations, conflicting property names and oversized option sets',()=>{
   const d=family();d.variants[1].attributes=d.variants[0].attributes;expect(productFamilyInput.safeParse(d).success).toBe(false);
   const overlap=family();overlap.attributes={...overlap.attributes,...{สี:'ดำ'}};expect(productFamilyInput.safeParse(overlap).success).toBe(false);
   expect(()=>buildCombinations([{name:'สี',values:['ดำ',' ดำ ']}])).toThrow();
   expect(()=>buildCombinations([{name:'A',values:Array.from({length:11},(_,i)=>String(i))},{name:'B',values:Array.from({length:10},(_,i)=>String(i))}])).toThrow(/100/);
 });
 it('denies bulk product creation in another tenant or unauthorized shop',async()=>{
   const ctx=await resolveContext(demo.users.owner,demo.tenants.chino);await expect(createProductFamily(ctx,{...family(),shopId:demo.shops.goods})).rejects.toMatchObject({status:403});
   const marketing=await resolveContext(demo.users.marketing,demo.tenants.chino);await expect(createProductFamily(marketing,family())).rejects.toMatchObject({status:403});
 });
});
describe('CSV inspection and saved drafts',()=>{
 it('handles BOM, quoted delimiters/newlines, preserves leading-zero order IDs and exact minor units',async()=>{
   const ctx=await resolveContext(demo.users.owner,demo.tenants.chino);
   const result=await previewImport(ctx,source());
   expect(result.rows[0]).toMatchObject({orderId:'001',quantity:2,netSalesMinor:119850,errors:[]});
   expect(result.rows[1].warnings).toContain('ยังไม่มีต้นทุนสินค้า');expect(result.rows[2].errors).toHaveLength(4);expect(result.rows[3].warnings).toHaveLength(1);
   expect(result).toMatchObject({total:4,valid:3,invalid:1,warnings:2});
   const csv='\uFEFForder_id,sku,quantity,date,net_sales,note\r\n001,CH-L-BK-32,1,2026-09-01,599,"a,b\nsecond line"';
   const data=await inspectFile(ctx,{shopId:demo.shops.tiktok,filename:'quoted.csv',delimiter:',',csv});expect(data.total).toBe(1);expect(data.sample[0][5]).toContain('\n');
 });
 it('rejects broken CSV, repeated headers, excessive rows and invalid mapping',async()=>{
   const ctx=await resolveContext(demo.users.owner,demo.tenants.chino);
   const {mapping:_,...base}=source();
   await expect(inspectFile(ctx,{...base,csv:'a,a\n1,2'})).rejects.toMatchObject({code:'INVALID_CSV'});
   await expect(inspectFile(ctx,{...base,csv:'a,b\n"unclosed'})).rejects.toMatchObject({code:'INVALID_CSV'});
   await expect(inspectFile(ctx,{...base,csv:'a\n'+'x\n'.repeat(1001)})).rejects.toMatchObject({code:'INVALID_CSV'});
   await expect(previewImport(ctx,{...source(),mapping:{...mapping,sku:'order_id'}})).rejects.toMatchObject({code:'INVALID_CSV'});
 });
 it('revalidates, persists drafts idempotently, and does not create sales facts',async()=>{
   const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),input=source();
   const [a,b]=await Promise.all([saveDraft(ctx,input),saveDraft(ctx,input)]);expect(a.id).toBe(b.id);expect([a.duplicate,b.duplicate].sort()).toEqual([false,true]);
   const draft=await getDraft(ctx,input.shopId,a.id);expect(draft.preview.total).toBe(4);expect(draft.preview.invalid).toBe(1);
   const audit=await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE action='import.draft.created' AND entity_id=$1",[a.id]));expect(audit).toHaveLength(1);
   const other=await resolveContext(demo.users.other,demo.tenants.goods);await expect(getDraft(other,demo.shops.goods,a.id)).rejects.toMatchObject({status:404});
   const direct=await withTenant(other,tx=>tx.query('SELECT * FROM app.import_drafts WHERE id=$1',[a.id]));expect(direct).toEqual([]);
 });
 it('denies financial file inspection to marketing and forged shop references',async()=>{
   const owner=await resolveContext(demo.users.owner,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino);
   await expect(previewImport(marketing,source())).rejects.toMatchObject({status:403});
   await expect(saveDraft(owner,{...source(),shopId:demo.shops.goods})).rejects.toMatchObject({status:403});
   expect(await withTenant(marketing,tx=>tx.query('SELECT * FROM app.import_drafts'))).toEqual([]);
 });
 it('checks revoked shop access when retrieving a saved draft',async()=>{
   const ctx=await resolveContext(demo.users.consultant,demo.tenants.chino);
   const owner=await resolveContext(demo.users.owner,demo.tenants.chino),draft=await saveDraft(owner,source());
   await admin.query('UPDATE app.memberships SET all_shops=false WHERE tenant_id=$1 AND user_id=$2',[ctx.tenantId,ctx.userId]);
   try{await expect(getDraft(ctx,demo.shops.tiktok,draft.id)).rejects.toMatchObject({status:403});}
   finally{await admin.query('UPDATE app.memberships SET all_shops=true WHERE tenant_id=$1 AND user_id=$2',[ctx.tenantId,ctx.userId]);}
 });
});
