# นำเข้า statement เงินโอนจาก CSV — v1.4

วันที่ตรวจ: 17 กันยายน 2026

## ปัญหาที่แก้

รุ่น v1.3 บันทึก allocation จาก statement ได้ทีละบรรทัด ซึ่งเหมาะกับการพิสูจน์ Business Logic แต่ไม่เหมาะกับรอบโอนที่มีหลายร้อยคำสั่งซื้อ รุ่นนี้เพิ่ม flow นำเข้า CSV แบบสามขั้นตอนและบันทึกทั้งไฟล์ใน transaction เดียว

## Flow ที่ใช้งานได้

1. Owner หรือ Finance เลือก CSV UTF-8 ขนาดไม่เกิน 1 MB และ 1,000 บรรทัด
2. ระบบอ่านหัวไฟล์และเสนอการจับคู่คอลัมน์สำหรับรหัสรอบโอน วันที่ ยอดรวม รหัสบรรทัด เลขคำสั่งซื้อ ยอดจัดสรร และหมายเหตุ
3. Preview ตรวจชนิดข้อมูล รหัสซ้ำในไฟล์/ฐานข้อมูล ความสม่ำเสมอของวันที่และยอดรวมต่อรอบโอน และการจับคู่คำสั่งซื้อ
4. ผู้ใช้ตรวจผลและยืนยันความหมายของ statement
5. ระบบเก็บไฟล์ต้นฉบับ checksum mapping และ preview แล้วสร้าง settlement lines ทั้งชุดแบบ atomic
6. ผู้ใช้ดาวน์โหลดไฟล์ต้นฉบับจากประวัติชุดนำเข้าหรือจากบรรทัดหลักฐานได้

ไฟล์ตัวอย่างข้อมูลสมมติอยู่ที่ `apps/web/public/examples/settlements-synthetic.csv`

## ความถูกต้องและความปลอดภัย

- fingerprint รวม checksum, delimiter, mapping และ parser version การยืนยันไฟล์เดิมพร้อม mapping เดิมซ้ำคืนชุดเดิมโดยไม่เพิ่มยอด
- รหัสบรรทัดต้นทางเป็นตัวตนทางธุรกิจข้ามไฟล์ หากถูกใช้แล้วไฟล์ใหม่จะไม่ผ่าน preview
- write lock ระดับร้านทำให้ manual entry, reversal และ CSV commit ไม่แทรกกันระหว่างตรวจและบันทึก
- ชุดนำเข้าและ settlement lines ถูกบันทึกใน transaction เดียว หากหนึ่งบรรทัดล้มเหลวจะไม่เหลือข้อมูลบางส่วน
- `app.settlement_import_batches` และ `app.settlement_lines` ใช้ FORCE RLS แยก tenant/shop และเป็น append-only สำหรับ runtime role
- Owner/Finance นำเข้าได้ Auditor อ่านและดาวน์โหลดหลักฐานได้ บทบาทอื่นถูกปฏิเสธ
- API จำกัดขนาด JSON และไฟล์ ตรวจ UTF-8, CSV shape, จำนวนคอลัมน์/แถว และไม่ส่งไฟล์ให้โมเดล AI

## UX

- การนำเข้าอยู่ใน disclosure เดียวเหนือฟอร์มกรอกทีละบรรทัด ผู้ใช้จึงเลือกวิธีตามปริมาณงานได้
- ขั้นตอน **เลือกไฟล์ → จับคู่คอลัมน์ → ตรวจและยืนยัน** ใช้คำและโครงเดียวกับรายงานยอดขาย
- Preview แสดงผลตรวจรายบรรทัด พร้อมจำนวนรอบโอน รายการผิด และข้อสังเกต
- หลังยืนยัน หน้าเดียวกันอัปเดตตารางรอบโอน ตารางคำสั่งซื้อ และหลักฐานโดยไม่ต้องไปเมนูอื่น
- ประวัติแสดงชื่อไฟล์ จำนวนบรรทัด จำนวนรอบ ขนาด checksum และปุ่มดาวน์โหลด

## ผลตรวจ

- TypeScript, ESLint, migration และ production build ผ่าน
- Integration tests **72/72** ผ่าน รวม preview/commit, multi-order payout, raw evidence, conflicting payout, duplicate source, concurrent idempotency, role/tenant isolation และ append-only grants
- Browser tests **20/20** ผ่าน เส้นทางใหม่ทดสอบบน 390 px ตั้งแต่นำเข้าคำสั่งซื้อ → อัปโหลด statement → auto mapping → preview → commit → กระทบครบ → ดาวน์โหลดไฟล์เดิม

## ขอบเขตที่ยังไม่รับรอง

- รุ่นนี้เป็น generic settlement contract ยังไม่ได้อ้างว่า header หรือ semantics ตรงกับ export จริงของ TikTok, Shopee หรือ Lazada
- ต้องรับไฟล์จริงที่ตัดข้อมูลส่วนบุคคลไม่จำเป็นออก เพื่อสร้าง adapter และ contract fixture แยกตาม platform/version
- ไฟล์ถูกเก็บใน PostgreSQL สำหรับ local/staging เท่านั้น ก่อน production ต้องย้ายไป private object storage พร้อม retention, encryption และ restore policy
- ยังไม่ใช่ bank reconciliation และยังไม่ตีความ reserve, withholding tax, VAT, FX หรือ adjustment code เฉพาะแพลตฟอร์ม
