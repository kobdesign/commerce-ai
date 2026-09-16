import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
async function signIn(page:Page,email='owner@chino.demo'){
 await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill(email);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();
}
test('owner can browse, search, add a non-clothing product, and inspect tool evidence',async({page})=>{
 await signIn(page);await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await page.getByRole('link',{name:'สินค้า',exact:true}).click();
 await expect(page.getByRole('heading',{name:'สินค้า',exact:true})).toBeVisible();
 await page.getByLabel('ค้นหาสินค้า').fill('CH-L-BK-32');await expect(page.getByText('CH-L-BK-32',{exact:true})).toBeVisible();await expect(page.getByText('CH-S-IV-L',{exact:true})).toHaveCount(0);
 await page.getByLabel('ค้นหาสินค้า').fill('');await page.getByRole('link',{name:'เพิ่มสินค้า',exact:true}).click();
 const sku='E2E-'+Date.now();await page.getByLabel('ชื่อสินค้า',{exact:true}).fill('สมุดทดสอบ');await page.getByLabel('รหัส SKU',{exact:true}).fill(sku);await page.getByLabel('หมวดสินค้า',{exact:true}).fill('เครื่องเขียน');await page.getByLabel('ราคาขาย (บาท)',{exact:true}).fill('125.50');await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(page.getByText(sku,{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'วิเคราะห์ข้อมูล',exact:true}).click();await page.getByRole('button',{name:'ตรวจรายการสินค้า'}).click();
 await expect(page.getByRole('status')).toContainText('ไม่ได้เรียกโมเดล');await expect(page.getByRole('status')).not.toContainText('CUP-01');
});
test('forged tenant API access and cross-origin mutations are denied',async({page})=>{
 await signIn(page);
 const denied=await page.request.get(`/api/tenants/${demo.tenants.goods}/catalog?shopId=${demo.shops.goods}`);expect(denied.status()).toBe(403);expect(await denied.text()).not.toContain('Everyday');
 const csrf=await page.request.post(`/api/tenants/${demo.tenants.chino}/shops`,{headers:{Origin:'https://attacker.example'},data:{name:'forbidden',channel:'direct'}});expect(csrf.status()).toBe(403);
});
test('marketing sees catalog without costs and cannot create products',async({page})=>{
 await signIn(page,'marketing@chino.demo');await page.getByRole('link',{name:'สินค้า',exact:true}).click();
 await expect(page.getByRole('columnheader',{name:'ต้นทุน',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'เพิ่มสินค้า',exact:true})).toHaveCount(0);
 const res=await page.request.get(`/api/tenants/${demo.tenants.chino}/catalog?shopId=${demo.shops.tiktok}`);expect(res.status()).toBe(200);expect(await res.text()).not.toContain('costMinor');
 await expect(page.getByRole('link',{name:'เงินรับและต้นทุน',exact:true})).toHaveCount(0);
});
test('multi-org user can switch workspace and sees only selected catalog',async({page})=>{
 await signIn(page,'advisor@commerce.demo');await page.getByLabel('เลือกบริษัท',{exact:true}).selectOption(demo.tenants.goods);
 await expect(page.getByLabel('เลือกบริษัท',{exact:true})).toHaveValue(demo.tenants.goods);await page.getByRole('link',{name:'สินค้า',exact:true}).click();
 await page.getByLabel('ค้นหาสินค้า').fill('CUP-01');await expect(page.getByText('CUP-01',{exact:true})).toBeVisible();await expect(page.getByText('CH-L-BK-32',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'ออกจากระบบ'}).click();await expect(page).toHaveURL(/login/);
 expect((await page.request.get('/api/organizations')).status()).toBe(401);
});
test('mobile layout has no horizontal page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await signIn(page);await page.getByRole('link',{name:'สินค้า',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('creates a product with dynamic details and six real SKU variants',async({page})=>{
 await signIn(page);await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
 await page.getByRole('link',{name:'เพิ่มสินค้า',exact:true}).click();
 await page.getByLabel('ชื่อสินค้า',{exact:true}).fill('เสื้อหลายตัวเลือก '+Date.now());
 await page.getByLabel('หมวดสินค้า',{exact:true}).fill('เสื้อผ้า');
 for(const [i,name] of ['วัสดุ','ประเทศ','การดูแล'].entries()){
   await page.getByRole('button',{name:'เพิ่มรายละเอียด',exact:true}).click();
   await page.getByLabel(`ชื่อรายละเอียด ${i+1}`,{exact:true}).fill(name);
   await page.getByLabel(`ค่ารายละเอียด ${i+1}`,{exact:true}).fill(['คอตตอน','ไทย','ซักมือ'][i]);
 }
 await page.getByRole('button',{name:'เพิ่มรายละเอียด',exact:true}).click();await page.getByRole('button',{name:'ลบรายละเอียด 4',exact:true}).click();
 await page.getByLabel('รหัส SKU',{exact:true}).fill('MATRIX-'+Date.now());
 await page.getByLabel('ราคาขาย (บาท)',{exact:true}).fill('499.50');
 await page.getByLabel('ต้นทุนต่อหน่วย (บาท)',{exact:true}).fill('200');
 await page.getByLabel('สินค้ามีหลายตัวเลือก',{exact:true}).check();
 await page.getByLabel('ชื่อตัวเลือก 1',{exact:true}).fill('สี');await page.getByLabel('ค่าตัวเลือก 1',{exact:true}).fill('ขาว, ดำ');
 await page.getByRole('button',{name:'เพิ่มประเภทตัวเลือก',exact:true}).click();
 await page.getByLabel('ชื่อตัวเลือก 2',{exact:true}).fill('ไซซ์');await page.getByLabel('ค่าตัวเลือก 2',{exact:true}).fill('S, M, L');
 await page.getByRole('button',{name:'สร้างรายการ SKU',exact:true}).click();
 await expect(page.getByLabel('SKU รายการ 6',{exact:true})).toBeVisible();
 await page.getByLabel('ราคาขายรายการ 6',{exact:true}).fill('550');
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await page.reload();await expect(page.getByText('ซักมือ',{exact:true})).toBeVisible();
 await expect(page.locator('.sku-table tbody tr')).toHaveCount(6);
 await expect(page.locator('.sku-table')).toContainText('550');
});
test('inspects CSV, reports row issues and reopens a saved draft without posting revenue',async({page})=>{
 await signIn(page);await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
 await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
 const name='browser-'+Date.now()+'.csv';
 const csv=`order_id,sku,quantity,date,net_sales\n${name}-01,CH-L-BK-32,1,2026-09-16,599\n${name}-02,UNKNOWN,1,2026-09-16,100\n`;
 await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(csv)});
 await expect(page.getByRole('heading',{name:'จับคู่คอลัมน์',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();
 await expect(page.getByText('ไม่พบ SKU นี้ในร้านที่เลือก',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('ยังไม่รวมเป็นยอดขาย');
 const history=page.locator('details.import-history');
 await expect(history).not.toHaveAttribute('open','');
 await history.locator('summary').click();await expect(history).toHaveAttribute('open','');
 await page.getByRole('link',{name,exact:true}).click();await expect(page).toHaveURL(/draft=/);
 await page.reload();await expect(page.getByText('ไม่พบ SKU นี้ในร้านที่เลือก',{exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('ร่างที่บันทึกไว้');
});
for(const width of [1280,390])test(`size chips support keyboard, duplicates, removal and safe SKU regeneration at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await signIn(page);
 await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
 await page.getByRole('link',{name:'เพิ่มสินค้า',exact:true}).click();
 await page.getByLabel('ชื่อสินค้า',{exact:true}).fill('เสื้อทดสอบป้ายขนาด '+Date.now());
 await page.getByLabel('หมวดสินค้า',{exact:true}).fill('เสื้อผ้า');
 await page.getByLabel('รหัส SKU',{exact:true}).fill('CHIPS-'+Date.now());
 await page.getByLabel('ราคาขาย (บาท)',{exact:true}).fill('399');
 await page.getByLabel('สินค้ามีหลายตัวเลือก',{exact:true}).check();
 await page.getByLabel('ชื่อตัวเลือก 1',{exact:true}).fill('ขนาด');
 const entry=page.getByLabel('ค่าตัวเลือก 1',{exact:true}),chips=page.getByRole('list',{name:'ค่าที่เพิ่มในตัวเลือก 1'});
 await entry.fill('S');await entry.press('Enter');await expect(chips.getByText('S',{exact:true})).toBeVisible();await expect(page).toHaveURL(/catalog\/new/);
 await entry.fill('M');await page.getByRole('button',{name:'เพิ่มค่าในตัวเลือก 1',exact:true}).click();
 await page.getByRole('button',{name:'เพิ่ม S, M, L, XL',exact:true}).click();await expect(chips.getByRole('listitem')).toHaveCount(4);
 await entry.fill(' s ');await entry.press('Enter');await expect(chips.getByRole('listitem')).toHaveCount(4);await expect(page.locator('.option-message')).toContainText('ไม่เพิ่มซ้ำ');
 await page.getByRole('button',{name:'สร้างรายการ SKU',exact:true}).click();
 const originalCode=await page.getByLabel('SKU รายการ 3',{exact:true}).inputValue();
 await page.getByLabel('ราคาขายรายการ 3',{exact:true}).fill('550');
 await page.getByRole('button',{name:'ลบค่า S ในตัวเลือก 1',exact:true}).click();
 await entry.fill('XXL');
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();await expect(page.locator('.editor-form').getByRole('alert')).toContainText('หลังแก้ตัวเลือก');
 await page.getByRole('button',{name:'อัปเดตรายการ SKU',exact:true}).click();
 await expect(chips.getByRole('listitem')).toHaveCount(4);await expect(entry).toHaveValue('');
 await expect(page.getByLabel('SKU รายการ 2',{exact:true})).toHaveValue(originalCode);
 await expect(page.getByLabel('ราคาขายรายการ 2',{exact:true})).toHaveValue('550');
 const codes=await page.locator('.variant-table input[aria-label^="SKU รายการ"]').evaluateAll(inputs=>inputs.map(i=>(i as HTMLInputElement).value));expect(new Set(codes).size).toBe(4);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.locator('.axis-row').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/size-options-${width}.png`});
 await page.getByRole('button',{name:'บันทึกสินค้า',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกสินค้าแล้ว');
 await page.reload();await expect(page.locator('.sku-table tbody tr')).toHaveCount(4);await expect(page.locator('.sku-table')).toContainText('ขนาด: XXL');await expect(page.locator('.sku-table')).toContainText('550.00');
});
