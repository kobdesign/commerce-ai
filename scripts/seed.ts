import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { demo } from '../packages/domain/src/demo';
import { hashPassword } from '../packages/domain/src/auth';
if(process.env.APP_MODE!=='local-demo')throw new Error('Seeding is only allowed in local-demo.');
const db=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});const c=await db.connect();
try{
 await c.query('BEGIN');
 for(const [id,email,name] of [[demo.users.owner,'owner@chino.demo','คุณเจ้าของร้าน'],[demo.users.other,'owner@goods.demo','เจ้าของ Everyday'],[demo.users.marketing,'marketing@chino.demo','ทีมการตลาด'],[demo.users.consultant,'advisor@commerce.demo','ที่ปรึกษาสององค์กร'],[demo.users.limited,'staff@chino.demo','ทีมร้าน TikTok']]){
  await c.query('INSERT INTO private.users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[id,email,name,hashPassword(demo.password)]);
 }
 for(const [id,name] of [[demo.tenants.chino,'Chino Studio'],[demo.tenants.goods,'Everyday Goods']])await c.query('INSERT INTO app.tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,name]);
 for(const [tenant,user,role,all] of [[demo.tenants.chino,demo.users.owner,'owner',true],[demo.tenants.goods,demo.users.other,'owner',true],[demo.tenants.chino,demo.users.marketing,'marketing',true],[demo.tenants.chino,demo.users.consultant,'auditor',true],[demo.tenants.goods,demo.users.consultant,'auditor',true],[demo.tenants.chino,demo.users.limited,'operator',false]]){
  await c.query('INSERT INTO app.memberships(tenant_id,user_id,role,all_shops) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tenant,user,role,all]);
 }
 for(const [t,id,name,ch] of [[demo.tenants.chino,demo.shops.tiktok,'Chino · TikTok','tiktok'],[demo.tenants.chino,demo.shops.shopee,'Chino · Shopee','shopee'],[demo.tenants.goods,demo.shops.goods,'Everyday · Online','direct']])await c.query('INSERT INTO app.shops(tenant_id,id,name,channel) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[t,id,name,ch]);
 await c.query('INSERT INTO app.shop_grants(tenant_id,user_id,shop_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[demo.tenants.chino,demo.users.limited,demo.shops.tiktok]);
 const products=[
  {t:demo.tenants.chino,id:demo.products.pants,name:'กางเกงชิโน Everyday',cat:'เสื้อผ้า',unit:'ตัว',shop:demo.shops.tiktok,variants:[{sku:'CH-L-BK-32',attrs:{สี:'ดำ',ไซซ์:'32'},price:59900,cost:25000},{sku:'CH-L-KH-30',attrs:{สี:'กากี',ไซซ์:'30'},price:59900,cost:25000},{sku:'CH-L-NV-34',attrs:{สี:'กรมท่า',ไซซ์:'34'},price:59900,cost:null}]},
  {t:demo.tenants.chino,id:demo.products.shorts,name:'กางเกงขาสั้น Weekend',cat:'เสื้อผ้า',unit:'ตัว',shop:demo.shops.tiktok,variants:[{sku:'CH-S-KH-M',attrs:{สี:'กากี',ไซซ์:'M'},price:39900,cost:18000},{sku:'CH-S-IV-L',attrs:{สี:'ครีม',ไซซ์:'L'},price:39900,cost:18000}]},
  {t:demo.tenants.chino,id:demo.products.serum,name:'Daily Care Serum',cat:'สกินแคร์',unit:'ขวด',shop:demo.shops.shopee,variants:[{sku:'SC-DAILY-30',attrs:{ความจุ:'30 ml',สูตร:'Daily'},price:49000,cost:17000}]},
  {t:demo.tenants.goods,id:demo.products.cup,name:'แก้วน้ำ Everyday',cat:'ของใช้ในบ้าน',unit:'ชิ้น',shop:demo.shops.goods,variants:[{sku:'CUP-01',attrs:{},price:25000,cost:10000}]},
 ];
 for(const p of products){
  await c.query('INSERT INTO app.products(tenant_id,id,name,category,sales_unit) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[p.t,p.id,p.name,p.cat,p.unit]);
  await c.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.t,p.shop,p.id]);
  for(const v of p.variants){
   const result=await c.query('INSERT INTO app.variants(tenant_id,id,product_id,sku,attributes,price_minor) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,sku) DO NOTHING RETURNING id',[p.t,randomUUID(),p.id,v.sku,JSON.stringify(v.attrs),v.price]);
   if(result.rowCount&&v.cost!==null)await c.query('INSERT INTO app.cost_versions(tenant_id,id,variant_id,amount_minor) VALUES($1,$2,$3,$4)',[p.t,randomUUID(),result.rows[0].id,v.cost]);
  }
 }
 await c.query('COMMIT');console.log('Synthetic demo data ready. Existing records were preserved.');
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}
