import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
}

test('confirms a reviewed CSV once and traces contribution back to its source draft',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
  const stamp=Date.now(),order=`FIN-E2E-${stamp}`,filename=`financial-${stamp}.csv`;
  const csv=`order_id,sku,quantity,date,net_receipt,platform_fee\n${order},CH-L-BK-32,1,2026-09-16,319.00,80.00\n`;
  await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name:filename,mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(page.getByRole('heading',{name:'จับคู่คอลัมน์',exact:true})).toBeVisible();
  await expect(page.locator('details.import-history')).not.toHaveAttribute('open','');
  await expect(page.getByLabel('คอลัมน์ เงินรับสุทธิต่อรายการ (บาท)',{exact:true})).toHaveValue('net_receipt');
  await expect(page.getByLabel('คอลัมน์ ค่าธรรมเนียมแพลตฟอร์ม (บาท) · ไม่บังคับ',{exact:true})).toHaveValue('platform_fee');
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText(order,{exact:true})).toBeVisible();
  await expect(page.getByText('฿319.00',{exact:true})).toBeVisible();await expect(page.getByText('฿80.00',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกร่างแล้ว');
  await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();await page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้า 1 รายการแล้ว');
  await page.getByRole('link',{name:'ดูเงินรับและต้นทุน',exact:true}).click();await expect(page.getByRole('heading',{name:'เงินรับและต้นทุน',exact:true})).toBeVisible();
  const orderRow=page.getByRole('row').filter({hasText:order});await expect(orderRow).toContainText('฿319.00');await expect(orderRow).toContainText('฿80.00');await expect(orderRow).toContainText('฿250.00');await expect(orderRow).toContainText('฿69.00');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/financial-summary-390.png',fullPage:true});
  await orderRow.getByRole('link',{name:'เปิดร่างต้นทาง',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้าร่างนี้แล้ว');await expect(page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true})).toHaveCount(0);
});

test('confirms a missing cost from the review inbox without changing the imported line',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
  const stamp=Date.now(),order=`REVIEW-E2E-${stamp}`,filename=`review-${stamp}.csv`;
  const csv=`order_id,sku,quantity,date,net_receipt\n${order},CH-L-NV-34,1,2026-09-16,500.00\n`;
  await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name:filename,mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText(order,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();await page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true}).click();
  await page.getByRole('link',{name:'ดูเงินรับและต้นทุน',exact:true}).click();
  const incomplete=page.getByRole('row').filter({hasText:order});await expect(incomplete).toContainText('ไม่ครบ');
  await page.getByRole('link',{name:'เปิดรายการที่ต้องตรวจ',exact:true}).click();await expect(page.getByRole('heading',{name:'รายการที่ต้องตรวจ',exact:true})).toBeVisible();
  const reviewCard=page.locator('.review-card').filter({hasText:order});await expect(reviewCard).toBeVisible();
  await reviewCard.getByLabel(`ต้นทุนต่อหน่วยของ ${order}`,{exact:true}).fill('200.00');await reviewCard.getByLabel(`เหตุผลของ ${order}`,{exact:true}).fill('ใบแจ้งต้นทุนเดือนกันยายน');
  await reviewCard.getByRole('button',{name:'ยืนยันต้นทุนรายการนี้',exact:true}).click();await expect(page.getByRole('status')).toContainText(`ยืนยันต้นทุนของคำสั่งซื้อ ${order} แล้ว`);await expect(page.locator('.review-card').filter({hasText:order})).toHaveCount(0);
  await page.getByRole('link',{name:'เงินรับและต้นทุน',exact:true}).click();const resolved=page.getByRole('row').filter({hasText:order});
  await expect(resolved).toContainText('฿200.00');await expect(resolved).toContainText('฿300.00');await expect(page.getByText(/ใช้ต้นทุนที่ผู้ใช้ยืนยันย้อนหลัง/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/cost-review-390.png',fullPage:true});
});
