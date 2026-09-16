# Refund และรายการปรับยอดแบบ append-only — v0.7

วันที่ตรวจรับ: 16 กันยายน 2026

## ปัญหาธุรกิจ

ยอดคืนเงินหรือเครดิตค่าธรรมเนียมอาจเกิดหลังไฟล์รายการขายเดิม หากแก้ยอดขายย้อนหลัง หลักฐาน ต้นทุน snapshot และผลที่เคยตรวจจะเปลี่ยนโดยไม่เห็นประวัติ รุ่นนี้จึงเพิ่มเหตุการณ์การเงินแยกจาก sales fact และนำผลมาคำนวณเฉพาะเมื่อจับคู่คำสั่งซื้อได้

## Flow ที่ใช้งานได้

เจ้าของหรือฝ่ายการเงินเปิด **คืนเงินและปรับยอด** แล้วบันทึก:

- ประเภท `refund` หรือ `fee rebate`
- วันที่เกิดเหตุการณ์
- `source_event_id` ที่คงที่และไม่ซ้ำต่อร้าน
- เลขคำสั่งซื้อ จำนวนเงิน และเหตุผล/หลักฐาน
- การยืนยันว่ายอดนี้ยังไม่รวมในเงินรับสุทธิจากไฟล์เดิม

ระบบแสดงจำนวน sales lines ที่จับคู่ได้ หากไม่พบคำสั่งซื้อจะเก็บเหตุการณ์เป็น unmatched และไม่รวมในยอดที่จับคู่แล้ว หน้า **เงินรับและต้นทุน** แสดงผลของเหตุการณ์ต่อแต่ละคำสั่งซื้อและยอดรวม โดยเปิดดูยอดขายเดิมควบคู่กัน

## กติกาการคำนวณ

- จำนวนเงินเก็บเป็นจำนวนเต็มสตางค์ สกุล THB
- ผู้ใช้กรอกจำนวนเป็นบวก แล้วชนิดเหตุการณ์กำหนดเครื่องหมาย
- `เงินรับหลังปรับยอด = เงินรับสุทธิเดิม − refund + fee rebate`
- `ส่วนต่างหลังปรับยอด = เงินรับหลังปรับยอด − ต้นทุนสินค้า`
- unmatched event ไม่รวมในตัวเลขข้างต้นและแสดงเป็นรายการรอตรวจสอบ
- หนึ่งคำสั่งซื้อมีหลาย sales lines และหลาย financial events ได้ เหตุการณ์ถูกบวก/หักครั้งเดียวต่อคำสั่งซื้อ ไม่คูณตามจำนวน lines
- การบันทึก `source_event_id` เดิมด้วยข้อมูลเดิมเป็น replay และไม่เพิ่มยอด หากข้อมูลต่างกันจะถูกปฏิเสธ

ตัวอย่าง synthetic: เงินรับเดิม 319 บาท ต้นทุน 180 บาท, refund 100 บาท และ fee rebate 10 บาท ให้เงินรับหลังปรับ 229 บาทและส่วนต่างหลังปรับ 49 บาท ตัวเลขนี้ยังไม่รวม affiliate, fulfillment, ค่าแอด และค่าใช้จ่ายบริษัท จึงไม่ใช่กำไรสุทธิ

## ความปลอดภัยและประวัติ

Migration `0008-financial-events.sql` เพิ่ม tenant/shop-aware keys, composite indexes, unique source identity, FORCE RLS และ append-only grants

- owner/finance อ่านและบันทึกได้
- auditor อ่านได้อย่างเดียว
- marketing/operator ไม่มีสิทธิ์อ่านข้อมูลนี้
- การบันทึกสร้าง audit event `financial_event.recorded`
- runtime role ไม่มี UPDATE/DELETE บน `financial_events`

## ผลตรวจ

- TypeScript, ESLint และ production build ผ่าน
- Integration tests **51/51** ผ่าน รวม partial refund, fee rebate, one order/multiple lines, unmatched, replay พร้อมกัน, source conflict, tenant/role isolation และ append-only history
- Browser tests **16/16** ผ่าน รวม flow มือถือจากนำเข้าคำสั่งซื้อ บันทึก refund 100 บาท แล้วเห็นเงินรับ 219 บาทและส่วนต่าง -31 บาท โดยยอดขายต้นทางยังเป็น 319 บาท
- ตรวจหน้าบันทึกปรับยอดที่ viewport 390 × 844 และ 1280 × 900 แล้ว ไม่พบ page-level horizontal overflow หรือ browser error ช่องกรอกและปุ่มหลักบนมือถือสูงอย่างน้อย 44 px

ระหว่างทดสอบกับฐานข้อมูลที่มี SKU มากกว่า 200 รายการ พบว่าหน้าสินค้าเดิมค้นหาเฉพาะข้อมูล 200 รายการแรก จึงแก้ให้ค้นหาชื่อสินค้าและ SKU ที่ฐานข้อมูลแบบ debounce/cancellable request พร้อม migration `0009-catalog-search-indexes.sql` ซึ่งเพิ่ม trigram indexes สำหรับการค้นหา โดยยังจำกัดผลลัพธ์ต่อคำขอเพื่อไม่ส่ง catalog ทั้งหมดเข้า browser

## ขอบเขตที่ยังไม่รับรอง

- ยังเป็นการกรอกเหตุการณ์ด้วยคน ไม่ใช่ TikTok/Shopee/Lazada adapter หรือ raw statement import
- ยังไม่มี reversing event สำหรับแก้รายการที่กรอกผิด จึงไม่เปิดแก้ไขหรือลบเหตุการณ์
- ยังไม่มี settlement statement, payout, bank reconciliation, cancellation, return-to-stock, affiliate, ads, FX หรือ VAT semantics
- การจับคู่ใช้ order ID ภายใน tenant/shop ยังไม่ใช้ payout reference หรือ allocation ระดับรายการสินค้า
- ต้องยืนยัน sign convention และคอลัมน์จากรายงานจริงที่ลดข้อมูลส่วนบุคคลแล้วก่อนใช้งาน production

ดังนั้น v0.7 เป็น financial-event vertical slice สำหรับทดสอบ workflow และ integrity ไม่ใช่บัญชีแยกประเภทหรือการรับรองยอดเงินเข้าธนาคาร
