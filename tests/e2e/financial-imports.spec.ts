import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { demo } from '../../packages/domain/src/demo';
import { closePools,resolveContext } from '../../packages/db/src/index';
import { commitDraft,saveDraft } from '../../packages/imports/src/index';
const soldOn=new Date().toISOString().slice(0,10);
test.afterAll(closePools);

async function signIn(page:Page){
  await page.goto('/login');await page.getByLabel('อีเมล',{exact:true}).fill('owner@chino.demo');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(demo.password);await page.getByRole('button',{name:'เข้าสู่พื้นที่ทำงาน'}).click();await expect(page.getByRole('heading',{name:'ภาพรวม',exact:true})).toBeVisible();await page.getByLabel('เลือกร้านค้า',{exact:true}).selectOption(demo.shops.tiktok);
}
async function importedOrder(stamp:number,suffix:string){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),order=`ZZZ-${stamp}-${suffix}`;
  const csv=`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${order},SALE-${suffix}-${stamp},CH-L-BK-32,1,${soldOn},319.00,80.00\n`;
  const input={shopId:demo.shops.tiktok,filename:`sale-${suffix.toLowerCase()}-${stamp}.csv`,delimiter:',' as const,csv,mapping:{orderId:'order_id',sourceLineId:'source_line_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'}};
  const draft=await saveDraft(ctx,input);await commitDraft(ctx,{shopId:input.shopId,draftId:draft.id});return order;
}

test('confirms a reviewed CSV once and traces contribution back to its source draft',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
  const stamp=Date.now(),order=`ZZZ-${stamp}-FIN`,filename=`financial-${stamp}.csv`;
  const csv=`order_id,sku,quantity,date,net_receipt,platform_fee\n${order},CH-L-BK-32,1,${soldOn},319.00,80.00\n`;
  await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name:filename,mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(page.getByRole('heading',{name:'จับคู่คอลัมน์',exact:true})).toBeVisible();
  await expect(page.locator('details.import-history')).not.toHaveAttribute('open','');
  await expect(page.getByLabel('คอลัมน์ เงินรับสุทธิต่อรายการ (บาท)',{exact:true})).toHaveValue('net_receipt');
  await expect(page.getByLabel('คอลัมน์ ค่าธรรมเนียมแพลตฟอร์ม (บาท) · ไม่บังคับ',{exact:true})).toHaveValue('platform_fee');
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText(order,{exact:true})).toBeVisible();
  await expect(page.getByText('฿319.00',{exact:true})).toBeVisible();await expect(page.getByText('฿80.00',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกร่างแล้ว');
  await expect(page.getByLabel('หลักฐานไฟล์ต้นฉบับ')).toContainText('เก็บไฟล์ต้นฉบับแล้ว');await expect(page.getByLabel('หลักฐานไฟล์ต้นฉบับ')).toContainText('รูปแบบรายการขาย v1');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'ดาวน์โหลดไฟล์ต้นฉบับ',exact:true}).click();const download=await downloadPromise,downloadPath=await download.path();expect(download.suggestedFilename()).toBe(filename);expect(downloadPath).not.toBeNull();expect(await readFile(downloadPath!,'utf8')).toBe(csv);
  await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();await page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้า 1 รายการแล้ว');
  await page.getByRole('link',{name:'ดูเงินรับและต้นทุน',exact:true}).click();await expect(page.getByRole('heading',{name:'เงินรับและต้นทุน',exact:true})).toBeVisible();
  const orderRow=page.getByRole('row').filter({hasText:order});await expect(orderRow).toContainText('฿319.00');await expect(orderRow).toContainText('฿80.00');await expect(orderRow).toContainText('฿250.00');await expect(orderRow).toContainText('฿69.00');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/financial-summary-390.png',fullPage:true});
  await orderRow.getByRole('link',{name:'เปิดร่างต้นทาง',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้าร่างนี้แล้ว');await expect(page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true})).toHaveCount(0);
});

test('maps a source line ID and blocks the same marketplace line in a later file',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
  const stamp=Date.now(),sourceLineId=`SOURCE-E2E-${stamp}`;
  const csv=(order:string)=>`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${order},${sourceLineId},CH-L-BK-32,1,${soldOn},319.00,80.00\n`;
  await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name:`source-first-${stamp}.csv`,mimeType:'text/csv',buffer:Buffer.from(csv(`SOURCE-ORDER-A-${stamp}`))});
  await expect(page.getByLabel('คอลัมน์ รหัสรายการต้นทาง · แนะนำ',{exact:true})).toHaveValue('source_line_id');
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText(`ต้นทาง ${sourceLineId}`,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();await page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้า 1 รายการแล้ว');

  await page.getByRole('button',{name:'เลือกไฟล์ใหม่',exact:true}).click();
  await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name:`source-second-${stamp}.csv`,mimeType:'text/csv',buffer:Buffer.from(csv(`SOURCE-ORDER-B-${stamp}`))});
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();
  const issueSummary=page.locator('.import-issue-summary');
  await expect(issueSummary).toContainText('รายการต้นทางนี้ถูกนำเข้าในร้านนี้แล้ว');
  await expect(issueSummary).toContainText('เลือกไฟล์ใหม่');
  await expect(page.locator('.import-summary>div').filter({hasText:'ต้องแก้ไข'}).locator('strong')).toContainText('1');
});

test('records and reverses a partial refund without rewriting the sale',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
  const stamp=Date.now(),order=`ZZZ-${stamp}-REFUND`,sourceEventId=`REFUND-EVENT-${stamp}`;
  const csv=`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${order},REFUND-LINE-${stamp},CH-L-BK-32,1,${soldOn},319.00,80.00\n`;
  await page.getByLabel('เลือกไฟล์ CSV',{exact:true}).setInputFiles({name:`refund-${stamp}.csv`,mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await page.getByRole('button',{name:'บันทึกร่างเพื่อตรวจ',exact:true}).click();
  await page.getByRole('checkbox',{name:/ฉันตรวจแล้ว/}).check();await page.getByRole('button',{name:'ยืนยันนำเข้าข้อมูล',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้า 1 รายการแล้ว');
  await page.getByRole('link',{name:'คืนเงินและปรับยอด',exact:true}).click();await expect(page.getByRole('heading',{name:'คืนเงินและปรับยอด',exact:true})).toBeVisible();
  await page.getByLabel('รหัสรายการต้นทาง',{exact:true}).fill(sourceEventId);await page.getByLabel('เลขคำสั่งซื้อ',{exact:true}).fill(order);await page.getByLabel('จำนวนเงิน (บาท)',{exact:true}).fill('100.00');
  await page.getByLabel('เหตุผลหรือหลักฐาน',{exact:true}).fill('คืนเงินบางส่วน ลูกค้ายังเก็บสินค้า');await page.getByRole('checkbox',{name:/ยอดนี้ยังไม่รวมอยู่ในเงินรับสุทธิ/}).check();
  await page.getByRole('button',{name:'บันทึกรายการปรับยอด',exact:true}).click();await expect(page.getByRole('status')).toContainText(`จับคู่กับคำสั่งซื้อ ${order} จำนวน 1 รายการ`);
  const eventCard=page.locator('.adjustment-card').filter({hasText:sourceEventId});await expect(eventCard).toBeVisible();await expect(eventCard).toContainText('-฿100.00');await expect(eventCard).toContainText('จับคู่ 1 รายการ');
  await page.getByRole('link',{name:/ดูผลต่อเงินรับ/}).click();const orderRow=page.getByRole('row').filter({hasText:order});
  await expect(orderRow).toContainText('฿319.00');await expect(orderRow).toContainText('-฿100.00');await expect(orderRow).toContainText('฿219.00');await expect(orderRow).toContainText('-฿31.00');
  await page.getByRole('navigation').getByRole('link',{name:'คืนเงินและปรับยอด',exact:true}).click();const originalCard=page.locator('.adjustment-card').filter({hasText:sourceEventId}),reversalButton=originalCard.getByRole('button',{name:'แก้กลับรายการ',exact:true});
  await expect(reversalButton).toBeVisible();expect(await reversalButton.evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);await reversalButton.click();
  await expect(page.getByText('ระบบจะสร้างรหัสรายการแก้กลับให้อัตโนมัติและผูกกับรายการเดิม',{exact:true})).toBeVisible();await expect(page.getByLabel('รหัสรายการแก้กลับ',{exact:true})).toHaveCount(0);
  await page.getByLabel('เหตุผลที่แก้กลับ',{exact:true}).fill('ทดสอบแก้กลับรายการที่บันทึกซ้ำ');await page.getByRole('checkbox',{name:/ยกเลิกผลของรายการนี้/}).check();
  await page.getByRole('button',{name:'ยืนยันการแก้กลับ',exact:true}).click();await expect(page.getByRole('status')).toContainText(`แก้กลับรายการ ${sourceEventId} แล้ว`);
  const reversalCard=page.locator('.adjustment-card').filter({hasText:order}).filter({hasText:'รายการแก้กลับ'});await expect(reversalCard).toContainText('+฿100.00');await expect(reversalCard.locator('.adjustment-card-reference')).toHaveText(/^REV-[0-9a-f-]{36}$/);await expect(originalCard).toContainText('ถูกแก้กลับแล้ว');
  await page.getByRole('link',{name:/ดูผลต่อเงินรับ/}).click();const restoredRow=page.getByRole('row').filter({hasText:order}),cells=restoredRow.getByRole('cell');await expect(cells.nth(5)).toContainText('+฿0.00');await expect(cells.nth(6)).toHaveText('฿319.00');await expect(cells.nth(8)).toHaveText('฿69.00');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/financial-refund-390.png',fullPage:true});
});

test('records and reverses an allocated shop expense and shows its effect separately from contribution',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);
  const stamp=Date.now(),reference=`AD-STATEMENT-${stamp}`;
  await page.getByRole('link',{name:'ค่าใช้จ่ายร้าน',exact:true}).click();await expect(page.getByRole('heading',{name:'ค่าใช้จ่ายร้าน',exact:true})).toBeVisible();
  await expect(page.locator('.financial-event-entry select').first()).toHaveValue('advertising');await page.getByLabel('จำนวนเงินค่าใช้จ่าย (บาท)',{exact:true}).fill('250.00');await page.getByLabel('เอกสารอ้างอิงค่าใช้จ่าย',{exact:true}).fill(reference);
  await page.getByLabel('ขอบเขตค่าใช้จ่าย',{exact:true}).selectOption('shared_allocated');await page.getByLabel('วิธีแบ่งค่าใช้จ่ายส่วนกลาง',{exact:true}).fill('แบ่ง 40% ตามสัดส่วนยอดขายของร้าน');
  await page.getByLabel('รายละเอียดค่าใช้จ่าย',{exact:true}).fill('ค่าโฆษณา TikTok รอบวันที่ 1–15 ก.ย.');await page.getByRole('checkbox',{name:/ยอดนี้จ่ายแยกและยังไม่รวมอยู่ในเงินรับสุทธิ/}).check();
  await page.getByRole('button',{name:'บันทึกค่าใช้จ่าย',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึกค่าใช้จ่ายแล้ว');
  const expenseCard=page.locator('.adjustment-card').filter({hasText:reference});await expect(expenseCard).toBeVisible();await expect(expenseCard).toContainText('-฿250.00');await expect(expenseCard).toContainText('แบ่งจากส่วนกลาง');await expect(expenseCard).toContainText('แบ่ง 40% ตามสัดส่วนยอดขายของร้าน');
  await page.getByRole('link',{name:'ดูเงินรับและต้นทุน',exact:true}).click();const impact=page.locator('.expense-impact-summary');await expect(impact).toContainText('ค่าโฆษณา');await expect(impact).toContainText('฿250.00');await expect(impact).toContainText('เงินเหลือหลังค่าใช้จ่ายที่บันทึก');
  await page.getByRole('navigation').getByRole('link',{name:'ค่าใช้จ่ายร้าน',exact:true}).click();await expenseCard.getByRole('button',{name:'แก้กลับรายการ',exact:true}).click();
  const reversalReason=`แก้กลับเอกสาร ${reference} ที่บันทึกซ้ำ`;await expect(page.getByText('ระบบจะสร้างรหัสรายการแก้กลับและผูกกับรายการเดิมให้อัตโนมัติ',{exact:true})).toBeVisible();await page.getByLabel('เหตุผลที่แก้กลับ',{exact:true}).fill(reversalReason);await page.getByRole('checkbox',{name:/ยกเลิกผลของรายการนี้/}).check();
  await page.getByRole('button',{name:'ยืนยันการแก้กลับ',exact:true}).click();await expect(page.getByRole('status')).toContainText('แก้กลับ ค่าโฆษณา แล้ว');
  await expect(page.locator('.adjustment-card').filter({hasText:reference}).filter({hasText:'ถูกแก้กลับแล้ว'}).first()).toBeVisible();await expect(page.locator('.adjustment-card').filter({hasText:'รายการแก้กลับ'}).filter({hasText:reversalReason}).first()).toContainText('+฿250.00');
  await expect(page.getByText('฿0.00',{exact:true}).first()).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/shop-expenses-390.png',fullPage:true});
});

test('reconciles a marketplace payout with an imported order on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:900});const stamp=Date.now(),order=await importedOrder(stamp,'SETTLEMENT'),payout=`PAYOUT-${stamp}`,payoutLine=`PAYOUT-LINE-${stamp}`;
  await signIn(page);await page.getByRole('link',{name:'กระทบยอดเงินโอน',exact:true}).click();await expect(page.getByRole('heading',{name:'กระทบยอดเงินโอน',exact:true})).toBeVisible();
  await page.getByLabel('รหัสรอบโอน',{exact:true}).fill(payout);await page.getByLabel('ยอดโอนรวมตามรายงาน (บาท)',{exact:true}).fill('319.00');
  await page.getByLabel('รหัสบรรทัดต้นทาง',{exact:true}).fill(payoutLine);await page.getByLabel('เลขคำสั่งซื้อสำหรับกระทบยอด',{exact:true}).fill(order);
  await page.getByLabel('ยอดที่จัดสรรให้คำสั่งซื้อนี้ (บาท)',{exact:true}).fill('319.00');await page.getByLabel('หลักฐานหรือหมายเหตุการโอน',{exact:true}).fill('Statement TikTok รอบทดสอบ');
  await page.getByRole('checkbox',{name:/มาจาก statement เดียวกัน/}).check();await page.getByRole('button',{name:'บันทึกบรรทัดเงินโอน',exact:true}).click();await expect(page.getByRole('status')).toContainText(`บันทึกแล้วและพบคำสั่งซื้อ ${order}`);

  const payoutTable=page.getByRole('heading',{name:'รอบโอน',exact:true}).locator('xpath=ancestor::section');const payoutRow=payoutTable.getByRole('row').filter({hasText:payout});
  await expect(payoutRow).toContainText('฿319.00');await expect(payoutRow).toContainText('+฿0.00');await expect(payoutRow).toContainText('กระทบครบ');
  const orderTable=page.getByRole('heading',{name:'เทียบตามคำสั่งซื้อ',exact:true}).locator('xpath=ancestor::section');const orderRow=orderTable.getByRole('row').filter({hasText:order});
  await expect(orderRow).toContainText('฿319.00');await expect(orderRow).toContainText('+฿0.00');await expect(orderRow).toContainText('ตรงกัน');
  const evidence=page.locator('.settlement-card').filter({hasText:payoutLine});await expect(evidence).toContainText(order);await expect(evidence).toContainText('พบคำสั่งซื้อ');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/settlement-reconciliation-390.png',fullPage:true});
});

test('imports a settlement CSV with mapping, preview and immutable source evidence',async({page})=>{
  await page.setViewportSize({width:390,height:900});const stamp=Date.now(),order=await importedOrder(stamp,'SETTLEMENT-CSV'),payout=`PAYOUT-CSV-${stamp}`,payoutLine=`PAYOUT-CSV-LINE-${stamp}`;
  await signIn(page);await page.getByRole('link',{name:'กระทบยอดเงินโอน',exact:true}).click();await page.getByText('นำเข้า statement จาก CSV',{exact:true}).click();
  const statementCsv=`payout_reference,settled_on,payout_total,source_line_id,order_id,allocation_amount,note\n${payout},${soldOn},319.00,${payoutLine},${order},319.00,Statement CSV ทดสอบ\n`;
  await page.getByLabel('เลือกไฟล์ statement CSV',{exact:true}).setInputFiles({name:`statement-${stamp}.csv`,mimeType:'text/csv',buffer:Buffer.from(statementCsv)});
  await expect(page.getByRole('heading',{name:'จับคู่คอลัมน์',exact:true})).toBeVisible();await expect(page.getByLabel('คอลัมน์ รหัสรอบโอน',{exact:true})).toHaveValue('payout_reference');
  await page.getByRole('button',{name:'ตรวจรายการ',exact:true}).click();await expect(page.getByText(order,{exact:true}).first()).toBeVisible();await expect(page.getByText('พร้อมนำเข้า',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:/มาจาก statement นี้/}).check();await page.getByRole('button',{name:'ยืนยันนำเข้า statement',exact:true}).click();await expect(page.getByRole('status')).toContainText('นำเข้า 1 บรรทัด จาก 1 รอบโอนแล้ว');
  const payoutTable=page.getByRole('heading',{name:'รอบโอน',exact:true}).locator('xpath=ancestor::section');await expect(payoutTable.getByRole('row').filter({hasText:payout})).toContainText('กระทบครบ');
  const downloadPromise=page.waitForEvent('download');await page.getByLabel(`ดาวน์โหลดไฟล์ต้นฉบับ statement-${stamp}.csv`,{exact:true}).click();const download=await downloadPromise,downloadPath=await download.path();expect(downloadPath).not.toBeNull();expect(await readFile(downloadPath!,'utf8')).toBe(statementCsv);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/settlement-csv-import-390.png',fullPage:true});
});

test('confirms a missing cost from the review inbox without changing the imported line',async({page})=>{
  await page.setViewportSize({width:390,height:900});await signIn(page);await page.getByRole('link',{name:'นำเข้ารายงาน',exact:true}).click();
  const stamp=Date.now(),order=`ZZZ-${stamp}-REVIEW`,filename=`review-${stamp}.csv`;
  const csv=`order_id,sku,quantity,date,net_receipt\n${order},CH-L-NV-34,1,${soldOn},500.00\n`;
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
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/cost-review-390.png',fullPage:true});
});
