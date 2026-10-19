# INT-AG-01b — Incoming event inbox v1.26

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · No provider webhook · No business mutation**

## ผลลัพธ์

ระบบมี ingress contract สำหรับรับ event จาก adapter โดยตรวจ HMAC-SHA256 กับ raw UTF-8 bytes ก่อนเรียกฐานข้อมูล แล้วบันทึก event แบบ tenant/shop scoped ด้วย provider namespace และ provider event ID ที่ไม่ซ้ำ การส่งซ้ำเนื้อหาเดิมคืน record เดิม ส่วนการใช้ event ID เดิมกับเนื้อหาหรือ metadata ต่างกันถูกปฏิเสธเป็น conflict

Secret และลายเซ็นดิบไม่ถูกส่งเข้า PostgreSQL ระบบเก็บเฉพาะ SHA-256 ของ body, hash ของ safe metadata, ผลตรวจลายเซ็น, verification method และ key reference ที่ไม่มี key material พร้อม normalized JSON payload ขนาดจำกัด

## Ordering และ reconciliation

- `accepted`: signature ผ่านและ sequence ต่อจาก cursor หรือเป็น event แรกของ stream
- `gap`: sequence กระโดดข้ามค่าที่ยังไม่มา อยู่ `needs_review`
- `stale`: sequence ไม่ใหม่กว่า cursor อยู่ `needs_review` และไม่เลื่อน cursor
- `unordered`: provider ไม่มี sequence อยู่ `needs_review`
- `invalid_signature`: อยู่ `rejected` และไม่สร้าง/เลื่อน stream cursor
- เมื่อ predecessor มาถึง ระบบเลื่อน gap ที่ต่อเนื่องเป็น `recovered_gap`/`ready` และเดิน cursor ภายใต้ stream advisory lock

ทุก insert และการเปลี่ยนจาก gap เป็น ready สร้าง versioned status event ใน transactional outbox: `integration.inbox_ready.v1`, `integration.inbox_needs_review.v1` หรือ `integration.inbox_rejected.v1` สถานะ `ready` หมายถึงผ่าน ingress policy เท่านั้น ยังไม่ใช่คำสั่งเปลี่ยน order, inventory หรือข้อมูลการเงินจริง

## Security และ tenancy

- `commerce_queue` เรียกได้เฉพาะ security-definer ingest function และไม่มี direct DML grant
- owner/operator/auditor อ่านได้เฉพาะ tenant และร้านที่ได้รับสิทธิ์; marketing ไม่เห็น operational inbox
- exact replay ถูก serialize ด้วย provider-event advisory lock; stream ordering ถูก serialize แยกต่อ tenant/shop/provider/stream
- schema จำกัด provider/event/stream identity, JSON object/size, hash, signature state และ reconciliation-state combinations

## หลักฐานตรวจรับ

Inbox integration 7 cases ผ่าน:

1. HMAC ผ่าน, evidence hash และ exact replay คืน ID เดิมโดยไม่มี secret/signature ดิบใน record
2. provider event ID เดิมแต่ immutable content ต่างกันถูกปฏิเสธ
3. invalid signature ถูก quarantine และไม่เลื่อน cursor
4. gap/stale classification และ contiguous gap recovery พร้อม outbox versions
5. verified event ที่ไม่มี sequence เข้าคิว review
6. concurrent exact delivery 5 ครั้งสร้าง event เดียว
7. owner/operator/auditor read scope, marketing isolation และ queue-role direct mutation denial

ผล regression รวม `179/179` ผ่าน พร้อม typecheck, lint และ build

## ข้อจำกัด

- HMAC contract ปัจจุบันเป็น synthetic adapter; ยังไม่ได้ยืนยัน canonical bytes, header, algorithm, timestamp tolerance หรือ key rotation ของ TikTok/Shopee/Lazada
- event แรกของแต่ละ stream ตั้ง initial cursor จาก sequence ที่ได้รับ จึงต้องมี provider bootstrap/backfill contract ก่อน production
- หน้าจอ review, manual resolution/replay และ SLA metrics ถูกต่อใน [v1.27](53-operational-inbox-review.md); alert destination และ retention policy ยังไม่มี
- ยังไม่มี processor map event เป็น internal order/inventory command และไม่มี external write
- normalized payload อาจมีข้อมูลส่วนบุคคลตาม provider; adapter จริงต้องกำหนด allowlist/minimization และ retention ก่อนเปิดใช้

## งานถัดไป

AUTH-AG-01a: สร้าง service principal และ delegated tenant/shop scopes พร้อม expiry, revocation และ current-policy recheck ก่อนเชื่อม provider จริง
