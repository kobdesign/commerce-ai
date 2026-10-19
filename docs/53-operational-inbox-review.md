# INT-AG-01c — Operational Event Inbox v1.27

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Human-confirmed operations · No business mutation**

## ผลลัพธ์

หน้า `/integrations/inbox` ทำให้ owner, operator และ auditor ตรวจ event แยกตามร้านได้ โดยค้นจาก provider event ID, event type, stream ID หรือ namespace และกรอง provider/reconciliation/operational status ได้ รายการแสดง event identity, sequence เทียบ cursor, จำนวนลำดับที่ขาด, received/occurred time และ disposition

Browser รับเฉพาะ safe evidence projection ได้แก่ SHA-256, verification result/method/key reference, adapter version และชื่อ field ของ payload ระบบไม่ serialize ค่าภายใน payload ไปยังหน้า review

## Operational state และคำสั่ง

- `observed`: event พร้อมส่งต่อและไม่ต้องอยู่ในคิวติดตาม
- `open`: gap, stale, unordered หรือลายเซ็นผิดที่ต้องติดตาม
- `replay_requested`: ผู้ใช้ยืนยันคำขอประมวลผลใหม่แล้ว
- `resolved`: ผู้ใช้ตรวจและปิดการติดตามแล้ว

`request_replay` และ `acknowledge` ต้องมีเหตุผลอย่างน้อย 3 ตัวอักษร, checkbox ยืนยัน และ expected version คำสั่งพร้อมกันจึงสำเร็จได้เพียงหนึ่งรายการ ทุกคำสั่งเก็บ actor/time/reason/version ใน `integration_inbox_actions` และ `audit_events`

Replay สร้าง `integration.inbox_replay_requested.v1` ใน Transactional Outbox ส่วนการปิดติดตามสร้าง `integration.inbox_resolved.v1` ไม่มีคำสั่งใดเปลี่ยน Order, Inventory หรือข้อมูลการเงิน Event ที่ลายเซ็นไม่ผ่านถูกห้าม replay แต่ปิดการติดตามพร้อมหลักฐานได้

## Metrics และ UX

- แสดงจำนวน open, open gaps, invalid signatures และอายุรายการเปิดที่เก่าที่สุด
- SLA review เริ่มต้น 15 นาที; overdue/gap แสดง attention และ invalid signature แสดง critical
- auto-recovered gap เปลี่ยนจาก `open` เป็น `observed` เพื่อไม่สร้าง alert ค้าง
- หน้า desktop/mobile ใช้โครงสร้างรายการเดียวกัน ปุ่ม action มี dialog อธิบายผล เหตุผล และ human confirmation

## สิทธิ์

- owner/operator: อ่านและทำ replay/acknowledge
- auditor: อ่านอย่างเดียว
- finance/marketing/tenant อื่น: ไม่เห็นหน้าและไม่อ่าน record ผ่าน RLS
- runtime role ไม่มี direct DML; transition ผ่าน security-definer function ที่ตรวจ role/shop/current version อีกครั้ง

## หลักฐานตรวจรับ

Integration operational cases 5/5 ผ่าน:

1. safe evidence projection, cursor gap และ SLA metrics โดยไม่มี payload values
2. replay → acknowledge พร้อม action history, versioned Outbox และ audit
3. invalid signature ห้าม replay แต่ปิดติดตามได้
4. concurrent command ด้วย expected version สำเร็จเพียงหนึ่ง
5. operator write, auditor read-only และ marketing isolation

Browser 2/2 ผ่าน:

1. desktop เปิด safe evidence, replay และปิดติดตามครบ flow
2. mobile 390×844 ไม่ล้นจอและ invalid signature ไม่มี replay action

Regression รวม `184/184` ผ่าน พร้อม typecheck, lint และ production build

## ข้อจำกัด

- SLA เป็น threshold ใน workspace ยังไม่ส่ง alert ไป incident channel
- replay เป็น durable request event; ยังไม่มี provider-specific processor หรือ business command consumer
- safe projection ใช้ allowlist กลาง; adapter จริงยังต้องกำหนด PII minimization/retention ตาม provider
- service role สำหรับ ingress ยังเป็น deployment-wide `commerce_queue`; ต้องเพิ่ม delegated service identity ก่อน production connector

## งานถัดไป

AUTH-AG-01a ส่งมอบแล้วใน [Service Principal v1.28](54-service-principal-delegation.md) งานต่อคือ rotation, audience binding และ usage telemetry ก่อนเชื่อม provider จริง
