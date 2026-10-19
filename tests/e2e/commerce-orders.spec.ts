import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
async function fixture(page:Page,stock=4){
  const stamp=Date.now(),name=`สินค้าออเดอร์ ${stamp}`,sku=`ORDER-E2E-${stamp}`;
  const productResponse=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'คอตตอน'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:29900,costMinor:12000}]}});
  expect(productResponse.status()).toBe(200);const product=await productResponse.json() as {id:string;variantIds:string[]};
  const stockResponse=await page.request.post(`/api/tenants/${demo.tenants.chino}/inventory`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,productId:product.id,variantId:product.variantIds[0],movementType:'receipt',quantity:stock,sourceReference:`IN-${stamp}`,reason:'รับสินค้าเพื่อทดสอบออเดอร์',confirmed:true}});expect(stockResponse.status()).toBe(200);
  const mappingResponse=await page.request.post(`/api/tenants/${demo.tenants.chino}/listing-mappings`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,productId:product.id,variantId:product.variantIds[0],externalProductId:`PRODUCT-${stamp}`,externalVariantId:`MODEL-${stamp}`,externalSku:sku,listingName:name,confirmed:true}});expect(mappingResponse.status()).toBe(200);const mapping=await mappingResponse.json() as {id:string};
  return {...product,mappingId:mapping.id,name,sku,stamp};
}
async function fillOrder(page:Page,row:Awaited<ReturnType<typeof fixture>>,payment:'pending'|'paid',quantity='2'){
  await page.getByLabel('เลขออเดอร์จากช่องทาง').fill(`WEB-${row.stamp}`);
  await page.getByLabel('สถานะการชำระเงิน',{exact:true}).selectOption(payment);
  await page.getByLabel('รหัสรายการ 1').fill('LINE-1');
  await page.getByLabel('สินค้าในรายการ 1').selectOption(row.mappingId);
  await page.getByLabel('จำนวนรายการ 1').fill(quantity);
  await page.getByLabel('เหตุผลการบันทึกออเดอร์').fill('ตรวจออเดอร์จาก Seller Center แล้ว');
  await page.getByLabel(/ฉันตรวจเลขออเดอร์ สินค้า และสถานะการชำระเงินแล้ว/).check();
}

test('paid order resolves listing to SKU, reserves and ships through a confirmation dialog',async({page})=>{
  await signIn(page);const row=await fixture(page,4);await page.goto('/orders');await fillOrder(page,row,'paid');await page.getByRole('button',{name:'บันทึกออเดอร์'}).click();
  await expect(page.getByText('บันทึกออเดอร์แล้ว')).toBeVisible();const record=page.locator('.order-record').filter({hasText:`WEB-${row.stamp}`});await expect(record).toContainText(row.sku);await expect(record).toContainText('ชำระแล้ว');await expect(record).toContainText('จองแล้ว');
  await record.getByRole('button',{name:'ยืนยันส่งสินค้า'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('เหตุผลที่เปลี่ยนสถานะออเดอร์').fill('แพ็กและส่งสินค้าออกจากคลังแล้ว');await dialog.getByLabel(/ฉันตรวจผลของคำสั่งนี้แล้ว/).check();await dialog.getByRole('button',{name:'ยืนยันส่งสินค้า'}).click();
  await expect(page.getByText('ยืนยันส่งสินค้าเรียบร้อยแล้ว')).toBeVisible();await expect(record).toContainText('ส่งแล้ว');await expect(record).toContainText('ตัดสินค้าแล้ว');
  await page.goto(`/catalog/${row.id}/inventory`);const stockRow=page.locator('.inventory-table tbody tr').filter({hasText:row.sku});await expect(stockRow.locator('td').nth(2)).toHaveText('2');await expect(stockRow.locator('td').nth(3)).toHaveText('0');
});

test('mobile pending order stays unallocated until payment is confirmed',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);const row=await fixture(page,3);await page.goto('/orders');await fillOrder(page,row,'pending','1');await page.getByRole('button',{name:'บันทึกออเดอร์'}).click();
  const record=page.locator('.order-record').filter({hasText:`WEB-${row.stamp}`});await expect(record).toContainText('รอชำระ');await expect(record).toContainText('รอชำระ');await record.getByRole('button',{name:'ยืนยันชำระเงิน'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('เหตุผลที่เปลี่ยนสถานะออเดอร์').fill('ตรวจยอดชำระใน Seller Center แล้ว');await dialog.getByLabel(/ฉันตรวจผลของคำสั่งนี้แล้ว/).check();await dialog.getByRole('button',{name:'ยืนยันการชำระเงิน'}).click();await expect(page.getByText('ยืนยันการชำระเงินเรียบร้อยแล้ว')).toBeVisible();await expect(record).toContainText('จองแล้ว');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
