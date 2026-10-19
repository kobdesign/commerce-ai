# CAT-AG-01a — Product และ SKU lifecycle v1.20

วันที่ส่งมอบ: 8 ตุลาคม 2026
สถานะ: **Local synthetic complete · เป็นฐาน Stage C · ยังไม่เชื่อม marketplace/inventory**

## ปัญหาที่แก้

ร้านต้องหยุดขายสินค้าหรือบางตัวเลือกชั่วคราวโดยไม่ลบ SKU ซึ่งเชื่อมกับต้นทุน Statement และประวัติการเงินเดิม รุ่นนี้เพิ่มวงจร `พร้อมขาย ↔ หยุดขาย` แบบย้อนกลับได้ทั้งระดับสินค้าและ SKU

## พฤติกรรมทางธุรกิจ

- หน้า Catalog เปิดที่แท็บ **พร้อมขาย** และมีแท็บ **หยุดขาย** กับ **ทั้งหมด**
- ผู้มีสิทธิ์แก้ Catalog หยุดขาย/เปิดขายทั้งสินค้า หรือเลือกทำเฉพาะ SKU ได้
- ทุก mutation ต้องระบุเหตุผล 3–500 ตัวอักษรและบันทึก actor/time/audit event
- หยุดขายทั้งสินค้าเป็น effective stop ของทุก SKU แต่ไม่เขียนทับสถานะราย SKU
- เมื่อเปิดสินค้ากลับ SKU ที่เคยหยุดขายเฉพาะรายการยังคงหยุดขาย
- เปิด SKU ไม่ได้ระหว่างที่สินค้าแม่หยุดขาย ต้องเปิดสินค้าแม่ก่อน
- ใช้ optimistic version ป้องกันแท็บเก่าเขียนทับสถานะล่าสุด
- สถานะไม่ลบ product/variant/cost history และไม่ reuse canonical SKU
- Statement ย้อนหลังยังจับคู่ SKU ที่หยุดขายได้ เพราะ lifecycle นี้ควบคุม sellability สำหรับงานอนาคต ไม่เปลี่ยนหลักฐานทางการเงินในอดีต

## ขอบเขตเทคนิค

- Migration `0028-product-lifecycle.sql` เพิ่ม `archived_at`, `archived_by`, `archive_reason` พร้อม consistency constraints และ indexes
- RLS/update policy เดิมยังบังคับ tenant, role และสิทธิ์ครบทุกร้านที่เชื่อมสินค้า
- Endpoint: `PATCH /api/tenants/:tenantId/products/:productId/lifecycle`
- Payload ระบุ `shopId`, product `version`, target product/variant, action และ reason
- Catalog API รองรับ `status=active|archived|all` และคืนจำนวน SKU แยกสถานะ
- UI ล้าง revision เก่าระหว่าง mutation/เปลี่ยนแท็บก่อน refetch เพื่อไม่ให้ผู้ใช้ส่งคำสั่งด้วย version เก่า

## สิ่งที่ยังไม่อ้างว่าเสร็จ

- ยังไม่มีจำนวนคงเหลือ, reservation, warehouse/location หรือ inventory valuation
- ยังไม่มี channel listing mapping และยังไม่ส่งคำสั่งหยุดขายไป TikTok/Shopee/Lazada
- `พร้อมขาย` หมายถึงสถานะภายใน Catalog เท่านั้น ไม่ได้ยืนยัน stock หรือสถานะหน้า marketplace
- ยังไม่มี bulk lifecycle, scheduled activation หรือ approval หลายชั้น

## Verification

- Integration **139/139 ผ่าน** รวม lifecycle ใหม่ 3 cases: SKU round trip/history, product effective stop/restore, role/tenant/version/reason boundaries
- Browser lifecycle **2/2 ผ่าน** บน desktop และ viewport 390×844
- Regression หลังแก้ live-status ผ่าน: Foundation/Product Update **13/13**; financial/support cases ที่เหลือผ่านใน full regression
- Browser รวม 30 scenarios มีหลักฐานผ่านบนโค้ดรุ่นนี้
- TypeScript, ESLint, production build และ whitespace check ผ่าน
- ตรวจภาพและ accessibility tree ของ Catalog และ lifecycle dialog ผ่าน local Chromium

## งานถัดไป

ทำ CAT-AG-01b: **channel listing mapping** ผูก canonical variant กับ platform/shop/listing ID โดยเก็บ provenance, uniqueness, lifecycle และสิทธิ์ข้ามร้าน ก่อนเริ่ม inventory/reservation
