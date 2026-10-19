# Secure Statement Sample Intake — v1.11

สถานะ ณ 23 กันยายน 2026: **เครื่องมือและ automated contract พร้อม; DATA-AG-01 ยังรอ export จริงที่ปกปิดแล้วและ finance sign-off**

## ปัญหาที่แก้

การส่งไฟล์ Seller Center ผ่านแชต issue หรือ repository เสี่ยงเปิดเผยชื่อลูกค้า ที่อยู่ เบอร์โทร อีเมล และรหัสที่ย้อนกลับไปหาธุรกรรมจริงได้ งานนี้เพิ่มกระบวนการ local-only ที่เก็บหัวคอลัมน์ วันที่ เครื่องหมาย และจำนวนเงินสำหรับตรวจ adapter แต่แทน order/transaction/payout IDs ด้วย HMAC pseudonym แบบคงที่ และแทนค่าคอลัมน์อื่นด้วย `[REDACTED]`

ไฟล์ต้นฉบับไม่ถูกเขียนเข้า report และเครื่องมือไม่พิมพ์ค่า cell, secret หรือ original identifier ลง log Output แนะนำให้อยู่ใน `private-data/` ซึ่ง Git ignore ทั้งโฟลเดอร์ รวมทั้งไฟล์ `*.review.local.json` และ `*.acceptance.local.json`

## วิธีเตรียม CSV

1. ดาวน์โหลด Statement จาก Seller Center มาไว้ในพื้นที่ส่วนตัวของเครื่อง ห้ามวางใน repository
2. ตั้ง `DATA_REDACTION_KEY` แบบสุ่มอย่างน้อย 32 ตัวอักษรไว้ใน `.env` local เท่านั้น ใช้ key เดียวกันเมื่ออยากให้รหัสเดียวกันจับคู่ข้ามไฟล์ได้
3. รันคำสั่งตาม platform:

```bash
npm run data:prepare-statement -- \
  --input /path/private/original.csv \
  --output private-data/tiktok-redacted.csv \
  --platform tiktok-shop-th
```

ค่า platform ที่รองรับคือ `tiktok-shop-th`, `shopee-th` และ `lazada-th` หากไฟล์ใช้ semicolon หรือ tab ให้เพิ่ม `--delimiter ';'` หรือ `--delimiter tab`

ผลลัพธ์มี CSV ที่ปกปิดแล้วและ report ข้างไฟล์ Report มีเฉพาะ checksum, adapter/schema, จำนวนแถว/รอบโอน, สัดส่วน reported/derived total, เครื่องหมาย, warning/error และข้อจำกัด ไม่มีรหัสธุรกรรมหรือค่าข้อมูลส่วนตัว

เครื่องมือเตรียมไฟล์รองรับ CSV เท่านั้น สำหรับ XLSX ให้บันทึกเป็น CSV ใน secure workspace ก่อน หรือปกปิด workbook ภายนอกแล้วใช้คำสั่ง verify กับ `.xlsx` การแปลง XLSX เป็น CSV ยังไม่ยืนยันพฤติกรรมหลายชีต สูตร หรือรูปแบบเฉพาะ workbook

## Finance sign-off

คัดลอก [acceptance template](../fixtures/statement-acceptance.template.json) ไปเป็นไฟล์ `*.acceptance.local.json` แล้วให้ผู้ใช้การเงินกรอก:

- เวลา export และ timezone ของ Seller Center
- จำนวนแถว จำนวนรอบโอน ยอด allocation รวม และยอด payout รวมที่เทียบมือแล้ว
- ความหมายหัวคอลัมน์ วันที่ เครื่องหมาย รหัส identity และยอดรวม
- ผู้ตรวจ เวลา หมายเหตุ และ decision

จากนั้นยืนยันว่า sign-off ผูกกับไฟล์ที่ตรวจจริง:

```bash
npm run data:verify-statement -- \
  --sample private-data/tiktok-redacted.csv \
  --acceptance private-data/tiktok.acceptance.local.json \
  --platform tiktok-shop-th
```

คำสั่งผ่านเมื่อไฟล์ไม่มี finding, adapter/schema ตรง, checksum ตรง, golden counts/totals ตรง และผู้ตรวจเลือก `accepted` หลังผ่านทุกหัวข้อ การเปลี่ยนไฟล์แม้หนึ่ง byte ทำให้ checksum check ไม่ผ่าน

## หลักฐาน automated

- ไฟล์ที่ยังมีชื่อ เบอร์โทร อีเมล หรือ raw transaction IDs ถูก block โดย report ไม่สะท้อนค่าดิบกลับ
- pseudonym เดิมคงที่เมื่อใช้ key เดิม; key สั้นกว่า 32 ตัวอักษรถูกปฏิเสธ
- วันที่ จำนวนเงิน เครื่องหมาย หัวคอลัมน์ และจำนวนแถวคงอยู่ ส่วน preamble/unknown columns ถูก redact และ note เหลือเฉพาะ class ที่จำเป็น
- TikTok, Shopee และ Lazada ยังตรวจจับ adapter ได้หลัง redaction
- finance acceptance ที่ hash หรือยอดไม่ตรงไม่ผ่าน แม้ decision ระบุ accepted
- 8 intake tests ผ่านภายใน integration/regression รวม 105 tests

## ข้อจำกัดและเกณฑ์ปิด DATA-AG-01

เครื่องมือไม่สามารถรับรองเองว่า export ครบ หรือยอด/ความหมายตรงกับ Seller Center ผู้ใช้การเงินจริงต้องตรวจอย่างน้อยหนึ่ง sample ต่อ platform/schema version รวมกรณี refund, adjustment, หลาย payout และรหัสที่ขาด หากไฟล์มีรายการติดลบหรือประเภทค่าธรรมเนียมใน flow เงินรับปัจจุบัน report จะ block เพื่อให้แยกเข้ากระบวนการที่ถูกต้อง แทนการเปลี่ยนความหมายเงียบ ๆ

DATA-AG-01 จะเปลี่ยนเป็น Complete เฉพาะ platform/version ที่มี sanitized fixture, verification ผ่าน และ finance sign-off จริงเท่านั้น แต่ละ platform รับรองแยกกัน ไม่ใช้ผล TikTok รับรอง Shopee/Lazada
