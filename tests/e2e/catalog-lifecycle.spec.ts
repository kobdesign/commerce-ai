import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
async function create(page:Page){
  const stamp=Date.now(),name=`สินค้า lifecycle ${stamp}`,small=`LIFE-S-${stamp}`,medium=`LIFE-M-${stamp}`;
  const response=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'เสื้อผ้า',salesUnit:'ตัว',attributes:{วัสดุ:'คอตตอน'},variants:[{sku:small,attributes:{ขนาด:'S'},priceMinor:39900,costMinor:18000},{sku:medium,attributes:{ขนาด:'M'},priceMinor:39900,costMinor:18000}]}});
  expect(response.status()).toBe(200);return {...await response.json() as {id:string},name,small,medium};
}
async function reason(page:Page,value:string,confirm:string){
  await page.getByLabel('เหตุผลที่เปลี่ยนสถานะ').fill(value);await page.getByRole('button',{name:confirm,exact:true}).click();
}

test('owner can stop and resume one SKU or the whole product without losing its identity',async({page})=>{
  await signIn(page);const product=await create(page);await page.goto(`/catalog?saved=${product.id}`);
  await expect(page.getByText(product.small,{exact:true})).toBeVisible();
  const smallRow=page.locator('.sku-table tbody tr').filter({hasText:product.small});await smallRow.getByRole('button',{name:'หยุดขาย',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText(`SKU ${product.small}`);await reason(page,'ไซซ์ S หมดชั่วคราว','ยืนยันหยุดขาย');
  await expect(page.getByText(new RegExp(`^หยุดขาย SKU ${product.small} แล้ว`))).toBeVisible();await expect(page.getByText(product.small,{exact:true})).toHaveCount(0);await expect(page.getByText(product.medium,{exact:true})).toBeVisible();
  await page.locator('.catalog-lifecycle-tabs').getByRole('button',{name:/^หยุดขาย/}).click();await expect(page.getByText(product.small,{exact:true})).toBeVisible();
  await page.locator('.sku-table tbody tr').filter({hasText:product.small}).getByRole('button',{name:'เปิดขาย',exact:true}).click();await reason(page,'เติมสินค้ารอบใหม่แล้ว','ยืนยันเปิดขาย');
  await expect(page.getByText(new RegExp(`^เปิดขาย SKU ${product.small} แล้ว`))).toBeVisible();
  await page.locator('.catalog-lifecycle-tabs').getByRole('button',{name:/^พร้อมขาย/}).click();await expect(page.getByText(product.name,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'หยุดขายทั้งสินค้า',exact:true}).click();await reason(page,'พักขายสินค้าทั้งรุ่น','ยืนยันหยุดขาย');await expect(page.locator('.catalog-table tbody').getByText(product.name,{exact:true})).toHaveCount(0);
  await page.locator('.catalog-lifecycle-tabs').getByRole('button',{name:/^หยุดขาย/}).click();await expect(page.locator('.catalog-table tbody').getByText(product.name,{exact:true})).toBeVisible();await page.getByRole('button',{name:'เปิดขายสินค้า',exact:true}).click();await reason(page,'เปิดขายหลังตรวจสินค้าแล้ว','ยืนยันเปิดขาย');
  await page.locator('.catalog-lifecycle-tabs').getByRole('button',{name:/^พร้อมขาย/}).click();await expect(page.getByText(product.small,{exact:true})).toBeVisible();await expect(page.getByText(product.medium,{exact:true})).toBeVisible();
});

test('lifecycle dialog and catalog filters remain usable on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);const product=await create(page);await page.goto(`/catalog?saved=${product.id}`);
  await page.getByRole('button',{name:'หยุดขายทั้งสินค้า',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await reason(page,'ทดสอบหน้าจอมือถือ','ยืนยันหยุดขาย');await expect(page.getByText(new RegExp(`^หยุดขาย ${product.name} แล้ว`))).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
