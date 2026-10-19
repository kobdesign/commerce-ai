import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';

async function signIn(page:Page){
 await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
 await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
async function stockedProduct(page:Page){
 const stamp=Date.now(),name=`สินค้าสต็อกกลาง ${stamp}`,sku=`CENTRAL-${stamp}`;
 const created=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:29900,costMinor:12000}]}});
 expect(created.ok()).toBe(true);const product=await created.json() as {id:string;variantIds:string[]};
 const movement=await page.request.post(`/api/tenants/${demo.tenants.chino}/inventory`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,productId:product.id,variantId:product.variantIds[0],movementType:'receipt',quantity:8,sourceReference:`PO-${stamp}`,reason:'รับสินค้าเข้าคลังและตรวจจำนวนแล้ว',confirmed:true}});
 expect(movement.ok()).toBe(true);
 const policy=await page.request.post(`/api/tenants/${demo.tenants.chino}/inventory-distribution`,{headers:{Origin:origin},data:{scope:'sku',variantId:product.variantIds[0],source:'override',mode:'shared',safetyStock:0,channels:[{shopId:demo.shops.tiktok,quantity:null}],version:0,confirmed:true}});
 expect(policy.ok()).toBe(true);return {...product,name,sku};
}

test('central stock makes the company inventory authority visible from the main navigation',async({page})=>{
 await page.setViewportSize({width:320,height:844});await signIn(page);const product=await stockedProduct(page);
 await page.getByRole('link',{name:'สต็อกกลาง',exact:true}).click();await expect(page).toHaveURL(/\/inventory$/,{timeout:15000});
 await expect(page.getByRole('heading',{name:'สต็อกกลาง',exact:true})).toBeVisible();await expect(page.getByText('นี่คือยอดสินค้ากลางของบริษัท',{exact:true})).toBeVisible();
 await page.getByLabel('ค้นหาสินค้าหรือ SKU').fill(product.sku);await page.getByRole('button',{name:'ค้นหา',exact:true}).click();
 const row=page.locator('.central-stock-table tbody tr').filter({hasText:product.sku});await expect(row).toBeVisible();await expect(row).toContainText(product.name);await expect(row.getByText('8',{exact:true})).toHaveCount(2);await expect(row).toContainText('พร้อมจัดสรร');
 await expect(row).toContainText('TikTok Shop');await expect(row).toContainText('ยอดบนช่องทาง: ยังไม่เชื่อม');await expect(row.getByRole('button',{name:'ดูและปรับยอด'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/central-inventory-320.png',fullPage:true});
 await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.shopee);await expect(page).toHaveURL(/\/catalog$/);await page.goto(`/inventory?search=${encodeURIComponent(product.sku)}`);
 const crossChannelRow=page.locator('.central-stock-table tbody tr').filter({hasText:product.sku});await expect(crossChannelRow).toBeVisible();await expect(crossChannelRow).toContainText('TikTok Shop');
 await crossChannelRow.getByRole('button',{name:'ดูและปรับยอด'}).click();await expect(page).toHaveURL(new RegExp(`/catalog/${product.id}/inventory$`));await expect(page.getByRole('heading',{name:product.name,exact:true})).toBeVisible();
});
