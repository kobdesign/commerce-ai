import { expect,test,type Page } from '@playwright/test';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo,recordInventoryMovement } from '@commerce/domain';

async function fixture(){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),stamp=Date.now(),sku=`POLICY-${stamp}`;
  const product=await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:`สินค้าทดสอบนโยบาย ${stamp}`,category:'สินค้าอื่น',salesUnit:'ชิ้น',attributes:{วัสดุ:'ผ้า'},variants:[{sku,attributes:{ขนาด:'M'},priceMinor:35000,costMinor:14000}]});
  await withTenant(ctx,tx=>tx.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3)',[ctx.tenantId,demo.shops.shopee,product.id]));
  await recordInventoryMovement(ctx,{shopId:demo.shops.tiktok,productId:product.id,variantId:product.variantIds[0],movementType:'opening',quantity:100,sourceReference:`OPEN-${stamp}`,reason:'ตั้งยอดสำหรับทดสอบหน้า config',confirmed:true});
  return {...product,sku,name:`สินค้าทดสอบนโยบาย ${stamp}`};
}
async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
  await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
test.afterAll(async()=>closePools());

test('owner configures hybrid caps while fixed quota remains bounded by distributable stock',async({page})=>{
  const product=await fixture();await signIn(page);await page.goto('/inventory/settings');
  await expect(page.getByRole('heading',{name:'นโยบายกระจายสต็อก'})).toBeVisible();await page.getByRole('radio',{name:/Hybrid/}).check();await page.getByLabel('Safety stock ต่อ SKU').fill('10');
  await page.getByLabel(/ฉันเข้าใจว่าค่านี้จะเป็นค่าเริ่มต้น/).check();await page.getByRole('button',{name:'บันทึกค่าเริ่มต้นบริษัท'}).click();await expect(page.getByText('บันทึกค่าเริ่มต้นของบริษัทแล้ว')).toBeVisible();

  await page.goto(`/inventory?search=${encodeURIComponent(product.sku)}`);const row=page.locator('.central-stock-table tbody tr').filter({hasText:product.sku});await expect(row).toBeVisible();await row.getByRole('link',{name:'ตั้งค่าช่องทาง'}).click();
  await expect(page.getByRole('heading',{name:product.name})).toBeVisible();await expect(page.getByText('พร้อมจัดสรร').last()).toBeVisible();await page.getByRole('radio',{name:/ตั้งค่าเฉพาะ SKU นี้/}).check();
  await page.getByRole('radio',{name:/แบ่งโควตาคงที่/}).check();await page.getByLabel('Safety stock ของ SKU').fill('10');await page.getByLabel('โควตา TikTok Shop').fill('50');await page.getByLabel('โควตา Shopee').fill('50');
  await expect(page.getByText('โควตารวม 100 / จัดสรรได้ 90')).toHaveClass(/error/);await expect(page.getByRole('button',{name:'บันทึกนโยบาย SKU'})).toBeDisabled();
  await page.getByRole('radio',{name:/^Hybrid/}).check();await page.getByLabel('เพดาน TikTok Shop').fill('70');await page.getByLabel('เพดาน Shopee').fill('60');await page.getByLabel(/ฉันตรวจยอดและเข้าใจ/).check();
  await page.getByRole('button',{name:'บันทึกนโยบาย SKU'}).click();await expect(page.getByText('บันทึกนโยบายเฉพาะ SKU แล้ว')).toBeVisible();
  await page.setViewportSize({width:320,height:844});await page.screenshot({path:'artifacts/inventory-distribution-policy-320.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

  await page.goto(`/inventory?search=${encodeURIComponent(product.sku)}`);const savedRow=page.locator('.central-stock-table tbody tr').filter({hasText:product.sku});await expect(savedRow).toContainText('Hybrid');await expect(savedRow).toContainText('ตั้งค่าเฉพาะ SKU');await expect(savedRow).toContainText('เพดาน 70');await expect(savedRow).toContainText('เพดาน 60');await expect(savedRow).toContainText('ยอดบนช่องทาง: ยังไม่เชื่อม');
});
