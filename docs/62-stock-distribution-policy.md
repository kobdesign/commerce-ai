# OPS-AG-02a — Stock Distribution Policy

วันที่: 2026-10-19
สถานะ: ส่งมอบใน local ด้วยข้อมูลสมมติ; ยังไม่มี Marketplace connector หรือ outbound write

## ปัญหาที่แก้

สต็อกจริงหนึ่งกองอาจถูกนำไปขายหลายช่องทาง ผู้ใช้ต้องระบุให้ชัดว่า SKU ใช้กองกลางร่วม, แบ่งโควตาคงที่ หรือใช้กองกลางพร้อมเพดานรายช่องทาง ระบบจึงต้องแยก **นโยบายภายใน** ออกจาก **ยอดที่ Marketplace แสดงจริง** และห้ามอ้างว่า sync แล้วเมื่อยังไม่มี provider evidence

## พฤติกรรมที่ส่งมอบ

- หน้า `/inventory/settings` ตั้งค่าเริ่มต้นระดับบริษัท: Shared Pool, Fixed Quota หรือ Hybrid พร้อม Safety stock ต่อ SKU
- หน้า `/inventory/:variantId/distribution` เลือกใช้ค่าบริษัทหรือ override ราย SKU
- Shared Pool ใช้ยอดพร้อมจัดสรรก้อนเดียวกันโดยไม่สร้างจำนวนแยกร้าน
- Fixed Quota ต้องกรอกทุกช่องทางและปฏิเสธเมื่อผลรวมมากกว่ายอดพร้อมจัดสรร ณ ตอนบันทึก
- Hybrid กำหนดเพดานรายช่องทางซึ่งรวมกันสูงกว่าสต็อกได้ เพราะไม่ได้กันสินค้าออกจากกองกลาง
- สูตร `พร้อมจัดสรร = on-hand − reserved − safety stock` โดยค่าต่ำสุดเป็น 0
- หน้าสต็อกกลางแสดง mode, แหล่งค่าบริษัท/SKU, Safety stock, พร้อมจัดสรร และจำนวนที่กำหนดรายช่องทาง
- ทุกช่องทางยังแสดง `ยอดบนช่องทาง: ยังไม่เชื่อม` และไม่มี command ส่งออก provider
- การแก้ใช้ optimistic version และบันทึก audit event; การกลับไปใช้ค่าบริษัทลบเฉพาะ override โดยไม่แตะ ledger/reservation

## สิทธิ์และการแยกข้อมูล

- Owner และ Finance อ่านและแก้ไขได้
- Operator และ Auditor อ่านได้ตาม shop grant แต่แก้ไม่ได้
- Marketing ไม่มีสิทธิ์อ่าน
- ตารางใหม่ทั้งสามใช้ tenant key, FORCE RLS, `variant_allowed` และ `shop_allowed`
- ผู้ใช้ที่ได้สิทธิ์เฉพาะ TikTok จะไม่เห็นหรือกำหนดจำนวนของ Shopee

## โครงสร้างข้อมูล

- `inventory_distribution_defaults`: ค่าเริ่มต้นระดับ tenant
- `inventory_distribution_policies`: override ต่อ canonical variant/SKU
- `inventory_channel_policies`: quota หรือ exposure cap ต่อ SKU และ shop

ลำดับค่า effective คือ `SKU override → company default → fallback Hybrid / Safety stock 0` ค่า fallback ช่วยให้ tenant เดิมเปิดหน้าได้โดยไม่ต้อง backfill แถวข้อมูล

## Verification

- Integration 29 files / 200 cases ผ่าน รวม company default, Hybrid 70/60 บนกองกลาง 100, Safety stock 10, Fixed quota guard, inherit, stale version, audit, role/shop/tenant isolation
- Browser flow ผ่าน: ตั้งค่า company Hybrid → ทดลอง Fixed 50+50 และเห็น guard เมื่อจัดสรรได้ 90 → บันทึก Hybrid TikTok 70/Shopee 60 → ตรวจผลบนสต็อกกลาง
- Mobile 320px ไม่เลื่อนแนวนอน; ภาพ `artifacts/inventory-distribution-policy-320.png`
- TypeScript, ESLint, production build และ browser regression สต็อก/จองรวม 6 cases ผ่าน

## ขอบเขตที่ยังไม่ทำ

- ไม่มี Marketplace API/webhook, published quantity, sync timestamp, retry หรือ reconciliation
- ไม่มีการลด quota รายช่องทางจากออเดอร์จริง; order ยังใช้ reservation กลางเดิม
- ยังไม่มีหลายคลัง, percentage safety stock, priority allocation หรือ campaign schedule
- ก่อน controlled write ต้องกำหนด freshness SLA, idempotency, drift handling, provider rate limits, kill switch และ reconciliation ต่อ provider
