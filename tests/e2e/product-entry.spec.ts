import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';

async function start(page:Page){
 await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
 await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();
 await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
 await expect(page).toHaveURL(/\/catalog$/);await page.getByRole('link',{name:'เพิ่มสินค้า',exact:true}).click();
 await page.getByLabel('ชื่อสินค้า',{exact:true}).fill(`สินค้า UX ${Date.now()}`);
 await page.getByLabel('หมวดสินค้า',{exact:true}).fill('ของใช้ในบ้าน');
 await page.getByLabel('ราคาขาย (บาท)',{exact:true}).fill('125.50');
}

test('simple product needs no optional details and generated code preserves unknown cost',async({page})=>{
 await start(page);
 await expect(page.locator('.product-extra')).not.toHaveAttribute('open','');
 await page.getByRole('button',{name:'ช่วยตั้งรหัสสินค้า',exact:true}).click();
 const sku=await page.getByLabel('รหัสสินค้า (SKU)',{exact:true}).inputValue();expect(sku).toMatch(/^P-[A-F0-9]{8}$/);
 await expect(page.getByRole('button',{name:'ช่วยตั้งรหัสสินค้า',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts/product-entry-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 const response=await page.request.get(`/api/tenants/${demo.tenants.chino}/catalog?shopId=${demo.shops.tiktok}&search=${sku}`);
 expect(response.ok()).toBe(true);const item=(await response.json()).items.find((item:{sku:string})=>item.sku===sku);
 expect(item).toMatchObject({sku,priceMinor:12550,costMinor:null,sharedAttributes:{},optionAttributes:{}});
});

test('closed optional details reopen for missing fields and survive validation and save',async({page})=>{
 await start(page);await page.getByRole('button',{name:'ช่วยตั้งรหัสสินค้า',exact:true}).click();
 const sku=await page.getByLabel('รหัสสินค้า (SKU)',{exact:true}).inputValue();
 const extra=page.locator('.product-extra');await extra.locator('summary').click();
 await page.getByRole('button',{name:'เพิ่มรายละเอียด',exact:true}).click();
 await page.getByLabel('ชื่อรายละเอียด 1',{exact:true}).fill('วัสดุ');
 await extra.locator('summary').click();await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(extra).toHaveAttribute('open','');await expect(page.getByLabel('ค่ารายละเอียด 1',{exact:true})).toBeFocused();
 await page.getByLabel('ค่ารายละเอียด 1',{exact:true}).fill('   ');
 await extra.locator('summary').click();await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(extra).toHaveAttribute('open','');await expect(page.locator('.editor-form').getByRole('alert')).toContainText('กรอกชื่อและค่ารายละเอียดให้ครบ');
 await page.getByLabel('ค่ารายละเอียด 1',{exact:true}).fill('ไม้');
 await extra.locator('summary').click();await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await page.reload();await expect(page.getByText('ไม้',{exact:true})).toBeVisible();await expect(page.getByText(sku,{exact:true})).toBeVisible();
});

test('mobile non-clothing options fit the screen and bulk price changes require confirmation',async({page})=>{
 await page.setViewportSize({width:320,height:844});await start(page);
 await page.getByRole('button',{name:'ช่วยตั้งรหัสสินค้า',exact:true}).click();
 await page.getByLabel('สินค้ามีหลายตัวเลือก',{exact:true}).check();
 await page.getByRole('button',{name:'ใช้ตัวเลือกความจุ',exact:true}).click();
 await page.getByLabel('ค่าตัวเลือก 1',{exact:true}).fill('250 มล., 500 มล.');
 await page.getByRole('button',{name:'สร้างรายการตัวเลือก',exact:true}).click();
 const firstCode=await page.getByLabel('SKU รายการ 1',{exact:true}).inputValue();
 await page.getByLabel('ราคาขายรายการ 2',{exact:true}).fill('180');
 await page.getByLabel('ราคาเริ่มต้น (บาท)',{exact:true}).fill('150');
 await expect(page.getByLabel('ราคาขายรายการ 1',{exact:true})).toHaveValue('125.50');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'ใช้ราคาและต้นทุนนี้กับทุกรายการ',exact:true}).click();
 await expect(page.getByLabel('ราคาขายรายการ 2',{exact:true})).toHaveValue('180');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'ใช้ราคาและต้นทุนนี้กับทุกรายการ',exact:true}).click();
 await expect(page.getByLabel('ราคาขายรายการ 1',{exact:true})).toHaveValue('150');
 await expect(page.getByLabel('ราคาขายรายการ 2',{exact:true})).toHaveValue('150');
 await expect(page.getByLabel('SKU รายการ 1',{exact:true})).toHaveValue(firstCode);
 const table=page.locator('.variant-table');expect(await table.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect((await page.getByLabel('SKU รายการ 1',{exact:true}).boundingBox())!.width).toBeGreaterThan(200);
 expect((await page.getByLabel('ราคาขายรายการ 1',{exact:true}).boundingBox())!.width).toBeGreaterThan(100);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await table.scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/product-entry-options-320.png'});
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await page.reload();await expect(page.locator('.sku-table tbody tr')).toHaveCount(2);await expect(page.locator('.sku-table')).toContainText('ความจุ: 500 มล.');
});

test('duplicate server rejection keeps typed product data available for correction',async({page})=>{
 await start(page);await page.getByLabel('รหัสสินค้า (SKU)',{exact:true}).fill('CH-L-BK-32');
 const name=await page.getByLabel('ชื่อสินค้า',{exact:true}).inputValue();
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(page.locator('.editor-form').getByRole('alert')).toBeVisible();await expect(page).toHaveURL(/\/catalog\/new$/);
 await expect(page.getByLabel('ชื่อสินค้า',{exact:true})).toHaveValue(name);await expect(page.getByLabel('ราคาขาย (บาท)',{exact:true})).toHaveValue('125.50');
 await page.getByLabel('รหัสสินค้า (SKU)',{exact:true}).fill(`CORRECT-${Date.now()}`);
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
});
