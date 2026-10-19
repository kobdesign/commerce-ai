# OPS-AG-01a — Inventory authority และ stock ledger v1.22

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Manual inventory authority · ยังไม่เปิด reservation/marketplace write**

## ปัญหาที่แก้

สินค้าเดียวกันอาจขายผ่าน TikTok Shop, Shopee และ Lazada แต่จำนวนสินค้าจริงอยู่ที่บริษัท หากแยกยอดตามร้านจะเสี่ยงนับสินค้าซ้ำ รุ่นนี้จึงเพิ่มสมุดสต็อกกลางหนึ่งคลังต่อบริษัท โดยใช้ canonical SKU จาก Catalog เป็นตัวอ้างอิง ทุกช่องทางในอนาคตต้องอ่านจาก authority ชุดนี้ก่อนคำนวณยอดพร้อมขาย

## พฤติกรรมทางธุรกิจ

- Catalog มีทางเข้า **จัดการสต็อก** สำหรับ owner, finance, operator และ auditor ที่มีสิทธิ์สินค้า
- owner/finance/operator บันทึกได้; auditor อ่านได้; marketing ไม่มีสิทธิ์เห็นหน้าหรือ API สต็อก
- ระยะแรกมี **คลังหลัก** หนึ่งแห่งต่อบริษัทและใช้ยอดร่วมกันทุกช่องทางขาย
- แสดง `คงเหลือจริง (on-hand)`, `จองแล้ว (reserved)` และ `พร้อมขาย (available = on-hand - reserved)` แยกชัดเจน
- รุ่นนี้ `reserved` ยังเป็นศูนย์ เพราะยังไม่เปิด order reservation ก่อนยืนยัน DEC-06
- รองรับตั้งยอดเริ่มต้น, รับสินค้าเข้า, ปรับเพิ่ม และปรับลดจากการตรวจนับ
- ผู้ใช้ต้องระบุ SKU, จำนวน, รหัสอ้างอิง, เหตุผล และยืนยันว่าตรวจเอกสารแล้ว
- รหัสอ้างอิงซ้ำใน SKU เดียวกันและ payload เดิมเป็น retry ที่ไม่เพิ่มยอดซ้ำ; หากข้อมูลต่างกัน ระบบปฏิเสธ
- ตั้งยอดเริ่มต้นได้เฉพาะก่อน SKU มีประวัติ; หลังจากนั้นใช้รับเข้าหรือปรับยอด
- ปรับลดจนต่ำกว่ายอดจอง/ศูนย์ไม่ได้ และคำสั่งพร้อมกันถูก serialize ที่ balance row
- ledger เป็น append-only; runtime role แก้ balance, แก้ movement หรือลบ movement โดยตรงไม่ได้

## ขอบเขตเทคนิค

- Migration `0030-inventory-stock-ledger.sql`
- ตาราง:
  - `app.inventory_locations` — คลังหลักต่อ tenant
  - `app.inventory_balances` — materialized on-hand/reserved ต่อ location + variant
  - `app.inventory_movements` — immutable manual movement พร้อม balance-after/provenance
- `app.record_inventory_movement(...)` เป็น security-definer command boundary ที่ตรวจ role, shop/product/variant, idempotency, row lock และ non-negative invariant ใน transaction เดียว
- RLS จำกัด tenant, role และ variant visibility; ไม่มี direct table write grant ให้ runtime
- API: `GET/POST /api/tenants/:tenantId/inventory`
- UI: `/catalog/:productId/inventory` รองรับ desktop/mobile และใช้ภาษางานคลัง
- stock quantity แยกจาก cost history; รุ่นนี้ไม่คำนวณ FIFO, average cost หรือมูลค่าสินค้าคงเหลือทางบัญชี

## สิ่งที่ยังไม่อ้างว่าเสร็จ

- ไม่มี reservation, allocation, expiry, commit/release หรือ order state
- ไม่มีการหักสต็อกจาก Statement, paid order หรือ marketplace webhook
- ไม่มีการส่งยอดกลับ TikTok Shop, Shopee หรือ Lazada และไม่อ้างว่าเป็นยอด realtime ของแต่ละช่องทาง
- ไม่มีหลายคลัง, transfer, stocktake session, lot/expiry/serial, bundle/BOM หรือหน่วยทศนิยม
- ยังไม่กำหนดกติกา inbound authority, oversell, safety stock และ valuation ตาม DEC-06
- ยังไม่ใช่ระบบบัญชีสินค้าคงเหลือหรือหลักฐาน production

## Verification

- Integration **151/151 ผ่าน**; เพิ่ม 7 cases ครอบคลุม movement/balance, adjustment, negative guard, idempotent retry/conflicting reference, opening-only-once, concurrent reduction, role/tenant boundary และ direct SQL denial
- Browser inventory **2/2 ผ่าน** ครอบคลุม Catalog → stock, receipt, duplicate retry, insufficient stock และ viewport 390×844
- TypeScript, ESLint และ whitespace check ผ่านก่อน final build

## งานถัดไป

ทำ OPS-AG-01b เป็น decision-ready reservation/order-state contract: ปิด DEC-06 เรื่อง source of truth, paid-before-reserve, shortage, cancellation, return-to-stock, safety stock และสิทธิ์ผู้อนุมัติ แล้วจึงเพิ่ม reserve/commit/release/expiry และ AG-T04/05/06 โดยยังไม่เปิด marketplace write ระหว่างที่กติกายังไม่ผ่านการยืนยัน
