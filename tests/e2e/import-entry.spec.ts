import { test,expect,type Page } from '@playwright/test';
import { demo } from '../../packages/domain/src/demo';
import { bangkokBusinessDate } from '../support/time';
const soldOn=bangkokBusinessDate();

async function start(page:Page,email='owner@chino.demo'){
 await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill(email);await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();
 await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();
 const tenant=page.getByLabel('เลือกบริษัท',{exact:true});if(await tenant.count()&&await tenant.inputValue()!==demo.tenants.chino){await tenant.selectOption(demo.tenants.chino);await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();}
 await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);await expect(page).toHaveURL(/\/catalog$/);await page.goto('/imports');
}
async function upload(page:Page,csv:string,name=`ux-import-${Date.now()}.csv`){await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(csv)});}
function sourceLink(page:Page){return page.getByRole('link',{name:'ดาวน์โหลดไฟล์ต้นฉบับ',exact:true});}

test('guides file choice, encoding recovery and a missing required column',async({page})=>{
 await start(page);await expect(page.getByRole('link',{name:'ไปนำเข้ารายการเงินโอน',exact:true})).toHaveAttribute('href','/settlements');
 await expect(page.locator('.import-file-settings')).not.toHaveAttribute('open','');
 await page.screenshot({path:'artifacts/import-entry-desktop.png',fullPage:true});
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'เลือกไฟล์จากเครื่อง',exact:true}).click();
 await (await picker).setFiles({name:'wrong-encoding.csv',mimeType:'text/csv',buffer:Buffer.from([0xff,0xfe,0xff])});
 await expect(page.locator('p.notice.error')).toContainText('CSV UTF-8');await expect(page.locator('p.notice.error')).toBeFocused();
 await page.locator('.import-file-settings summary').click();await page.getByLabel('ตัวคั่นคอลัมน์',{exact:true}).selectOption(';');
 await upload(page,`order_id;sku;quantity;date;amount\nUX-${Date.now()};CH-L-BK-32;1;${soldOn};319.00\n`);
 await expect(page.locator('[aria-current=step]')).toContainText('เลือกข้อมูลในไฟล์');
 await expect(page.getByText('ยังต้องเลือก:',{exact:false})).toContainText('เงินรับสุทธิ');
 await expect(page.getByRole('button',{name:'ตรวจรายการ',exact:true})).toBeDisabled();
 await page.getByLabel('คอลัมน์ เงินรับสุทธิต่อรายการ (บาท)',{exact:true}).selectOption('amount');
 await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText('฿319.00',{exact:true})).toBeVisible();
 await expect(page.locator('[aria-current=step]')).toContainText('ตรวจรายการ');
 await expect(page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true})).toHaveCount(0);
});

test('mobile review gives row remedies and blocks confirmation of an invalid saved draft',async({page})=>{
 await page.setViewportSize({width:320,height:844});await start(page);
 const stamp=Date.now();await upload(page,`order_id,sku,quantity,date,net_receipt\nVALID-${stamp},CH-L-BK-32,1,${soldOn},319.00\nINVALID-${stamp},UNKNOWN-SKU,0,2026-02-30,-1\n`);
 await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'เฉพาะรายการที่ต้องตรวจ',exact:true})).toBeChecked();
 await expect(page.locator('.import-preview tbody tr')).toHaveCount(1);
 await expect(page.locator('.import-issue-summary')).toContainText('ตรวจรหัสสินค้าและร้านที่เลือก');
 await expect(page.locator('.import-preview .issue-cell')).toContainText('ใช้ปี ค.ศ.-เดือน-วัน');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const orderCell=page.locator('.import-preview tbody td').nth(1);expect((await orderCell.boundingBox())!.width).toBeGreaterThan(220);
 await orderCell.scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/import-review-320.png'});
 await page.getByRole('checkbox',{name:'เฉพาะรายการที่ต้องตรวจ',exact:true}).uncheck();await expect(page.locator('.import-preview tbody tr')).toHaveCount(2);
 await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();
 await expect(page.locator('[aria-current=step]')).toContainText('ยืนยันนำเข้า');
 await expect(page.locator('.import-confirm')).toContainText('ยังยืนยันไม่ได้');
 await expect(page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/})).toBeDisabled();await expect(page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('editing a saved mapping requires a new draft and confirms only the newly reviewed amount',async({page})=>{
 await start(page);const stamp=Date.now();
 await upload(page,`order_id,source_line_id,sku,quantity,date,net_receipt,correct_receipt\nUX-BIND-${stamp},UX-LINE-${stamp},CH-L-BK-32,1,${soldOn},319.00,429.00\n`);
 await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();
 await expect(sourceLink(page)).toBeVisible();const oldLink=(await sourceLink(page).getAttribute('href'))!,oldId=oldLink.split('/').at(-2)!;
 await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();await page.getByRole('button',{name:'แก้การจับคู่คอลัมน์',exact:true}).click();
 await page.getByLabel('คอลัมน์ เงินรับสุทธิต่อรายการ (บาท)',{exact:true}).selectOption('correct_receipt');
 await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText('฿429.00',{exact:true})).toBeVisible();
 await expect(sourceLink(page)).toHaveCount(0);await expect(page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/})).toHaveCount(0);
 await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();await expect(sourceLink(page)).toBeVisible();
 const newId=(await sourceLink(page).getAttribute('href'))!.split('/').at(-2)!;expect(newId).not.toBe(oldId);
 await expect(page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/})).not.toBeChecked();await expect(page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();
 const commitRequest=page.waitForRequest(req=>req.url().endsWith('/imports')&&req.method()==='POST'&&req.postDataJSON()?.action==='commit');
 await page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true}).click();expect((await commitRequest).postDataJSON().input.draftId).toBe(newId);
 await expect(page.getByRole('status')).toContainText('นำเข้า 1 รายการแล้ว');
 await expect(page.getByRole('button',{name:'แก้การจับคู่คอลัมน์',exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'ดูเงินรับและต้นทุน',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:`UX-BIND-${stamp}`})).toContainText('฿429.00');
 await page.goto(`/imports?draft=${oldId}`);await expect(page.getByText('฿319.00',{exact:true})).toBeVisible();
});

test('auditor can inspect a saved draft and source but cannot confirm it',async({page,browser})=>{
 await start(page);await upload(page,`order_id,sku,quantity,date,net_receipt\nUX-READ-${Date.now()},CH-L-BK-32,1,${soldOn},319.00\n`);
 await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();await expect(sourceLink(page)).toBeVisible();
 const id=(await sourceLink(page).getAttribute('href'))!.split('/').at(-2)!;
 const context=await browser.newContext({baseURL:new URL(page.url()).origin}),auditor=await context.newPage();
 try{await start(auditor,'advisor@commerce.demo');await auditor.goto(`/imports?draft=${id}`);
 await expect(auditor.getByText('฿319.00',{exact:true})).toBeVisible();await expect(sourceLink(auditor)).toBeVisible();
 await expect(auditor.getByLabel('เลือกไฟล์ CSV',{exact:true})).toHaveCount(0);await expect(auditor.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true})).toHaveCount(0);
 }finally{await context.close();}
});
