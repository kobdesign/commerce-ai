# CAT-AG-01b — Channel listing mapping v1.21

วันที่ส่งมอบ: 9 ตุลาคม 2026
สถานะ: **Local synthetic complete · Stage C catalog identity complete · ยังไม่เชื่อม marketplace API**

## ปัญหาที่แก้

SKU ภายในบริษัทกับ Product ID / Variant ID บน TikTok Shop, Shopee, Lazada หรือช่องทางตรงไม่จำเป็นต้องเหมือนกัน รุ่นนี้เพิ่มความสัมพันธ์ที่ตรวจสอบย้อนกลับได้ระหว่าง canonical SKU กับรหัสของร้านที่เลือก เพื่อเตรียม order, inventory และ connector โดยไม่ผูก core catalog กับ schema ของแพลตฟอร์มใดแพลตฟอร์มหนึ่ง

## พฤติกรรมทางธุรกิจ

- จากสินค้าใน Catalog ผู้มีสิทธิ์ owner/finance เปิด **เชื่อมช่องทางขาย** ได้
- เลือก canonical SKU แล้วระบุ External Product ID และ External Variant/Model ID; รองรับ SKU และชื่อรายการขายเป็นข้อมูลช่วยตรวจ
- ช่องทางมาจากร้านที่เลือก จึงไม่มี dropdown ที่ทำให้เผลอผูกข้ามร้าน
- การสร้างแบบ manual ต้องติ๊กยืนยันว่าผู้ใช้ตรวจรหัสจาก Seller Center แล้ว
- เก็บ source=`manual`, ผู้ยืนยัน, เวลา, ร้าน, SKU และ audit event ทุกครั้ง
- external identity หนึ่งชุดในร้านมี active mapping ได้เพียง canonical SKU เดียว
- canonical SKU หนึ่งรายการมีหลาย listing ได้ เช่น หลาย listing ในร้านเดียวหรือคนละร้าน
- ไม่แก้ external identity ในรายการเดิม หากเชื่อมผิดให้ยกเลิกพร้อมเหตุผลแล้วสร้างรายการใหม่ ประวัติเดิมจึงไม่ถูกเขียนทับ
- นำรายการที่ยกเลิกกลับได้เมื่อ external identity นั้นยังไม่ถูกใช้โดย active mapping อื่น
- ใช้ optimistic version ป้องกันแท็บเก่าเปลี่ยนสถานะทับข้อมูลล่าสุด
- สินค้าหรือ SKU ที่หยุดขายยังเก็บ listing history ได้ เพราะ sellability กับ identity เป็นคนละเรื่อง

## ขอบเขตเทคนิค

- Migration `0029-channel-listing-mappings.sql`
- ตาราง `app.channel_listing_mappings` มี tenant/shop/variant composite references, provenance, verification, reversible lifecycle และ partial unique index เฉพาะรายการ active
- RLS บังคับ tenant, shop grant, product visibility และสิทธิ์แก้สินค้าที่เชื่อมหลายร้านครบทุกชั้น
- Runtime role แก้ external identity, source หรือ verification record เดิมไม่ได้ และลบ record ไม่ได้
- API:
  - `GET/POST /api/tenants/:tenantId/listing-mappings`
  - `PATCH /api/tenants/:tenantId/listing-mappings/:mappingId`
- UI: `/catalog/:productId/listings` พร้อม desktop/mobile layout, confirmation, duplicate feedback และประวัติที่ยกเลิก

## สิ่งที่ยังไม่อ้างว่าเสร็จ

- ไม่มีการเรียก TikTok/Shopee/Lazada API และยังไม่ตรวจรหัสกับแพลตฟอร์มอัตโนมัติ
- ไม่มีการ publish/แก้ราคา/หยุด listing หรือ sync สถานะออกไปภายนอก
- ไม่มี inventory quantity, warehouse/location, reservation, stock ledger หรือ valuation
- ไม่มี bulk mapping/import mapping และยังไม่ใช้ mapping นี้แปลง Statement อัตโนมัติ
- การยืนยัน manual เป็นหลักฐานว่าผู้ใช้ยืนยัน ไม่ใช่หลักฐานว่า marketplace รับรองข้อมูล

## Verification

- Integration **144/144 ผ่าน** รวม mapping ใหม่ 5 cases: provenance, uniqueness, many-listings-per-SKU, correction/history, restore conflict, confirmation/reason/version, role/tenant/product boundary และ database privilege/RLS
- Browser mapping **2/2 ผ่าน** ครอบคลุม create → duplicate rejection → archive → corrected mapping → restore conflict และ viewport 390×844
- Browser scenarios ทั้ง 32 cases มีหลักฐานผ่านบนโค้ดรุ่นนี้: full run ผ่าน 27 cases; 4 import cases ผ่านเมื่อเปิด worker ที่เป็น dependency; settlement case ที่เหลือผ่านบนฐานข้อมูลทดสอบสะอาด หลังพบว่าฐาน local สะสมรายการเกิน display limit
- TypeScript, ESLint, production build และ whitespace check ผ่าน

## งานถัดไป

เริ่ม OPS-AG-01a: กำหนด inventory authority และทำ stock ledger พื้นฐานแบบคลังเดียว แยก on-hand, reserved และ available พร้อม idempotent movements โดยยังไม่เปิด marketplace write หรือ reservation อัตโนมัติจน DEC-06 ผ่าน
