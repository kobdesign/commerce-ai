import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';

async function start(page:Page){
 await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
 await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);await page.goto('/ai');
}

test('merchant gets an evidence-led read-only assistant and shop-scoped history',async({page})=>{
 await page.setViewportSize({width:320,height:844});await start(page);
 await expect(page.getByRole('heading',{name:'ผู้ช่วยวิเคราะห์ข้อมูล',exact:true})).toBeVisible();await expect(page.getByText('อ่านและอธิบายเท่านั้น',{exact:true})).toBeVisible();
 await expect(page.getByText('ยังไม่ได้เปิดการเชื่อมต่อโมเดล AI',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'ถามผู้ช่วย AI',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'เปิดหน้าการเงิน',exact:true})).toHaveAttribute('href','/performance');await expect(page.getByRole('link',{name:'เปิดผู้ช่วยกระทบยอด',exact:true})).toHaveAttribute('href','/settlements');
 const responsePromise=page.waitForResponse(response=>response.url().endsWith(`/api/tenants/${demo.tenants.chino}/ai`)&&response.request().method()==='POST');
 await page.getByRole('button',{name:'ตรวจรายการสินค้า',exact:true}).click();const response=await responsePromise;expect(response.ok()).toBe(true);const result=await response.json() as {id:string};
 const output=page.getByRole('status');await expect(output).toContainText('ผลจากระบบ · ไม่ได้เรียก AI');await expect(output).toContainText('รายการสินค้าและ SKU');await expect(output).toContainText('เครื่องมือนี้ไม่มีข้อมูลยอดขาย ต้นทุน หรือกำไร');await expect(output).toContainText('ผลลัพธ์นี้ไม่เปลี่ยนข้อมูลหรือสร้างงานโดยอัตโนมัติ');
 await expect(output.locator('.evidence li').first()).toBeVisible();await expect(output.locator('.evidence code').first()).not.toBeEmpty();await expect(output).not.toContainText('CUP-01');await expect(output).toContainText('Chino · TikTok');
 await expect(page.locator(`details[data-run-id="${result.id}"]`)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/assistant-evidence-320.png',fullPage:true});
 await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.shopee);await expect(page).toHaveURL(/\/catalog$/);await page.goto('/ai');
 await expect(page.getByText('Chino · Shopee · อ่านข้อมูลเฉพาะร้านที่เลือก',{exact:true})).toBeVisible();await expect(page.locator(`details[data-run-id="${result.id}"]`)).toHaveCount(0);
 const tiktokHistory=await page.request.get(`/api/tenants/${demo.tenants.chino}/ai?shopId=${demo.shops.tiktok}`),shopeeHistory=await page.request.get(`/api/tenants/${demo.tenants.chino}/ai?shopId=${demo.shops.shopee}`);
 expect(tiktokHistory.ok()).toBe(true);expect(shopeeHistory.ok()).toBe(true);expect((await tiktokHistory.json()).some((run:{id:string})=>run.id===result.id)).toBe(true);expect((await shopeeHistory.json()).some((run:{id:string})=>run.id===result.id)).toBe(false);
});

test('assistant history API requires a selected authorized shop',async({page})=>{
 await start(page);
 const missing=await page.request.get(`/api/tenants/${demo.tenants.chino}/ai`);expect(missing.status()).toBe(400);expect(await missing.json()).toMatchObject({code:'SHOP_REQUIRED'});
 const foreign=await page.request.get(`/api/tenants/${demo.tenants.chino}/ai?shopId=${demo.shops.goods}`);expect(foreign.status()).toBe(403);
});
