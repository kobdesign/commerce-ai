import {expect,test} from '@playwright/test';

test('platform owner configures tenant AI without deployment allowlists',async({page})=>{
  await page.goto('/login');
  await page.getByLabel('อีเมล').fill('owner@chino.demo');
  await page.getByLabel('รหัสผ่าน').fill('StudioDemo!2026');
  await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
  await page.getByText('ตั้งค่าและเครื่องมือเพิ่มเติม',{exact:true}).click();
  await page.getByRole('link',{name:'ควบคุม AI รายบริษัท'}).click();
  await expect(page.locator('h1')).toHaveText('AI Control Center');
  await expect(page.locator('.service-security-label')).toHaveText(/Platform Owner/);

  const tenant=page.locator('.platform-ai-tenant').filter({hasText:'Everyday Goods'});
  await tenant.getByRole('button',{name:'เปิด AI'}).click();
  await page.getByLabel('เปิดถึงเวลา').fill(new Date(Date.now()+4*3600_000-new Date().getTimezoneOffset()*60_000).toISOString().slice(0,16));
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'ยืนยันเปิด AI'}).click();
  await expect(tenant.getByText('เปิดใช้งาน',{exact:true})).toBeVisible();

  await tenant.getByRole('button',{name:'ปิด AI'}).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'ยืนยันปิด AI'}).click();
  await expect(tenant.getByText('ปิดใช้งาน',{exact:true})).toBeVisible();
});
