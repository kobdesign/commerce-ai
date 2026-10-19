# OPS-AG-01c — Internal commerce orders v1.24

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Manual/shadow only · No marketplace connector**

## ผลลัพธ์ทางธุรกิจ

ระบบรับออเดอร์ที่ผู้ใช้ตรวจจาก Seller Center แล้ว โดย resolve รหัสสินค้า/ตัวเลือกของร้านผ่าน active channel listing mapping ไปยัง canonical SKU ไม่จับคู่จากชื่อสินค้า และเก็บ identity snapshot ไว้กับ order line เพื่ออธิบายย้อนหลังได้

สถานะถูกแยกเป็นสามเรื่อง:

| เหตุการณ์ | Payment | Fulfillment | Inventory |
|---|---|---|---|
| บันทึกออเดอร์รอชำระ | `pending` | `unfulfilled` | `awaiting_payment`; ไม่จองสินค้า |
| บันทึก/ยืนยันว่าชำระแล้ว | `paid` | `unfulfilled` | แต่ละบรรทัดเป็น `reserved` หรือ `shortage` |
| ยืนยันส่งสินค้า | `paid` | `shipped` | ทุกบรรทัดต้อง reserved; ลด on-hand และ reserved พร้อม movement |
| ยกเลิกออเดอร์ | คงสถานะเดิม | `cancelled` | คืน reservation ที่ใช้งานและปิด shortage |

การยกเลิกออเดอร์ที่ชำระแล้วไม่เปลี่ยนเป็น “คืนเงินแล้ว” เพราะหลักฐาน refund และเงินรับเป็นอีก workflow หนึ่ง

## Workflow และ UX

- หน้า `/orders` ใช้ได้สำหรับ owner, finance, operator และ auditor; auditor อ่านอย่างเดียว; marketing ไม่มีสิทธิ์
- ฟอร์มรองรับ 1–50 order lines และใช้เฉพาะ listing mapping ที่เปิดใช้งาน
- ผู้ใช้ระบุ external order ID, external line ID, quantity และราคาต่อหน่วยแบบ optional
- ออเดอร์ paid เลือกอายุการจอง 2 ชั่วโมง, 24 ชั่วโมง หรือ 7 วัน
- shortage ไม่สร้าง physical movement และไม่ทำให้ยอดติดลบ
- ปุ่มส่งสินค้าจะแสดงเมื่อทุกบรรทัดจองได้ และ server ตรวจสถานะ/expiry/stock ซ้ำใน transaction
- ทุก create/transition ต้องติ๊กยืนยันและระบุเหตุผล พร้อม actor/time/audit/version
- layout ผ่านการตรวจ desktop และ viewport 390×844

## ขอบเขตเทคนิค

- Migrations `0032`–`0034` เพิ่ม `commerce_orders`, `commerce_order_lines`, RLS และ security-definer command boundaries
- `create_commerce_order` serialize external order key ด้วย advisory transaction lock ทำให้ concurrent retry คืน order เดิม
- `transition_commerce_order` ล็อก order, lines, reservations และ balances ก่อน confirm payment, ship หรือ cancel
- คำสั่ง ship ทำ ledger movement หนึ่งรายการต่อ line และ rollback ทั้งออเดอร์เมื่อมี line ใดไม่พร้อม
- API:
  - `POST /api/tenants/:tenantId/orders`
  - `PATCH /api/tenants/:tenantId/orders/:orderId`
- runtime role ไม่มี direct write/delete บน order tables

## ข้อจำกัดที่ยังตั้งใจเก็บไว้

- ไม่มี webhook, polling, API authorization หรือ marketplace write; ข้อมูลเป็น manual/shadow
- ยังไม่รองรับ partial allocation, partial shipment, split shipment, COD, payment failure, refund หรือ return-to-stock
- cancellation ไม่สร้าง financial event และไม่สรุปว่าเงินคืนแล้ว
- ยังไม่มี auto-expiry worker; ผู้ใช้ต้องตรวจ reservation ที่หมดอายุ
- provider event ordering, return semantics และ stock authority จริงยังรอ DEC-05/06

## หลักฐานตรวจรับ

- Integration 7 cases: pending→paid, paid shortage, atomic shipment, cancellation, inactive mapping, concurrent idempotency, role/tenant/RLS
- Browser 2 cases: paid→reserve→ship บน desktop และ pending→paid บน mobile
- AG-T05 ผ่านเฉพาะ internal synthetic paid-order shortage; marketplace event ยัง pending
- AG-T06 ผ่านเฉพาะ full cancellation/release; partial return/refund/damaged return ยัง pending

## งานถัดไป

เริ่ม INT-AG-01a: transactional outbox สำหรับ internal order/inventory events พร้อม per-consumer delivery state และ idempotent claim/retry ก่อนเพิ่ม connector read-only/shadow จริง โดยยังไม่รับ provider webhook ระหว่างรอ DEC-05/06
