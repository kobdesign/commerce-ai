# ยืนยันรายการขายและส่วนต่างเบื้องต้น — v0.4

## Flow ที่ใช้งานได้

เปิด **นำเข้ารายงาน** ด้วย owner หรือ finance:

1. เลือก CSV UTF-8 สูงสุด 1 MB / 1,000 แถว
2. จับคู่ order ID, SKU, จำนวน, วันที่ขาย และเงินรับสุทธิต่อรายการ
3. เลือกคอลัมน์ค่าธรรมเนียมแพลตฟอร์มได้ แต่ไม่บังคับ
4. ตรวจแถวผิด, SKU ที่ไม่พบ, ต้นทุนที่ขาด และแถวที่เหมือนกัน
5. บันทึกร่างและยืนยันความหมายของเงินรับสุทธิ
6. ยืนยันนำเข้า แล้วเปิด **เงินรับและต้นทุน** เพื่อดูผลตาม SKU และคำสั่งซื้อ

ร่างที่มีแถวผิดหรือแถวเหมือนกันทั้งแถวจะยืนยันไม่ได้ การยืนยันร่างเดิมซ้ำหรือกดพร้อมกันสร้าง batch เดิม ไม่เพิ่มยอดซ้ำ รายการที่ยืนยันแล้วเป็น append-only ผ่าน runtime และมี audit event `import.batch.committed`

## ความหมายของตัวเลข

- เงินทุกจำนวนเก็บเป็นจำนวนเต็มสตางค์ สกุล THB
- `เงินรับสุทธิ` มาจากคอลัมน์ที่ผู้ใช้ตรวจและยืนยัน ระบบไม่ได้พิสูจน์ว่าเป็นเงินเข้าธนาคาร
- `ค่าธรรมเนียม` เป็นข้อมูลประกอบจากไฟล์ ไม่ถูกหักซ้ำ เพราะนิยามของเงินรับสุทธิต้องรวมผลของค่าธรรมเนียมนั้นแล้ว
- `ต้นทุนสินค้า` เป็น snapshot ของ cost version ล่าสุดที่มีผลก่อนสิ้นวันขายในเขตเวลา Asia/Bangkok
- `ส่วนต่างเบื้องต้น = เงินรับสุทธิ − ต้นทุนสินค้า`
- หากรายการใดไม่มีต้นทุน ระบบเก็บรายการขายไว้ แต่คืนส่วนต่างของ SKU/คำสั่งซื้อ/ยอดรวมเป็น null และแสดงว่า “ไม่ครบ” ไม่แทนด้วยศูนย์
- การแก้ต้นทุนสินค้าภายหลังไม่เปลี่ยน snapshot และผลของรายการที่ยืนยันแล้ว

คำว่า “ส่วนต่างเบื้องต้น” ใช้โดยตั้งใจ ตัวเลขนี้ยังไม่ใช่กำไรสุทธิและยังไม่หักค่าโฆษณา affiliate, fulfillment, เงินเดือน, น้ำมัน หรือค่าใช้จ่ายบริษัท

## ข้อมูลและสิทธิ์

Migration 0005 เพิ่ม `import_batches` และ `sales_lines` พร้อม tenant-aware foreign keys, FORCE RLS และ index สำหรับร้าน/วันที่, SKU/วันที่ และ order ID

- owner และ finance ตรวจไฟล์ บันทึกร่าง และยืนยันนำเข้าได้
- auditor อ่านร่างและหน้าเงินรับได้ แต่ยืนยันนำเข้าไม่ได้
- marketing และ operator ไม่อ่านข้อมูลเงินรับ ต้นทุน หรือส่วนต่างผ่าน UI, domain function หรือ direct SQL runtime
- API ตรวจ session, tenant membership, shop grant, Origin, JSON size และ input schema อีกครั้งทุก mutation
- `sales_lines` และ `import_batches` ไม่มี UPDATE/DELETE grant ให้ runtime role

หน้าสรุปอ่านโดยตรงใน Server Component ไม่เรียก API ผ่าน client ผลรวมคำนวณด้วย SQL จากข้อมูลที่ผ่าน RLS และลิงก์คำสั่งซื้อกลับไปยังร่างต้นทางได้เมื่อมาจาก batch เดียว

## ขอบเขตที่ยังไม่ทำ

- ยังเป็นสัญญาไฟล์กลาง ไม่ใช่ adapter ที่รับรอง schema จริงของ TikTok, Shopee หรือ Lazada ต้องใช้ไฟล์จริงที่ตัดข้อมูลส่วนบุคคลไม่จำเป็นออกเพื่อทำ contract tests
- ยังไม่เก็บ raw file; เก็บเฉพาะ hash, mapping และ mapped preview ผู้ใช้ต้องเก็บไฟล์ต้นฉบับเอง
- ป้องกันการนำเข้าซ้ำได้สำหรับร่าง/ไฟล์เดียวกัน แต่ไฟล์ที่ถูกแก้ byte หรือ mapping แล้วมี business rows เดิมอาจซ้ำได้ จนกว่าจะมี source event/line ID จากแพลตฟอร์ม
- ยังไม่มี correction/reversal, refund, fee rebate, affiliate, settlement/payout matching, bank reconciliation, ads allocation, FX หรือ VAT semantics
- วันที่ขายมีเพียงวัน ไม่มีเวลารายการ จึงเลือก cost version ล่าสุดภายในวันนั้น ไม่สามารถเรียงเหตุการณ์ภายในวันได้
- หน้าสรุปยังไม่มีช่วงวันที่/export; แสดงผลรวมทั้งหมด, 100 SKU และ 50 คำสั่งซื้อล่าสุด
- ไม่มีการเรียกโมเดล AI ใน flow การเงิน และยังไม่ให้ AI อธิบายตัวเลขนี้

## ผลตรวจ

- Typecheck, lint และ production build ผ่าน
- Integration 42 tests ผ่าน รวม exact minor units, multi-SKU order, partial fee coverage, negative contribution, cost version by sale date, cost snapshot, missing-cost null, duplicate commit concurrency, invalid/duplicate row blocking, tenant/role isolation และ append-only grants
- Browser 13 tests ผ่าน รวม flow มือถือ 390px ตั้งแต่อัปโหลด จับคู่ ยืนยัน ไปถึงส่วนต่าง 69 บาทจากเงินรับ 319 บาทและต้นทุน 250 บาท พร้อมเปิดร่างหลักฐานกลับมา
- ข้อมูล browser/integration เป็น synthetic ไม่ใช่รายงานร้านจริงและไม่รับรองความถูกต้องของ marketplace semantics

รัน `npm run db:migrate` ก่อนเปิดแอปรุ่นนี้ แล้วใช้ไฟล์ตัวอย่างที่ **นำเข้ารายงาน → ดาวน์โหลดไฟล์ตัวอย่าง**
