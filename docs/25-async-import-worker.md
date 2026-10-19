# งานยืนยันนำเข้าแบบเบื้องหลัง — v1.2

วันที่ตรวจ: 17 กันยายน 2026

## ปัญหาที่แก้

การยืนยันร่างเดิมทำงานทั้งหมดภายใน HTTP request เดียว หน้าเว็บจึงต้องรอจนสร้างรายการขายเสร็จ และไม่สามารถบอกได้ว่างานค้างอยู่ที่ใดเมื่อ worker หรือฐานข้อมูลหยุดชั่วคราว รุ่นนี้เปลี่ยนการยืนยันเป็นคำของานที่เก็บถาวรก่อนตอบหน้าเว็บ แล้วให้ worker ดำเนินการแยกจาก request

## Flow ที่ใช้งานได้

1. Owner หรือ Finance ตรวจร่างและยืนยันความหมายของเงินรับสุทธิ
2. API สร้าง job สถานะ `queued` แบบ idempotent หนึ่ง job ต่อหนึ่งร่าง
3. หน้าเว็บแสดง **รอดำเนินการ** หรือ **กำลังนำเข้า** และติดตามสถานะอัตโนมัติ ผู้ใช้ออกจากหน้าได้
4. worker รับงานพร้อมกันไม่เกิน 2 งาน แล้วตรวจ membership, tenant, shop grant และ role ของผู้ขอใหม่ ณ เวลาทำงาน
5. เมื่อสำเร็จ หน้าเว็บแสดงจำนวนรายการและลิงก์ไปหน้าเงินรับและต้นทุน
6. ความผิดพลาดชั่วคราวลองใหม่อัตโนมัติสูงสุด 3 ครั้ง งานที่ค้างเพราะ worker หยุดถูกนำกลับมาทำต่อหลัง 5 นาที
7. หากลองครบ ผู้ใช้เห็นข้อความที่ตัดรายละเอียดภายในออก และสั่ง retry งานเดิมได้โดยไม่สร้าง job หรือยอดขายซ้ำ

## ความถูกต้องและการแยกสิทธิ์

- `app.import_commit_jobs` เป็น durable job record แยก tenant/shop ด้วย FORCE RLS
- web role อ่านและสร้าง job ได้ตามสิทธิ์ร้าน แต่แก้สถานะได้เฉพาะการ reset งานที่ล้มเหลวกลับเป็นรูปแบบ `queued` ที่กำหนดไว้
- queue role อ่านและอัปเดตเฉพาะตาราง job ไม่มีสิทธิ์อ่านสินค้า รายการขาย หรือข้อมูลธุรกิจตารางอื่นโดยตรง
- worker เปิด business connection ผ่าน `commerce_app` และ reauthorize ผู้ขอทุกงาน จึงไม่เชื่อ tenant ID จาก job เพียงอย่างเดียว
- การส่งคำขอซ้ำคืน job เดิม ส่วน `import_batches` และ source line identity ยังคงเป็นชั้นป้องกัน financial effects ซ้ำ
- job เก็บเฉพาะ IDs, สถานะ, จำนวนครั้ง, ผลสรุป และ error ที่ปลอดภัย ไม่เก็บ CSV หรือข้อมูลรายการขาย

## UX

- ปุ่มยืนยันเปลี่ยนข้อความเป็น **กำลังส่งเข้าคิว…** ระหว่าง request
- สถานะงานอยู่ในบริบทเดียวกับร่างและใช้ถ้อยคำงานธุรกิจ ไม่แสดงชื่อ queue หรือรายละเอียดระบบ
- ประวัติร่างแยก **ร่าง / รอดำเนินการ / กำลังนำเข้า / นำเข้าแล้ว / ไม่สำเร็จ**
- job ที่ล้มเหลวจากปัญหาชั่วคราวมีปุ่ม **ลองนำเข้าอีกครั้ง**; ปัญหาข้อมูลแนะนำให้สร้างร่างใหม่

## ผลตรวจ

- TypeScript, ESLint, migration และ production build ผ่าน
- Integration tests **62/62** ผ่าน รวม queue idempotency, role access, tenant scope, restricted status updates, completion และ requeue
- Browser tests **18/18** ผ่าน พร้อม web และ worker จริง ครอบคลุมยืนยันนำเข้า → รอสถานะ → เปิดผลการเงิน รวมถึง flow source deduplication, refund/reversal, expense/reversal และ missing-cost review
- worker smoke test ผ่าน: pg-boss catalog job → ตรวจสิทธิ์ใหม่ → อ่าน catalog ตาม tenant → บันทึก audit โดยทำงานร่วมกับ import polling loop

## ขอบเขตที่ยังไม่รับรอง

- worker รุ่นนี้ใช้ PostgreSQL durable job table และ polling 1.5 วินาทีเพื่อให้คำขอจาก web ถูกบันทึกใน transaction เดียว โดยยังใช้ pg-boss สำหรับ catalog job เดิม
- ยังไม่มี dashboard ผู้ดูแลคิว, dead-letter bulk action, per-tenant concurrency quota หรือ metric/alert ของ queue lag
- timeout recovery อยู่ที่ 5 นาที งาน import จึงต้องคง idempotent และ transaction ของ financial facts ต้องเสร็จภายในเวลาฐานข้อมูลที่กำหนด
- production ยังต้องซ้อม worker crash, deploy web/worker คนละรุ่น, database restore และ alert ก่อนเปิด pilot จริง
