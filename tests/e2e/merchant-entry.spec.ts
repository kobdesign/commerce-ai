import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
import { openShopPage } from './helpers/navigation';

async function signIn(page:Page,email='owner@chino.demo'){
 await page.goto('/login');
 await page.getByLabel('อีเมล',{exact:true}).fill(email);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);
 await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
 await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();
}
const allRoutes=['/','/catalog','/inventory','/orders','/imports','/performance','/ai','/settlements','/financial-events','/expenses','/reviews','/team','/activity','/integrations/inbox','/team/service-access','/support/poc'];

test('owner starts from familiar tasks and can still find every existing workspace tool',async({page})=>{
 await signIn(page);
 const nav=page.getByRole('navigation',{name:'เมนูร้านค้า'});
 expect(await nav.locator('a:not(.nav-help)').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).toEqual(allRoutes);
 await expect(nav.getByRole('link')).toHaveCount(8); // Seven everyday links and the help link; details start collapsed.
 const guide=page.locator('#start-guide');
 await guide.locator('summary').click();await expect(guide).toHaveAttribute('open','');
 await expect(guide.getByRole('listitem')).toHaveCount(3);
 await expect(guide).toContainText('ยังไม่ใช่กำไรสุทธิ');
 await guide.getByRole('link',{name:'ไปเลือกรายงาน',exact:true}).click();
 await expect(page).toHaveURL(/\/imports$/);
 await expect(page.getByRole('heading',{name:'นำเข้ารายงาน',exact:true})).toBeVisible();
 await openShopPage(page,'สิทธิ์ระบบเชื่อมต่อ');
 await expect(page).toHaveURL(/\/team\/service-access$/);
 await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
 await expect(nav.locator('[aria-current="page"]')).toHaveText('สิทธิ์ระบบเชื่อมต่อ');
 await page.reload();
 await expect(nav.getByRole('link',{name:'สิทธิ์ระบบเชื่อมต่อ',exact:true})).toBeVisible();
});

for(const width of [390,320])test(`mobile merchant reaches money tools without horizontal menu scrolling at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await signIn(page);
 const nav=page.getByRole('navigation',{name:'เมนูร้านค้า'});
 await expect(nav.getByRole('button',{name:'เมนูทั้งหมด',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect(nav.getByRole('link',{name:'สินค้า',exact:true})).toBeVisible();
 await expect(nav.getByRole('link',{name:'นำเข้ารายงาน',exact:true})).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const screenshot=`artifacts/merchant-home-${width}.png`;
 await page.screenshot({path:screenshot,fullPage:true});
 await openShopPage(page,'กระทบยอดเงินโอน');
 await expect(page.getByRole('heading',{name:'กระทบยอดเงินโอน',exact:true})).toBeVisible();
 await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
 await page.reload();
 await expect(nav.getByRole('button',{name:'เมนูทั้งหมด',exact:true})).toContainText('กระทบยอดเงินโอน');
 await nav.getByRole('button',{name:'เมนูทั้งหมด',exact:true}).click();
 await expect(nav.locator('[aria-current="page"]')).toBeVisible();
 await nav.getByRole('link',{name:'ภาพรวม',exact:true}).click();
 await expect(nav.getByRole('button',{name:'เมนูทั้งหมด',exact:true})).toHaveAttribute('aria-expanded','false');
 await page.getByRole('link',{name:'เอารายงานยอดขายเข้าระบบ',exact:false}).click();
 await expect(page).toHaveURL(/\/imports$/);
});

test('marketing receives a usable starting path without financial values or write links',async({page})=>{
 await signIn(page,'marketing@chino.demo');
 const nav=page.getByRole('navigation',{name:'เมนูร้านค้า'});
 expect(await nav.locator('a:not(.nav-help)').evaluateAll(links=>links.map(link=>link.getAttribute('href')))).toEqual(['/','/catalog','/ai']);
 await expect(page.getByRole('link',{name:'เพิ่มสินค้า',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'สรุปข้อมูลร้าน'})).not.toContainText('ต้นทุน');
 const guide=page.locator('#start-guide');await guide.locator('summary').click();
 await expect(guide.getByRole('listitem')).toHaveCount(2);
 await guide.getByRole('link',{name:'เปิดผู้ช่วย',exact:true}).click();
 await expect(page).toHaveURL(/\/ai$/);
});

test('disclosures work with keyboard and the home help explains terms beside actual workflows',async({page})=>{
 await signIn(page);
 const summary=page.locator('#start-guide>summary');await summary.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#start-guide')).toHaveAttribute('open','');
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'เปิดรายการสินค้า',exact:true})).toBeFocused();
 await page.getByText('รหัสสินค้า (SKU) คืออะไร?',{exact:true}).click();
 await expect(page.locator('.merchant-help')).toContainText('เสื้อดำไซซ์ M');
 const group=page.getByRole('navigation').locator('summary').filter({hasText:'เงินและรายการที่ต้องตรวจ'});
 await group.focus();await page.keyboard.press('Enter');
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'กระทบยอดเงินโอน',exact:true})).toBeFocused();
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'artifacts/merchant-home-desktop.png',fullPage:true});
});

test('a new company is guided to add its first shop before seeing shop tasks',async({page})=>{
 await signIn(page);
 const settings=page.locator('#shop-settings');await settings.locator(':scope > summary').click();
 await settings.getByText('สร้างบริษัทใหม่',{exact:true}).click();
 const company=`ZZ UX test ${Date.now()}`;
 await page.getByLabel('ชื่อองค์กรใหม่',{exact:true}).fill(company);
 await page.getByRole('button',{name:'สร้างบริษัท',exact:true}).click();
 await expect(page.locator('#start-guide')).toHaveAttribute('open','');
 await expect(page.locator('#shop-settings')).toHaveAttribute('open','');
 await expect(page.getByRole('heading',{name:'วันนี้ต้องการทำอะไร?',exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'ไปเพิ่มร้านค้า',exact:true}).click();
 await page.locator('#shop-settings').getByText('เพิ่มร้านค้า',{exact:true}).click();
 await page.getByLabel('ชื่อร้าน',{exact:true}).fill('ร้านเริ่มต้น UX');
 await page.getByRole('button',{name:'เพิ่มร้าน',exact:true}).click();
 await expect(page.getByLabel('เลือกร้านค้า',{exact:true})).toContainText('ร้านเริ่มต้น UX');
 await expect(page.getByRole('heading',{name:'วันนี้ต้องการทำอะไร?',exact:true})).toBeVisible();
 await expect(page.locator('#start-guide')).toHaveAttribute('open','');
 await expect(page.locator('#start-guide').getByRole('listitem')).toHaveCount(3);
 await page.getByRole('link',{name:'เพิ่มสินค้า',exact:true}).click();
 await expect(page).toHaveURL(/\/catalog\/new$/);
});

test('auditor is guided to inspect existing data rather than upload or edit',async({page})=>{
 await signIn(page,'advisor@commerce.demo');
 await expect(page.getByRole('link',{name:'เพิ่มสินค้า',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:/เอารายงานยอดขายเข้าระบบ/})).toHaveCount(0);
 await page.locator('#start-guide>summary').click();
 await expect(page.locator('#start-guide')).toContainText('ตรวจรายงานยอดขาย');
 await page.getByRole('link',{name:'เปิดร่างรายงาน',exact:true}).click();
 await expect(page).toHaveURL(/\/imports$/);
 await expect(page.getByLabel('เลือกไฟล์ CSV',{exact:true})).toHaveCount(0);
});
