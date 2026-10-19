import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
async function create(page:Page){
  const stamp=Date.now(),name=`สินค้า listing ${stamp}`,small=`MAP-S-${stamp}`,medium=`MAP-M-${stamp}`;
  const response=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'เสื้อผ้า',salesUnit:'ตัว',attributes:{วัสดุ:'คอตตอน'},variants:[{sku:small,attributes:{ขนาด:'S'},priceMinor:39900,costMinor:18000},{sku:medium,attributes:{ขนาด:'M'},priceMinor:39900,costMinor:18500}]}});
  expect(response.status()).toBe(200);return {...await response.json() as {id:string;variantIds:string[]},name,small,medium};
}
async function fillMapping(page:Page,variantId:string,productId:string,modelId:string){
  await page.getByLabel('SKU กลางของบริษัท').selectOption(variantId);
  await page.getByLabel(/รหัสสินค้าใน/).fill(productId);
  await page.getByLabel(/รหัสตัวเลือกสินค้า/).fill(modelId);
  await page.getByLabel(/ฉันตรวจรหัสนี้/).check();
}

test('owner confirms, corrects and audits a channel listing identity',async({page})=>{
  await signIn(page);const product=await create(page);await page.goto(`/catalog?saved=${product.id}`);
  await page.getByRole('link',{name:`เชื่อมช่องทางขายสำหรับ ${product.name}`}).click();
  await expect(page).toHaveURL(new RegExp(`/catalog/${product.id}/listings$`),{timeout:15000});
  await expect(page.getByRole('heading',{name:product.name})).toBeVisible();await expect(page.getByText('ระบบบันทึกความสัมพันธ์ของรหัสเท่านั้น')).toBeVisible();
  const externalProduct=`TT-P-${Date.now()}`,externalVariant='TT-MODEL-S';
  await fillMapping(page,product.variantIds[0],externalProduct,externalVariant);await page.getByRole('button',{name:'ยืนยันการเชื่อม'}).click();
  await expect(page.getByText(`เชื่อมรหัสกับ SKU ${product.small} แล้ว`)).toBeVisible();await expect(page.locator('.listing-record').filter({hasText:product.small})).toContainText(externalProduct);

  await fillMapping(page,product.variantIds[1],externalProduct,externalVariant);await page.getByRole('button',{name:'ยืนยันการเชื่อม'}).click();
  await expect(page.locator('.listing-form-panel .notice.error')).toContainText(`เชื่อมกับ SKU ${product.small} อยู่แล้ว`);
  await page.locator('.listing-record').filter({hasText:product.small}).getByRole('button',{name:'ยกเลิกการเชื่อม'}).click();
  await page.getByLabel('เหตุผล').fill('เลือก SKU ผิด ต้องเชื่อมกับไซซ์ M');await page.getByRole('button',{name:'ยืนยันยกเลิกการเชื่อม'}).click();
  await expect(page.getByText('ยกเลิกการเชื่อมแล้ว ประวัติเดิมยังอยู่')).toBeVisible();
  await page.getByRole('button',{name:'ยืนยันการเชื่อม'}).click();await expect(page.getByText(`เชื่อมรหัสกับ SKU ${product.medium} แล้ว`)).toBeVisible();
  await page.getByRole('button',{name:/ดูประวัติที่ยกเลิก/}).click();const old=page.locator('.listing-record.archived').filter({hasText:product.small});await expect(old).toContainText('เลือก SKU ผิด');
  await old.getByRole('button',{name:'นำกลับมาใช้'}).click();await page.getByLabel('เหตุผล').fill('ตรวจรหัสเดิมอีกครั้งแล้ว');await page.getByRole('button',{name:'ยืนยันนำกลับมาใช้'}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(`เชื่อมกับ SKU ${product.medium} อยู่แล้ว`);
});

test('listing mapping form stays readable and contained on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);const product=await create(page);await page.goto(`/catalog/${product.id}/listings`);
  await expect(page.getByRole('heading',{name:product.name})).toBeVisible();await expect(page.getByLabel('SKU กลางของบริษัท')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByText('ข้อมูลช่วยตรวจสอบ').click();await expect(page.getByLabel('SKU ที่แสดงบนช่องทาง')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
