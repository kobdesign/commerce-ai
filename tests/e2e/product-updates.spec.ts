import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:3001';
async function signIn(page:Page){
 await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
}
async function create(page:Page){
 const sku='EDIT-BROWSER-'+Date.now(),name='เสื้อทดสอบแก้ไข '+Date.now();
 const result=await page.request.post(`/api/tenants/${demo.tenants.chino}/products`,{headers:{Origin:origin},data:{shopId:demo.shops.tiktok,name,category:'เสื้อผ้า',salesUnit:'ตัว',attributes:{วัสดุ:'คอตตอน'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:39900,costMinor:null}]}});
 expect(result.status()).toBe(200);return {...await result.json() as {id:string},sku,name};
}
for(const width of [1280,390])test(`edit product, persist exact cost and inspect history at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await signIn(page);const product=await create(page);
 await page.goto(`/catalog?saved=${product.id}`);await page.getByRole('link',{name:`แก้ไข ${product.name}`,exact:true}).click();
 await expect(page.getByRole('heading',{name:'แก้ไขสินค้า',exact:true})).toBeVisible();
 await page.getByLabel('ชื่อสินค้า',{exact:true}).fill(product.name+' ปรับปรุง');
 await page.getByLabel('ค่ารายละเอียด 1',{exact:true}).fill('คอตตอน 100%');
 await page.getByLabel(`ราคาขาย ${product.sku}`,{exact:true}).fill('429.99');
 await page.getByLabel(`ต้นทุน ${product.sku}`,{exact:true}).fill('199.99');
 await page.getByLabel('เหตุผลที่เปลี่ยนต้นทุน',{exact:true}).fill('ต้นทุนตามใบสั่งซื้อรอบใหม่');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await page.getByRole('link',{name:`แก้ไข ${product.name} ปรับปรุง`,exact:true}).click();await expect(page).toHaveURL(`/catalog/${product.id}/edit`);await page.reload();
 await expect(page.getByLabel(`ต้นทุน ${product.sku}`,{exact:true})).toHaveValue('199.99');
 await expect(page.getByLabel(`ราคาขาย ${product.sku}`,{exact:true})).toHaveValue('429.99');
 await expect(page.getByLabel('ค่ารายละเอียด 1',{exact:true})).toHaveValue('คอตตอน 100%');
 await expect(page.locator('.cost-history')).toContainText('ต้นทุนตามใบสั่งซื้อรอบใหม่');
 await expect(page.getByLabel('เหตุผลที่เปลี่ยนต้นทุน',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/product-edit-${width}.png`,fullPage:true});
 // Clearing the cost must add an unknown-cost record instead of reviving old cost.
 await page.getByLabel(`ต้นทุน ${product.sku}`,{exact:true}).fill('');await page.getByLabel('เหตุผลที่เปลี่ยนต้นทุน',{exact:true}).fill('รอตรวจสอบราคาใหม่');
 await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await page.getByRole('link',{name:`แก้ไข ${product.name} ปรับปรุง`,exact:true}).click();
 await expect(page.getByLabel(`ต้นทุน ${product.sku}`,{exact:true})).toHaveValue('');await expect(page.locator('.cost-history tbody tr')).toHaveCount(2);
 await expect(page.locator('.cost-history tbody tr').first()).toContainText('ยังไม่ระบุ');
});
test('stale tab cannot overwrite saved work and can explicitly reload latest values',async({page,context})=>{
 await signIn(page);const product=await create(page),url=`/catalog/${product.id}/edit`;
 await page.goto(url);const second=await context.newPage();await second.goto(url);
 await second.getByLabel('ชื่อสินค้า',{exact:true}).fill('ข้อมูลที่ยังไม่บันทึก');
 await page.getByLabel('ชื่อสินค้า',{exact:true}).fill('ชื่อจากการบันทึกครั้งแรก');await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await second.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true}).click();
 await expect(second.locator('.editor-form').getByRole('alert')).toContainText('ถูกแก้ไขหลังจากคุณเปิดหน้า');
 await expect(second.getByLabel('ชื่อสินค้า',{exact:true})).toHaveValue('ข้อมูลที่ยังไม่บันทึก');
 await expect(second.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง',exact:true})).toBeDisabled();
 second.once('dialog',d=>d.accept());await second.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();
 await expect(second.getByLabel('ชื่อสินค้า',{exact:true})).toHaveValue('ชื่อจากการบันทึกครั้งแรก');await expect(second.locator('.editor-form').getByRole('alert')).toHaveCount(0);await second.close();
});
