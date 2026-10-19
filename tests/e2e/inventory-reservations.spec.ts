import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
async function create(page:Page,stock=5){
  const stamp=Date.now(),name=`สินค้าจอง ${stamp}`,sku=`RSV-E2E-${stamp}`;
  const productResponse=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'คอตตอน'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:29900,costMinor:12000}]}});
  expect(productResponse.status()).toBe(200);const product=await productResponse.json() as {id:string;variantIds:string[]};
  const stockResponse=await page.request.post(`/api/tenants/${demo.tenants.chino}/inventory`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,productId:product.id,variantId:product.variantIds[0],movementType:'receipt',quantity:stock,sourceReference:`IN-${stamp}`,reason:'รับสินค้าเพื่อทดสอบการจอง',confirmed:true}});
  expect(stockResponse.status()).toBe(200);return {...product,name,sku};
}
async function fillReservation(page:Page,{amount,reference}:{amount:string;reference:string}){
  await page.getByLabel('จำนวนที่ต้องการจอง').fill(amount);
  await page.getByLabel('รหัสอ้างอิงการจอง').fill(reference);
  await page.getByLabel('เหตุผลของการจอง').fill('ลูกค้าชำระแล้วและรอตรวจที่อยู่');
  await page.getByLabel(/ฉันตรวจ SKU จำนวน และรหัสอ้างอิงแล้ว/).check();
}

test('owner reserves, commits and records shortage without false stock movement',async({page})=>{
  await signIn(page);const product=await create(page,5);await page.goto(`/catalog/${product.id}/inventory`);
  const reference=`ORDER-${Date.now()}`;await fillReservation(page,{amount:'2',reference});await page.getByRole('button',{name:'สร้างการจอง'}).click();
  await expect(page.getByText('จองสต็อกภายในแล้ว ยอดพร้อมขายถูกลดลง')).toBeVisible();
  const record=page.locator('.inventory-reservation-record').filter({hasText:reference});await expect(record).toContainText('จองแล้ว');
  const stockRow=page.locator('.inventory-table tbody tr').filter({hasText:product.sku});
  await expect(stockRow.locator('td').nth(2)).toHaveText('5');await expect(stockRow.locator('td').nth(3)).toHaveText('2');await expect(stockRow.locator('td').nth(4)).toHaveText('3');
  await record.getByRole('button',{name:'ตัดสินค้าออก'}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('เหตุผลที่เปลี่ยนสถานะการจอง').fill('แพ็กสินค้าออกจากคลังแล้ว');await dialog.getByLabel(/ฉันตรวจผลที่จะเกิดกับยอดสต็อกแล้ว/).check();await dialog.getByRole('button',{name:'ตัดสินค้าออก'}).click();
  await expect(page.getByText('ตัดสินค้าออกเรียบร้อยแล้ว')).toBeVisible();await expect(stockRow.locator('td').nth(2)).toHaveText('3');await expect(stockRow.locator('td').nth(3)).toHaveText('0');await expect(page.locator('.inventory-history tbody tr').first()).toContainText('ตัดสินค้าออกตามการจอง');

  const shortageRef=`SHORT-${Date.now()}`;await fillReservation(page,{amount:'4',reference:shortageRef});await page.getByRole('button',{name:'สร้างการจอง'}).click();
  await expect(page.getByText('บันทึกเป็นของไม่พอแล้ว โดยยังไม่ตัดหรือจองสต็อก')).toBeVisible();await expect(page.locator('.inventory-reservation-record').filter({hasText:shortageRef})).toContainText('ของไม่พอ');
  await expect(stockRow.locator('td').nth(2)).toHaveText('3');await expect(stockRow.locator('td').nth(3)).toHaveText('0');
});

test('reservation workspace remains usable at a mobile viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);const product=await create(page,2);await page.goto(`/catalog/${product.id}/inventory`);
  await expect(page.getByRole('heading',{name:'การจองสต็อก'})).toBeVisible();await expect(page.getByLabel('จำนวนที่ต้องการจอง')).toBeVisible();await expect(page.getByRole('button',{name:'สร้างการจอง'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
