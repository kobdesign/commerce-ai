# ตัวอ่าน Statement แยกตามแพลตฟอร์ม — v1.5

วันที่ตรวจ: 17 กันยายน 2026

## ผลลัพธ์

หน้า **กระทบยอดเงินโอน** รับไฟล์ CSV และ XLSX แล้วตรวจจับ TikTok Shop, Shopee หรือ Lazada จากชุดหัวคอลัมน์ที่มีลักษณะเฉพาะ เมื่อพบรูปแบบที่มั่นใจ ระบบจะเลือก adapter แบบมีเวอร์ชัน แปลงข้อมูลเข้าสัญญากลาง และเปิดหน้า preview โดยไม่ให้ผู้ใช้จับคู่คอลัมน์เอง

หาก CSV ไม่ตรงกับ adapter ระบบจะใช้ flow จับคู่คอลัมน์เดิม หาก XLSX ไม่ตรง ระบบจะหยุดพร้อมข้อความที่บอกให้ใช้ export ที่รองรับหรือส่งตัวอย่างที่ปกปิดข้อมูลเพื่อเพิ่ม schema version ระบบไม่เดาความหมายของ XLSX ที่ไม่รู้จัก

## Adapter contracts

| Adapter | Schema version | รูปแบบ | สถานะ |
|---|---|---|---|
| TikTok Shop Thailand | `tiktok-shop-th-statement-v1` | CSV, XLSX หลายชีต | ผ่าน synthetic contract; รอตรวจรับกับ export จริง |
| Shopee Thailand | `shopee-th-income-v1` | CSV, XLSX | ผ่าน synthetic contract; รอตรวจรับกับ export จริง |
| Lazada Thailand | `lazada-th-account-statement-v1` | CSV, XLSX | ผ่าน synthetic contract; รอตรวจรับกับ export จริง |

ตัวอย่างทั้งหมดใน `apps/web/public/examples` เป็นข้อมูลสมมติ ไม่ใช่ไฟล์ทางการของแพลตฟอร์ม ตัวอย่าง TikTok XLSX มีสี่ชีตเพื่อทดสอบการเลือกชีต `Order details` อัตโนมัติ

## กฎการแปลง

- ใช้รหัส statement/payout, วันที่ชำระเงิน, ยอดรวม, รหัสธุรกรรม, เลขคำสั่งซื้อ และยอดต่อคำสั่งซื้อเมื่อไฟล์มีข้อมูลเหล่านี้
- หากไม่มีรหัสรอบโอน ระบบสร้างรหัสคงที่จาก platform + วันที่ และแสดงข้อสังเกตก่อนยืนยัน
- หากไม่มียอดรวมต่อรอบ ระบบรวมยอดจากบรรทัดในไฟล์และแสดงข้อสังเกต
- หากไม่มีรหัสธุรกรรม ระบบสร้างรหัสจาก checksum ของบรรทัด เพื่อให้การนำเข้าไฟล์เดิมซ้ำไม่เพิ่มยอด
- ยอดติดลบหรือศูนย์ถูกหยุด เพราะต้องจำแนกเป็นค่าธรรมเนียม คืนเงิน หรือรายการปรับยอดก่อน จึงไม่ถูกบันทึกเป็นเงินรับคำสั่งซื้อโดยอัตโนมัติ
- วันที่รองรับ `YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, `DD-MM-YYYY` และ date cell ใน XLSX แล้วแปลงเป็น canonical ISO date

## ความปลอดภัยและหลักฐาน

- จำกัด CSV 1 MB, XLSX 5 MB, 1,000 แถว, 80 คอลัมน์, 12 ชีต และ 60,000 cells
- ตรวจ ZIP directory ก่อนเปิด XLSX จำกัดจำนวน entry และขนาดข้อมูลหลังขยาย พร้อมปฏิเสธไฟล์เข้ารหัส
- ใช้ตัวอ่าน XLSX แบบ read-only และไม่ประมวลผลสูตรหรือ macro
- เก็บ raw bytes, content type, checksum, adapter key, schema version, source sheet, canonical mapping และ preview แบบ append-only
- fingerprint ทำให้การยืนยันไฟล์เดิมด้วย adapter/version เดิมคืน batch เดิม
- ใช้ shop-scoped write lock เดียวกับ manual settlement และ reversal
- ไฟล์ไม่ถูกส่งไปยังโมเดล AI
- `npm audit --omit=dev` ไม่พบช่องโหว่ที่รายงานใน production dependencies

## ผลตรวจ

- TypeScript, ESLint, production build และ migration ผ่าน
- Integration tests **75/75** ผ่าน รวมสาม adapter, TikTok XLSX หลายชีต, exact source download, idempotency, fallback, negative adjustment และ role isolation
- Browser tests **21/21** ผ่าน รวม Shopee auto-detection บน viewport 390 px โดยข้ามหน้าจับคู่และดาวน์โหลดไฟล์เดิมได้

## ข้อมูลที่ต้องใช้เพื่อยืนยัน production adapter

ต้องมี export จริงอย่างน้อยหนึ่งไฟล์ต่อ platform/version โดยแทนค่าต่อไปนี้ก่อนส่ง: ชื่อผู้ซื้อ, username, เบอร์โทร, อีเมล, ที่อยู่, ชื่อบัญชี และเลขบัญชี ส่วนชื่อชีต หัวคอลัมน์ ลำดับคอลัมน์ รูปแบบวันที่ เครื่องหมายยอดติดลบ ประเภท transaction และแถว summary ต้องคงเดิม เพราะเป็นข้อมูลที่ใช้สร้าง contract fixture

หลังได้รับไฟล์ ให้เพิ่ม schema version ใหม่หากรูปแบบต่างจาก v1 ตรวจยอดรวมกับ Seller Center และให้ผู้ดูแลการเงิน sign off ก่อนเปลี่ยนสถานะจาก `sample-validation-required` เป็น `verified` ห้ามแก้ความหมายของ schema version เดิมย้อนหลัง
