import { createHmac,randomUUID } from 'node:crypto';
import { expect,test,type Page } from '@playwright/test';
import { Pool } from 'pg';
import { closePools,resolveContext } from '@commerce/db';
import { createServicePrincipal,ingestIncomingEvent,type IncomingEventInput } from '@commerce/integrations';
import { demo } from '../../packages/domain/src/demo';

const queue=new Pool({connectionString:process.env.QUEUE_DATABASE_URL});
const secret='browser-inbox-secret-that-is-long-enough';
let serviceCredential='';
test.beforeAll(async()=>{
  const owner=await resolveContext(demo.users.owner,demo.tenants.chino);
  serviceCredential=(await createServicePrincipal(owner,{name:`Browser inbox ${randomUUID()}`,shopIds:[demo.shops.tiktok],scopes:['integration:ingest'],expiresAt:new Date(Date.now()+3600_000).toISOString(),confirmed:true})).credential;
});
test.afterAll(async()=>Promise.all([queue.end(),closePools()]));
async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);
}
function input(provider:string,eventId:string,sequence:number,streamId:string,status='paid'):IncomingEventInput{
  const rawBody=JSON.stringify({orderId:streamId,status,customerEmail:'browser-private@example.test'});
  return {tenantId:demo.tenants.chino,shopId:demo.shops.tiktok,providerNamespace:provider,providerEventId:eventId,eventType:'order.status_changed',streamType:'order',streamId,sequenceNumber:sequence,occurredAt:new Date().toISOString(),rawBody,signature:`sha256=${createHmac('sha256',secret).update(rawBody).digest('hex')}`,verificationSecret:secret,serviceCredential,verificationMethod:'hmac-sha256-v1',verificationKeyReference:'browser-key-v1',metadata:{adapterVersion:'browser-synthetic-v1',contentType:'application/json'}};
}
async function gapFixture(){
  const stamp=randomUUID(),provider=`browser.orders.${stamp}`,stream=`BROWSER-${stamp}`;
  await ingestIncomingEvent(queue,input(provider,`event-10-${stamp}`,10,stream));
  const gap=await ingestIncomingEvent(queue,input(provider,`event-12-${stamp}`,12,stream,'shipped'));
  return {provider,stream,eventId:`event-12-${stamp}`,id:gap.id};
}

test('owner reviews safe evidence and confirms replay then closure',async({page})=>{
  const row=await gapFixture();await signIn(page);await page.goto('/integrations/inbox');await expect(page.getByRole('heading',{name:'Event Inbox'})).toBeVisible();
  await expect(page.getByText('Inbox นี้ไม่แก้ Order หรือ Inventory โดยอัตโนมัติ')).toBeVisible();
  const record=page.locator('.integration-event').filter({hasText:row.eventId});await expect(record).toContainText('ลำดับขาด');await expect(record).toContainText('รอดำเนินการ');
  await record.getByText('หลักฐานทางเทคนิคที่ปลอดภัย').click();await expect(record).toContainText('Body SHA-256');await expect(record).toContainText('customerEmail, orderId, status');
  await expect(page.getByText('browser-private@example.test')).toHaveCount(0);
  await record.getByRole('button',{name:'ขอประมวลผลอีกครั้ง'}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('เหตุผลในการจัดการ Event').fill('ตรวจลำดับจาก provider แล้ว ขอให้ processor ตรวจอีกครั้ง');await dialog.getByLabel(/ฉันตรวจหลักฐานและผลของคำสั่งแล้ว/).check();await dialog.getByRole('button',{name:'ขอประมวลผลอีกครั้ง'}).click();
  await expect(page.getByText('สร้างคำขอประมวลผลอีกครั้งแล้ว โดยยังไม่มีการเปลี่ยนข้อมูลธุรกิจ')).toBeVisible();const replayed=page.locator('.integration-event').filter({hasText:row.eventId});await expect(replayed).toContainText('ขอประมวลผลแล้ว');
  await replayed.getByRole('button',{name:'ปิดการติดตาม'}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('เหตุผลในการจัดการ Event').fill('ตรวจคำขอประมวลผลแล้วและปิดรายการทดสอบ');await dialog.getByLabel(/ฉันตรวจหลักฐานและผลของคำสั่งแล้ว/).check();await dialog.getByRole('button',{name:'ปิดการติดตาม'}).click();
  await expect(page.getByText('ปิดการติดตามพร้อมบันทึกเหตุผลแล้ว')).toBeVisible();await expect(page.locator('.integration-event').filter({hasText:row.eventId})).toContainText('ปิดการติดตาม');
});

test('mobile inbox contains controls and never offers replay for invalid signature',async({page})=>{
  await page.setViewportSize({width:390,height:844});const stamp=randomUUID(),provider=`browser.invalid.${stamp}`,eventId=`invalid-${stamp}`,payload=input(provider,eventId,1,`INVALID-${stamp}`);payload.signature=`sha256=${'0'.repeat(64)}`;await ingestIncomingEvent(queue,payload);
  await signIn(page);await page.goto('/integrations/inbox');const record=page.locator('.integration-event').filter({hasText:eventId});await expect(record).toContainText('ลายเซ็นไม่ผ่าน');await expect(record.getByRole('button',{name:'ขอประมวลผลอีกครั้ง'})).toHaveCount(0);await expect(record.getByRole('button',{name:'ปิดการติดตาม'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
