import { openShopPage } from './helpers/navigation';
import { randomUUID } from 'node:crypto';
import { expect,test,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';

async function signIn(page:Page,email:string){
  await page.goto('/login');
  await page.getByLabel('อีเมล',{exact:true}).fill(email);
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);
  await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
  await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();
}

test('owner creates, rotates with overlap and revokes a scoped credential',async({page})=>{
  const name=`Browser connector ${randomUUID().slice(0,8)}`;
  await signIn(page,'owner@chino.demo');
  await openShopPage(page,'สิทธิ์ระบบเชื่อมต่อ');
  await expect(page.getByRole('heading',{name:'Service Access',exact:true})).toBeVisible();
  await expect(page.getByText('Credential ไม่ใช่บัญชีผู้ใช้และไม่ใช้สิทธิ์ของ owner แทน')).toBeVisible();

  await page.getByLabel('ชื่อการใช้งาน').fill(name);
  await page.getByRole('combobox',{name:'Environment',exact:true}).selectOption('staging');
  await page.getByRole('textbox',{name:/^Audience/}).fill('browser-orders');
  await page.getByLabel(/ฉันตรวจร้าน Scope, Environment, Audience/).check();
  const expiry=page.locator('input[type="datetime-local"]');
  await expiry.fill('');
  await page.getByRole('button',{name:'สร้าง credential',exact:true}).click();
  await expect(page.getByText('กรอกชื่อ ร้าน Scope, Environment, Audience และวันหมดอายุให้ครบ',{exact:true})).toBeVisible();
  await expiry.fill(new Date(Date.now()+30*86400000).toISOString().slice(0,16));
  await page.getByRole('button',{name:'สร้าง credential',exact:true}).click();

  let created=page.getByRole('dialog',{name:'บันทึก credential ใหม่ตอนนี้'});
  const secret=(await created.locator('.credential-secret').textContent())!;
  expect(secret).toMatch(/^svc_[A-Za-z0-9_-]{40,}$/);
  await created.getByRole('button',{name:'ฉันบันทึกไว้แล้ว'}).click();

  let record=page.locator('.service-record').filter({hasText:name});
  await expect(record).toContainText('ใช้งานอยู่');
  await expect(record).toContainText('Staging');await expect(record).toContainText('browser-orders');
  await expect(record).not.toContainText(secret);
  await record.getByRole('button',{name:'หมุน credential'}).click();
  const rotate=page.getByRole('dialog',{name:`หมุน credential ของ ${name}`});
  await rotate.getByRole('combobox',{name:/^ช่วงทับซ้อน/}).selectOption('30');
  await rotate.getByLabel('เหตุผล จำเป็น').fill('หมุน Secret เพื่อทดสอบ browser flow แบบไม่หยุด connector');
  await rotate.getByLabel(/ฉันเตรียมเปลี่ยน Secret ใน connector/).check();
  await rotate.getByRole('button',{name:'สร้าง Secret ใหม่'}).click();
  created=page.getByRole('dialog',{name:'บันทึก credential ใหม่ตอนนี้'});
  const rotatedSecret=(await created.locator('.credential-secret').textContent())!;
  expect(rotatedSecret).toMatch(/^svc_[A-Za-z0-9_-]{40,}$/);expect(rotatedSecret).not.toBe(secret);
  await expect(created).toContainText('Secret เดิมหยุดทำงาน');
  await created.getByRole('button',{name:'ฉันบันทึกไว้แล้ว'}).click();
  await expect(page.getByRole('status')).toContainText('ชุดเดิมยังใช้ได้จนสิ้นสุดช่วงทับซ้อน');
  record=page.locator('.service-record').filter({hasText:name});
  await record.getByText('Credential และการใช้งาน').click();
  await expect(record).toContainText('2 ชุด');await expect(record).toContainText('กำลังเปลี่ยน');
  await expect(record).not.toContainText(rotatedSecret);
  await record.getByRole('button',{name:'เพิกถอนสิทธิ์'}).click();
  const revoke=page.getByRole('dialog',{name:`เพิกถอน ${name}`});
  await revoke.getByLabel('เหตุผล จำเป็น').fill('จบการทดสอบ browser และหยุด credential ชุดนี้');
  await revoke.getByLabel('ฉันยืนยันให้หยุด credential และ delegation ทั้งหมด').check();
  await revoke.getByRole('button',{name:'ยืนยันเพิกถอน'}).click();

  await expect(page.getByRole('status')).toContainText(`เพิกถอน ${name} แล้ว`);
  await expect(page.locator('.service-record').filter({hasText:name})).toContainText('เพิกถอนแล้ว');
});

test('auditor receives a mobile read-only view without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page,'advisor@commerce.demo');
  await openShopPage(page,'สิทธิ์ระบบเชื่อมต่อ');
  await expect(page.getByRole('heading',{name:'Service Access',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'สร้าง Service Principal'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'เพิกถอนสิทธิ์'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'หมุน credential'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Service Principals',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
