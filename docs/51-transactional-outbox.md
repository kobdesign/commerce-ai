# INT-AG-01a — Transactional outbox v1.25

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Internal consumer only · No provider connector**

## ผลลัพธ์

Order และ inventory state สร้าง integration event ใน PostgreSQL transaction เดียวกัน ถ้า business transaction rollback จะไม่มี event หลุดออกมา และ worker หลาย instance สามารถ claim งานด้วย lease + `FOR UPDATE SKIP LOCKED` โดยไม่ claim delivery เดียวกันพร้อมกัน

รุ่นนี้ส่ง event ต่อไปนี้:

- `commerce.order_created.v1`
- `commerce.order_payment_confirmed.v1`
- `commerce.order_shipped.v1`
- `commerce.order_cancelled.v1`
- `inventory.reservation_<status>.v1`
- `inventory.reservation_retried_shortage.v1`
- `inventory.movement_recorded.v1`

ชื่อ event มี schema version และ payload จำกัด 16 KiB เก็บเฉพาะ identity/state/quantity ที่จำเป็น ไม่มี raw Statement, credentials หรือข้อมูลการเงินละเอียด

## Delivery model

- `integration_outbox_events` เป็น append-only source event พร้อม tenant, shop, aggregate identity/version และ global position
- `integration_outbox_deliveries` มีสถานะแยกต่อ consumer: `pending → processing → succeeded | dead_letter`
- แต่ละ consumer กำหนด event types และ max attempts ของตนเอง ไม่มี shared `dispatched` flag
- claim ใช้ lease owner/expiry; claim ที่หมดอายุจะกลับเข้า queue หรือ dead-letter เมื่อครบจำนวนครั้ง
- failure ใช้ exponential backoff สูงสุด 5 นาทีและเก็บเฉพาะ stable error code
- built-in consumer `internal.operations.v1` บันทึก idempotent receipt ด้วย unique `(tenant,event,consumer)` และ SHA-256 ของ payload
- หาก worker crash หลัง receipt แต่ก่อน complete การ claim ครั้งถัดไปเห็น receipt เดิมและไม่สร้าง effect ซ้ำ
- `/api/ready` เพิ่ม `outboxQueue`; backlog ที่ claim ได้ค้างเกิน 10 นาทีหรือ lease ค้างเกิน grace period ทำให้ readiness unavailable

Outbox ให้การส่งแบบ **at least once** ส่วนผลลัพธ์ไม่ซ้ำต้องมาจาก idempotency key ของ consumer หรือ provider ไม่กล่าวอ้าง transport exactly once

## Security และ tenancy

- Business triggers และ event insert เป็น database-owned boundary; runtime role แก้ event ไม่ได้
- `commerce_queue` เรียกได้เฉพาะ active-consumer/claim/receipt/complete/fail functions และไม่มี direct DML grant
- owner/auditor อ่าน operational records ได้เฉพาะ tenant/shop ที่มีสิทธิ์; marketing ไม่เห็นข้อมูล
- worker payload ไม่เชื่อ tenant หรือ scope จาก caller ภายนอก

## หลักฐานตรวจรับ

Integration 7 cases ครอบคลุม:

1. order/reservation/movement events commit พร้อม business state
2. business failure rollback โดยไม่มี event เพิ่ม
3. shortage retry ที่สถานะเดิมได้ aggregate version/event ใหม่
4. delivery state แยก consumer และปฏิเสธ lease owner ผิด
5. crash หลัง effect แล้ว retry โดย receipt ไม่ซ้ำ
6. backoff และ dead letter ตาม attempt limit
7. tenant/RLS และ queue-role direct mutation boundary

## ข้อจำกัด

- Incoming inbox ถูกต่อเป็นงาน INT-AG-01b แล้วใน [v1.26](52-integration-inbox.md); provider webhook และ business reconciliation ยังไม่มี
- ยังไม่เชื่อม TikTok/Shopee/Lazada และไม่มี external side effect
- consumer ใหม่เริ่มรับ event หลัง registration; การ replay ประวัติต้องเป็นคำสั่ง backfill ที่ตรวจรับแยก
- internal receipt พิสูจน์กลไก idempotency ไม่ใช่หลักฐานว่า provider ปลายทางทำรายการสำเร็จ
- manual inventory movement ของ canonical product ที่ผูกหลายร้านยังใช้ shop แรกในการ route event; ต้องเพิ่ม explicit inventory shop/location authority ก่อน connector write

## งานถัดไป

INT-AG-01c: operational inbox review, metrics/alert threshold และคำสั่ง resolve/replay ที่ตรวจสิทธิ์ เหตุผล version และ audit ก่อนเชื่อม provider จริง
