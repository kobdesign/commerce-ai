# Product workflow v1.13 — Evidence storage registry และ lifecycle

วันที่: 24 กันยายน 2026 · งาน: REL-AG-01b

## ผลลัพธ์

แยกการจัดเก็บไฟล์หลักฐานออกจาก order/settlement workflow ด้วย package `@commerce/storage` และตาราง `app.evidence_objects` กลาง โดยยังรักษา transaction, checksum, tenant isolation และการดาวน์โหลดไฟล์เดิม

- Order import drafts และ settlement imports ใช้ `storeEvidenceObject`/`readEvidenceObject` ร่วมกัน
- Registry เก็บ backend, object key, content type, byte size, SHA-256, retention class, retain-until และ lifecycle status
- Backend ปัจจุบันคือ `postgres-inline-v1` สำหรับ local/staging; ไม่อ้างว่าเป็น Private Object Storage
- อ่านไฟล์ผ่าน registry ก่อนและตรวจ byte size + SHA-256 ทุกครั้ง หากไม่ตรงจะ fail ด้วย `EVIDENCE_INTEGRITY` โดยไม่ส่ง bytes ที่เสียหายให้ผู้ใช้
- RLS จำกัด Owner/Finance/Auditor ตาม tenant/shop เหมือนหลักฐานเดิม Marketing และ tenant อื่นอ่านไม่ได้
- Runtime ไม่มีสิทธิ์ UPDATE/DELETE ทั้ง registry และ legacy source tables

## Migration และ rollback boundary

Migration `0025-evidence-storage-registry.sql` ทำแบบ expand:

1. สร้าง registry และ backfill จาก `import_sources` กับ `settlement_import_batches`
2. Deduplicate ตาม tenant + shop + SHA-256
3. เพิ่ม nullable `evidence_object_id` และเชื่อม foreign key กับตารางเดิม
4. Flow ใหม่เขียน registry และ legacy `content` ใน transaction เดียวกันชั่วคราว
5. การอ่าน row รุ่นเก่าที่ไม่มี reference ยัง fallback ไป legacy bytes และตรวจ checksum

ยังไม่ลบคอลัมน์ `content` หรือบังคับ reference เป็น NOT NULL เพราะต้องรักษา app rollback ระหว่าง rollout การ contract schema จะทำหลัง external backend migration, read verification และ rollback window ผ่านแล้ว

`retain_until=NULL` หมายถึงยังไม่มี disposal date ที่อนุมัติและไม่ใช่สิทธิ์ให้ลบไฟล์ Lifecycle ยังเป็น `active` เท่านั้นจนกว่าจะยืนยัน retention/legal hold/delete policy

## Verification

- `npm run typecheck` ผ่าน
- `npm run lint` ผ่าน
- `npm run build` ผ่าน
- `npm test` ผ่าน 16 files, 107 tests
- ทดสอบ exact-file download ทั้ง CSV/XLSX, adapter dedup, RLS, unauthorized roles, append-only และ legacy row fallback
- ทดสอบแก้ bytes ด้วย admin ให้มีขนาดเท่าเดิมแต่ SHA-256 ต่าง ระบบปฏิเสธด้วย `EVIDENCE_INTEGRITY`
- `npm run db:migrate` กับ local database ที่มีข้อมูลเดิมผ่าน
- `npm run data:verify-storage` ตรวจ local registry 142 objects: corrupt 0; import links 120/120; settlement links 22/22; missing/mismatch 0

จำนวน 142 เป็นหลักฐานจาก local workspace วันที่ตรวจ ไม่ใช่ปริมาณ production และไม่ใช้เป็น KPI ธุรกิจ

## ข้อจำกัดและงานต่อไป

- Bytes ยังอยู่ PostgreSQL และ dual-write จึงยังไม่ลดขนาดฐานข้อมูล
- ยังไม่ได้เลือก S3-compatible/provider, region, encryption key, bucket policy หรือ signed-download design
- External object write ห้ามทำค้างใน business transaction; รอบนั้นต้องเพิ่ม staged upload/status, idempotent finalize, orphan cleanup และ retry/reconciliation
- Retention duration, legal hold, deletion approval และ backup retention ยังรอ policy
- งานถัดไปที่ไม่ต้องรอ provider คือ REL-AG-01c: backup/restore rehearsal ของ PostgreSQL พร้อมตรวจ registry links และ checksum หลัง restore
