# Product workflow v1.9 — งานติดตามจากหลักฐานที่ผู้ใช้ยืนยัน

สถานะ: FIN-AI-04 เสร็จและตรวจด้วยข้อมูลสมมติใน local เมื่อ 2026-09-18 ยังไม่ใช่ผล UAT จาก Statement จริงหรือ production sign-off

## ผลลัพธ์

เจ้าของและฝ่ายการเงินเลือกรายการผิดปกติจากผลสรุป สร้างร่าง ตรวจผู้รับผิดชอบ เหตุผล ช่วงข้อมูล และหลักฐาน แล้วกดยืนยันขั้นสุดท้ายก่อนระบบสร้างงานติดตาม AI ไม่มีคำสั่งยืนยันงานและไม่มีสิทธิ์เปลี่ยนสถานะงาน

งานที่สร้างแล้วมีหน้าอ้างอิงถาวร เปิด snapshot หลักฐานย้อนหลังได้ และเปลี่ยนสถานะ `open → in_progress → resolved/cancelled` พร้อมเหตุผลและประวัติ การปิดงานไม่แก้ยอดกระทบ ไม่ซ่อนข้อยกเว้น และไม่ยืนยันว่าเงินเข้าธนาคาร

## ขอบเขตความปลอดภัย

- ตัวร่างเก็บ payload hash, evidence hash, evidence/policy version, วันหมดอายุ, ผู้เสนอ และ AI run ที่เสนอถ้ามี
- ยืนยันได้จากคำสั่ง UI ที่ผ่าน session และ same-origin เท่านั้น `confirm_review_task` ไม่ถูกเพิ่มเป็น AI tool
- ก่อนยืนยัน ระบบอ่านหลักฐานล่าสุดและฐานข้อมูลตรวจ role, shop grant, ผู้รับผิดชอบ, payload hash และ evidence hash ซ้ำ
- การสร้างงาน การใช้ร่าง การบันทึกผู้อนุมัติ/ผู้ดำเนินการ และ audit เกิดใน transaction เดียว
- การส่งคำขอยืนยันซ้ำหรือ response หายจะคืน task เดิม ร่างหนึ่งสร้างได้งานเดียว และข้อยกเว้นเดียวกันมีงาน `open/in_progress` ได้หนึ่งงาน
- ผู้รับผิดชอบต้องเป็นสมาชิก active บทบาท owner/finance และมีสิทธิ์ร้าน ณ ตอนสร้างร่างและตอนยืนยัน
- Auditor อ่านงาน หลักฐาน และ timeline ได้ แต่สร้าง ยืนยัน หรือปิดงานไม่ได้ Marketing/Operator ไม่มีสิทธิ์อ่าน workflow การเงินนี้
- ตาราง task และ event ใช้ RLS ตาม tenant/shop และไม่มี direct write grant ให้ application role การเขียนผ่าน security-definer commands ที่จำกัดขอบเขต

## UX ที่ส่งมอบ

1. กด `สรุปจากข้อมูล` หรือใช้ AI ช่วยจัดลำดับ
2. เลือก `ร่างงานติดตาม` บนข้อเท็จจริงที่มี evidence ID จริง
3. เลือกผู้รับผิดชอบและตรวจเหตุผล แล้วกด `ตรวจร่างก่อนยืนยัน`
4. ระบบสร้างร่าง immutable และแสดงผลกระทบ/วันหมดอายุ ผู้ใช้ต้องติ๊กยืนยันเอง
5. กด `ยืนยันและสร้างงานติดตาม` แล้วเปิดหน้ารายละเอียด หลักฐาน และ timeline

เมื่อไม่ได้เชื่อมโมเดล flow เดียวกันยังทำงานจาก system summary ได้ ไม่มีการลด policy หรือข้าม human confirmation

## การตรวจรับที่รันแล้ว

- Integration/regression: 13 files, 93 tests ผ่าน
- ครอบคลุม replay/double confirmation, active-task deduplication, payload mismatch, evidence changed, expired draft, revoked assignee, role/tenant/shop boundary และ lifecycle ที่ไม่เปลี่ยน reconciliation
- Focused Chromium E2E บน viewport 390×900 ผ่าน: system summary → ร่าง → preview → human checkbox → confirm → เปิดงาน → in progress → resolved → หลักฐานยังอยู่
- `lint`, `typecheck` และ production build ผ่าน
- ภาพตรวจ responsive: `artifacts/financial-review-task-390.png`

## ข้อจำกัดที่ยังเหลือ

- หลักฐานและ adapter ยังเป็น synthetic contract จนกว่า DATA-AG-01 จะตรวจไฟล์จริงที่ปกปิดข้อมูล
- ยังไม่รัน live-model evaluation, finance-user UAT, staging rehearsal หรือ recovery drill งานเหล่านี้อยู่ FIN-AI-05/REL-AG-01
- ยังไม่มี notification, due date, reassignment, comment, SLA dashboard หรือ external ticket integration
- evidence recheck ใช้ deterministic application read แล้วให้ transaction เปรียบเทียบ hash ก่อนสร้างงาน การเพิ่ม high-volume concurrent ingestion ควรเพิ่ม finance revision token ที่ commit ร่วมกับ ledger writes

## การย้อนกลับ

ปิดทางเข้า UI/API ของงานติดตามได้โดยไม่กระทบ ledger ตารางใหม่เป็น append-only operational data การ rollback application ไม่ต้องลบงานเดิม และ migration ถัดไปต้องรักษา task/evidence/audit ไว้ ห้าม drop ใน hot rollback
