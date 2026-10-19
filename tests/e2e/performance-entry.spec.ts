import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
import { closePools,resolveContext,withTenant } from '../../packages/db/src/index';
import { createShop } from '../../packages/domain/src/index';
import { recordShopExpense } from '../../packages/finance/src/index';
import { commitDraft,saveDraft } from '../../packages/imports/src/index';
import { bangkokBusinessDate } from '../support/time';

const soldOn=bangkokBusinessDate();
test.afterAll(closePools);

async function signInAndSelect(page:Page,shopId:string){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
  await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(shopId);await expect(page).toHaveURL(/\/catalog$/);await expect(page.locator('.page-heading p')).toHaveText(/^1 สินค้า ·/);await page.goto('/performance');
}

async function isolatedShopWithSale(sku:string,stamp:number){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),shopId=await createShop(ctx,{name:`UX money ${stamp}`,channel:'direct'});
  await withTenant(ctx,tx=>tx.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3)',[ctx.tenantId,shopId,demo.products.pants]));
  const orderId=`UX-MONEY-${stamp}`,csv=`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${orderId},UX-MONEY-LINE-${stamp},${sku},1,${soldOn},319.00,80.00\n`;
  const draft=await saveDraft(ctx,{shopId,filename:`money-${stamp}.csv`,delimiter:',' as const,csv,mapping:{orderId:'order_id',sourceLineId:'source_line_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'}});
  await commitDraft(ctx,{shopId,draftId:draft.id});return {ctx,shopId,orderId,draftId:draft.id};
}

test('answers what remains with a traceable formula and mobile evidence cards',async({page})=>{
  await page.setViewportSize({width:320,height:844});const stamp=Date.now(),setup=await isolatedShopWithSale('CH-L-BK-32',stamp);
  await recordShopExpense(setup.ctx,{shopId:setup.shopId,sourceExpenseId:`UX-EXPENSE-${stamp}`,expenseType:'packaging',occurredOn:soldOn,amountMinor:2500,allocationScope:'shop_direct',allocationBasis:null,note:'กล่องและซองสำหรับรอบทดสอบ',confirmedOutsideImportedReceipt:true});
  await signInAndSelect(page,setup.shopId);
  const overview=page.locator('.merchant-money-overview');await expect(overview.getByRole('heading',{name:'เหลือ ฿44.00 จากข้อมูลที่บันทึก',exact:true})).toBeVisible();
  await expect(overview).toContainText('เงินรับจากรายงานยอดขาย');await expect(overview).toContainText('฿319.00');await expect(overview).toContainText('หลังหักต้นทุนสินค้า');await expect(overview).toContainText('฿69.00');await expect(overview).toContainText('หลังหักค่าใช้จ่ายที่บันทึก');await expect(overview).toContainText('฿44.00');
  await expect(overview).toContainText('ยังไม่ใช่กำไรสุทธิทางบัญชีหรือยอดเงินในธนาคาร');await expect(overview).toContainText('ค่าใช้จ่ายที่ยังไม่ได้กรอก');
  await expect(page.locator('details.performance-detail').first()).toHaveAttribute('open','');await expect(page.locator('details.performance-detail').nth(1)).not.toHaveAttribute('open','');
  const orderRow=page.getByRole('row').filter({hasText:setup.orderId});await expect(orderRow).toContainText('฿319.00');await expect(orderRow).toContainText('฿250.00');await expect(orderRow).toContainText('฿69.00');await expect(orderRow.getByRole('link',{name:'เปิดร่างต้นทาง',exact:true})).toHaveAttribute('href',`/imports?draft=${setup.draftId}`);
  expect((await orderRow.getByRole('cell').first().boundingBox())!.width).toBeGreaterThan(240);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await overview.scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/performance-overview-320.png',fullPage:true});
  const tools=page.locator('.performance-tools');await tools.locator('summary').click();await expect(tools.getByRole('link',{name:'คืนเงินและปรับยอด',exact:true})).toBeVisible();await expect(tools.getByRole('link',{name:'ตรวจยอดเงินโอน',exact:true})).toBeVisible();await expect(tools.getByRole('link',{name:'บันทึกค่าใช้จ่ายร้าน',exact:true})).toBeVisible();
});

test('withholds the remaining-money answer when any imported cost is unknown',async({page})=>{
  const setup=await isolatedShopWithSale('CH-L-NV-34',Date.now());await signInAndSelect(page,setup.shopId);
  const overview=page.locator('.merchant-money-overview');await expect(overview.getByRole('heading',{name:'ยังบอกเงินเหลือไม่ได้ เพราะต้นทุนสินค้าไม่ครบ',exact:true})).toBeVisible();
  await expect(overview.getByText('ยังคำนวณไม่ได้',{exact:true})).toHaveCount(2);await expect(overview.getByRole('link',{name:'เติมต้นทุนที่ขาด',exact:true})).toHaveAttribute('href','/reviews');
  await expect(page.getByText('ยังคำนวณเงินเหลือรวมไม่ได้',{exact:true})).toBeVisible();await expect(page.getByText('ระบบไม่แทนต้นทุนที่ขาดด้วยศูนย์',{exact:false})).toBeVisible();
  await expect(page.getByText('฿0.00',{exact:true})).toHaveCount(0);
});

test('keeps the empty-state import action readable and consistent',async({page})=>{
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino);
  const shopId=await createShop(ctx,{name:`UX empty ${Date.now()}`,channel:'direct'});
  await withTenant(ctx,tx=>tx.query('INSERT INTO app.shop_products(tenant_id,shop_id,product_id) VALUES($1,$2,$3)',[ctx.tenantId,shopId,demo.products.pants]));
  await signInAndSelect(page,shopId);
  const action=page.getByRole('link',{name:'เริ่มนำเข้ารายงาน',exact:true});
  await expect(action).toHaveCSS('display','inline-flex');
  await expect(action).toHaveCSS('background-color','rgb(48, 79, 112)');
  await expect(action).toHaveCSS('color','rgb(255, 255, 255)');
});
