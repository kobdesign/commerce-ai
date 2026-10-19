import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
async function create(page:Page){
  const stamp=Date.now(),name=`สินค้าสต็อก ${stamp}`,sku=`STOCK-${stamp}`;
  const response=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'คอตตอน'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:29900,costMinor:12000}]}});
  expect(response.status()).toBe(200);return {...await response.json() as {id:string;variantIds:string[]},name,sku};
}
async function fillMovement(page:Page,{type='receipt',amount='5',reference,reason='รับสินค้าตามใบส่งของและตรวจจำนวนแล้ว'}:{type?:string;amount?:string;reference:string;reason?:string}){
  await page.getByLabel('ประเภทรายการสต็อก').selectOption(type);
  await page.getByLabel('จำนวนสินค้า').fill(amount);
  await page.getByLabel('รหัสอ้างอิงเอกสาร').fill(reference);
  await page.getByLabel('เหตุผลของรายการสต็อก').fill(reason);
  await page.getByRole('checkbox',{name:/ฉันตรวจ SKU จำนวน และเอกสารอ้างอิงแล้ว/}).check();
}

test('owner records stock once and receives clear duplicate and insufficient-stock feedback',async({page})=>{
  await signIn(page);const product=await create(page);await page.goto(`/catalog?saved=${product.id}`);
  await page.getByRole('link',{name:`จัดการสต็อกสำหรับ ${product.name}`}).click();
  await expect(page).toHaveURL(new RegExp(`/catalog/${product.id}/inventory$`),{timeout:15000});
  await expect(page.getByRole('heading',{name:product.name})).toBeVisible();
  await expect(page.getByText('ยอดนี้เป็นสมุดสต็อกกลางของบริษัท')).toBeVisible();
  const reference=`PO-${Date.now()}`;
  await fillMovement(page,{reference});await page.getByRole('button',{name:'ยืนยันบันทึกรายการ'}).click();
  await expect(page.getByText(/บันทึก รับสินค้าเข้า แล้ว/)).toBeVisible();
  await expect(page.locator('.inventory-table tbody tr').filter({hasText:product.sku})).toContainText('5');
  await expect(page.locator('.inventory-history tbody tr').first()).toContainText(reference);

  await fillMovement(page,{reference});await page.getByRole('button',{name:'ยืนยันบันทึกรายการ'}).click();
  await expect(page.getByText('รายการนี้เคยบันทึกแล้ว ระบบจึงไม่เพิ่มยอดซ้ำ')).toBeVisible();
  await fillMovement(page,{type:'adjustment_out',amount:'6',reference:`COUNT-${Date.now()}`,reason:'ตรวจนับพบยอดต่ำกว่าระบบ'});await page.getByRole('button',{name:'ยืนยันบันทึกรายการ'}).click();
  await expect(page.locator('.inventory-form-panel .notice.error')).toContainText('ยอดคงเหลือไม่พอ');
  await expect(page.locator('.inventory-table tbody tr').filter({hasText:product.sku})).toContainText('5');
});

test('inventory remains readable and contained at a mobile viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);const product=await create(page);await page.goto(`/catalog/${product.id}/inventory`);
  await expect(page.getByRole('heading',{name:product.name})).toBeVisible();
  await expect(page.getByRole('region',{name:'สรุปสต็อก'}).getByText('คงเหลือจริง',{exact:true})).toBeVisible();
  await expect(page.getByLabel('รหัสอ้างอิงเอกสาร')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
