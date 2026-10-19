# OPS-AG-01b — Human-confirmed reservation lifecycle v1.23

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Internal manual commands · Marketplace automation ยังรอ DEC-06**

## ผลลัพธ์ทางธุรกิจ

รุ่นนี้ต่อยอด stock ledger ให้ทีมงานกันสินค้าสำหรับคำสั่งซื้อที่ตรวจแล้วได้ โดยไม่ลดจำนวนของจริงก่อนสินค้าออกจากคลัง และบันทึกรายการของไม่พอแยกจาก movement เพื่อไม่สร้างภาพว่าสินค้าถูกตัดแล้ว

| คำสั่ง/สถานะ | `on_hand` | `reserved` | `available` | Physical movement |
|---|---:|---:|---:|---|
| สร้างการจองและมีของ | คงเดิม | เพิ่ม | ลด | ไม่มี |
| สร้างการจองแต่ของไม่พอ (`shortage`) | คงเดิม | คงเดิม | คงเดิม | ไม่มี |
| ตัดสินค้าออก (`commit`) | ลด | ลด | คงเดิม | `sale_commit` หนึ่งรายการ |
| ปล่อยการจอง | คงเดิม | ลด | เพิ่ม | ไม่มี |
| ปิดรายการหมดอายุ | คงเดิม | ลด | เพิ่ม | ไม่มี |
| ลอง shortage/expired ใหม่ | คงเดิม | เพิ่มเมื่อของพอ | ลดเมื่อของพอ | ไม่มี |

Invariant ทุกสถานะคือ `available = on_hand - reserved`, `0 <= reserved <= on_hand` และคำสั่งพร้อมกันต้องไม่จองเกินของที่มี

## Workflow และ UX

- owner/finance/operator สร้างและเปลี่ยนสถานะได้; auditor อ่านอย่างเดียว; marketing ไม่มีสิทธิ์
- ผู้ใช้เลือก SKU, จำนวน, อายุการจอง, รหัสอ้างอิงและเหตุผล แล้วติ๊กยืนยันก่อนสร้าง
- อายุการจองให้ผู้ใช้เลือก 30 นาที, 2 ชั่วโมง, 24 ชั่วโมง หรือ 7 วัน; core รองรับไม่เกิน 30 วัน
- รหัสอ้างอิงเดิมกับ payload เดิมเป็น retry ที่ไม่เพิ่มยอดซ้ำ; payload ต่างกันถูกปฏิเสธ
- หาก `available` ไม่พอ ระบบสร้าง `shortage` ที่ `reserved_quantity=0` และไม่มี physical movement
- รายการ reserved ที่ยังไม่หมดอายุทำได้สองอย่าง: ตัดสินค้าออก หรือปล่อยการจอง
- เมื่อถึงเวลา ผู้ใช้ปิดรายการหมดอายุเพื่อคืนยอดพร้อมขาย; รุ่นนี้ยังไม่มี background auto-expiry
- shortage และ expired ลองจองใหม่ได้หลังสินค้าเข้า โดยใช้ record/version เดิมและกำหนดอายุใหม่
- ทุก transition ต้องยืนยันผลและระบุเหตุผล พร้อม audit และ optimistic version

## ขอบเขตเทคนิค

- Migration `0031-inventory-reservations.sql`
- ตาราง `app.inventory_reservations` เก็บ shop/location/variant, requested/reserved quantity, source reference, expiry, status, confirmer, resolution และ version
- `app.create_inventory_reservation(...)` และ `app.transition_inventory_reservation(...)` เป็น security-definer command boundary; application role ไม่มี direct write/delete grant
- reserve/shortage/commit/release/expire/retry ล็อก balance row และเปลี่ยน state ใน transaction เดียว
- commit เพิ่ม append-only `inventory_movements.movement_type='sale_commit'` โดยอ้าง reservation ID
- API:
  - `POST /api/tenants/:tenantId/inventory-reservations`
  - `PATCH /api/tenants/:tenantId/inventory-reservations/:reservationId`
- UI อยู่ใน `/catalog/:productId/inventory` ต่อจากยอด SKU และใช้ข้อมูลจาก overview เดียวกัน

## DEC-06 — สิ่งที่กำหนดชั่วคราวและสิ่งที่ยังต้องยืนยัน

ใช้ใน local แล้ว:

- Company stock ledger เป็น authority ภายใน; channel listing เป็น identity mapping เท่านั้น
- Reserve ไม่ใช่ physical movement; commit เมื่อผู้ใช้ยืนยันว่าสินค้าออกจากคลัง
- Shortage ไม่สร้างยอดติดลบ ไม่ partial allocate และไม่สร้าง movement เท็จ
- Expiry เป็นเวลาที่ผู้ใช้เลือก; ไม่มีการเดา SLA ของ Marketplace
- ต้นทุนสินค้าและ quantity ledger ยังแยกกัน

Operations/Finance ต้องยืนยันก่อน marketplace automation:

- เหตุการณ์ใดของแต่ละแพลตฟอร์มเริ่ม reserve: placed, paid หรือ ready-to-ship
- commit ที่ packed, handed-to-carrier หรือสถานะอื่น และวิธี reconcile เมื่อ event มาช้า/สลับลำดับ
- อายุ reservation, safety stock และการจัดลำดับคำสั่งซื้อแต่ละช่องทาง
- partial allocation/backorder policy และผู้รับผิดชอบ shortage
- cancel/return: สภาพใดจึงคืน on-hand และใครยืนยันว่า resalable
- inbound authority, multi-location/transfer และ inventory valuation ที่การเงินยอมรับ

## Verification

- Integration **158/158 ผ่าน**; เพิ่ม 7 cases ครอบ reserve invariant, shortage without movement, last-item concurrency, single commit movement, release/expiry, retry/idempotency และ role/tenant/direct-SQL boundary
- Browser reservation **2/2 ผ่าน** ครอบคลุม reserve → commit → shortage, ยอดทั้งสามชนิด, ledger evidence และ viewport 390×844
- Marketplace connector, automatic expiry, live order ingestion และ return flow ยังไม่ได้รับการตรวจรับจากผลนี้

## งานถัดไป

ทำ OPS-AG-01c: internal live-order state และ order lines แบบ manual/shadow เชื่อม channel listing → canonical SKU → reservation/shortage พร้อม payment/fulfillment state แยกกัน โดยยังไม่รับ webhook หรือส่งคำสั่งภายนอกจน DEC-05/06 ผ่าน
