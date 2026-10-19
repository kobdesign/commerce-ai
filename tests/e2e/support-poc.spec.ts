import { openShopPage } from './helpers/navigation';
import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';

async function signIn(page:Page){
  await page.goto('/login');
  await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);
  await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
  await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();
}

test('runs the consent-bound view-only support simulation without exposing classified values',async({page})=>{
  await signIn(page);await openShopPage(page,'ทดลองหน้าจอช่วยเหลือ');
  await expect(page.getByRole('heading',{name:'พื้นที่ทดสอบ Co-browsing',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'ขอความช่วยเหลือ',exact:true}).click();
  const consent=page.getByRole('dialog',{name:'อนุญาตให้เจ้าหน้าที่ดูหน้านี้หรือไม่'});
  await expect(consent).toContainText('ไม่สามารถกดปุ่ม พิมพ์ข้อมูล หรือส่งรายการแทนคุณ');
  await consent.getByRole('button',{name:'ยินยอมและสร้างรหัส',exact:true}).click();
  const code=(await page.getByLabel('รหัส Co-browsing').textContent())!;expect(code).toMatch(/^\d{6}$/);
  const claim=page.getByLabel('รหัส Session สำหรับเจ้าหน้าที่');
  await claim.fill('000000');await page.getByRole('button',{name:'เชื่อมต่อแบบจำลอง'}).click();await expect(page.getByText('รหัสไม่ถูกต้อง หรือ session นี้ไม่พร้อมให้เชื่อมต่อ',{exact:true})).toBeVisible();
  await claim.fill(code);await page.getByRole('button',{name:'เชื่อมต่อแบบจำลอง'}).click();
  const preview=page.getByLabel('ภาพที่เจ้าหน้าที่เห็น');await expect(preview).toContainText('เชื่อมต่อแล้ว');await expect(preview).toContainText('View-only enforcement');
  for(const value of ['ลูกค้าทดสอบ ก.','synthetic.customer@example.test','4455','statement-synthetic-sep.csv','sk_test_SYNTHETIC_ONLY','842913'])await expect(preview).not.toContainText(value);
  await page.getByLabel('หัวข้อที่ต้องการความช่วยเหลือ').fill('ทดสอบภาษาไทยผ่าน IME');await expect(preview).toContainText('ทดสอบภาษาไทยผ่าน IME');
  await page.getByRole('button',{name:'เปิดฟอร์ม Dynamic'}).click();await expect(preview).toContainText('Dynamic layer');await expect(preview).not.toContainText('080-000-0000');
  await page.getByRole('dialog',{name:'รายละเอียดปัญหาแบบ Dynamic'}).getByRole('button',{name:'ปิดฟอร์มทดสอบ'}).click();
  await page.getByRole('button',{name:'หยุดแชร์'}).click();await expect(page.getByRole('status')).toContainText('จบการแชร์แล้ว');await expect(preview).toHaveCount(0);
});

test('keeps the support PoC usable without horizontal overflow on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);await page.goto('/support/poc');
  await expect(page.getByRole('heading',{name:'พื้นที่ทดสอบ Co-browsing',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'ขอความช่วยเหลือ'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
