# Requirements และสิทธิ์

## Functional requirements

| ID | Requirement | เกณฑ์ตรวจรับหลัก |
|---|---|---|
| FR-01 | Organization context | ผู้ใช้สลับองค์กรได้เฉพาะ membership ที่ยังมีผล; ไม่มีบริบทต้องปฏิเสธ |
| FR-02 | ขอบเขตบริษัท/ร้าน | ทุกการอ่าน แก้ไข ส่งออก และ AI tool ตรวจร้านที่อนุญาต |
| FR-03 | นำเข้าไฟล์ | จำกัดชนิด/ขนาด ตรวจ schema เก็บ checksum และรายงานแถวผิด |
| FR-04 | AI mapping | AI เสนอ mapping พร้อมตัวอย่างหลักฐาน; schema/ยอดรวมตรวจด้วยโค้ด; mapping มี version และการยืนยัน |
| FR-05 | Canonical SKU | จับคู่รหัสสินค้า/ตัวเลือกแต่ละช่องทางกับ SKU กลาง; attributes ไม่จำกัดสี/ไซซ์; รายการกำกวมรอคนตรวจ |
| FR-06 | Cost history | เก็บต้นทุนพร้อมวันที่มีผล; แก้ต้นทุนไม่เขียนทับผลอดีตอย่างเงียบ ๆ |
| FR-07 | Settlement reconciliation | หนึ่งออเดอร์มีหลายรายการเงินได้; unmatched ไม่เท่ากับแพลตฟอร์มทำผิด |
| FR-08 | Contribution metrics | แยกรายได้ เงินรับ เงินเหลือก่อน/หลังแอด ค่าใช้จ่ายบริษัท; missing cost ไม่ใช่ zero |
| FR-09 | AI analysis | เรียก typed tools; คำตอบมีหลักฐาน ช่วงเวลา freshness และข้อจำกัด |
| FR-10 | Review inbox | เปิดรายละเอียด สร้างงาน มอบหมาย และบันทึกการตรวจได้ตามสิทธิ์ |
| FR-11 | Evidence & audit | ตรวจถึงไฟล์/แถว/รายการเงินและสูตรรุ่นที่ใช้ได้; ผู้ใช้ทั่วไปแก้ audit ไม่ได้ |
| FR-12 | Usage & budgets | จำกัดรอบการเรียก tool และงบ AI ต่อ run/tenant; เกินงบหยุดอย่างอธิบายได้ |
| FR-13 | Category-neutral catalog | Product/Variant/Attributes/หน่วยขายแยกกัน; สินค้าไม่มีตัวเลือกใช้ default variant; catalog และ metadata แยก tenant |
| FR-14 | Category-aware evidence | แยก internal category กับ marketplace category; fee facts/กฎตาม shop/category/date มี provenance; AI ไม่อนุมาน fee หรือคุณสมบัติที่ไม่มีหลักฐาน |

## Permission baseline

เป็นข้อเสนอเริ่มต้น ต้องให้ผู้ใช้ยืนยันก่อนใช้ production ทุกสิทธิ์จำกัดตาม legal entity/shop grant อีกชั้น

| ความสามารถ | Owner | Finance | Operator | Marketing | Auditor |
|---|---|---|---|---|---|
| จัดการสมาชิก/นโยบาย | ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| นำเข้ารายงานการเงิน/แก้ mapping | ได้ | ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| อ่านยอดขายที่อนุญาต | ได้ | ได้ | ได้ | ได้ | ได้ |
| อ่าน/แก้ต้นทุน | ได้ | ได้ | ไม่ได้ | ไม่ได้ | อ่าน |
| อ่านกำไรและ settlement | ได้ | ได้ | ไม่ได้ | ไม่ได้ | ได้ |
| อ่านค่าแอด | ได้ | ได้ | ไม่ได้ | ได้ | ได้ |
| Export การเงิน | ได้ | ได้ | ไม่ได้ | ไม่ได้ | ตาม grant เพิ่ม |
| ถาม AI | ตามสิทธิ์ | ตามสิทธิ์ | ตามสิทธิ์ | ตามสิทธิ์ | ตามสิทธิ์ |

AI ต้องไม่เปิดเผยข้อมูลที่ห้ามผ่านผลรวม สรุป ความจำ หรือหลักฐาน ตัวอย่าง Marketing ที่ไม่มีสิทธิ์ต้นทุน/กำไรจะเรียก profit tool ไม่ได้ แม้ไม่ได้ขออ่านคอลัมน์ต้นทุนตรง ๆ

Platform support ไม่มีสิทธิ์อ่านข้อมูลลูกค้าโดยปริยาย การเข้าถึงช่วยเหลือต้องจำกัดเวลา ขอบเขต เหตุผล และมี audit

## Non-functional requirements

| ID | ข้อกำหนด | หลักฐานตรวจรับ |
|---|---|---|
| NFR-01 | Tenant isolation ครบทุก storage/compute path | tests: API, DB, files, exports, caches, queue, chat, tools |
| NFR-02 | Financial integrity | exact decimal/minor-unit arithmetic และ golden fixtures |
| NFR-03 | Idempotent ingestion | ส่งไฟล์/event เดิมซ้ำแล้วไม่เพิ่มยอด; correction แยกจาก duplicate |
| NFR-04 | Recoverability | restore rehearsal สำเร็จ; กำหนด RPO/RTO หลังทราบ hosting |
| NFR-05 | Traceability | run/request/import IDs เชื่อมหลักฐานได้ โดย redact ข้อมูลไม่จำเป็น |
| NFR-06 | Graceful degradation | โมเดลล่มยังดูตัวเลขและตรวจรายงานเองได้; ไม่เปลี่ยน provider ขัดนโยบาย |
| NFR-07 | Fair usage | quota/concurrency แยก tenant; งานใหญ่ไม่ยึด worker ทั้งหมด |
| NFR-08 | Data lifecycle | กำหนด retention/delete/export ครอบคลุม raw files, derived data, AI และ backup lifecycle |
| NFR-09 | Security baseline | secrets แยก environment, encryption, admin MFA, dependency/secret scans |
| NFR-10 | Performance | ตั้งเกณฑ์ด้วยจำนวนออเดอร์/ขนาดไฟล์ที่สำรวจจริง; ยังไม่กล่าวอ้าง throughput |

## Enterprise roadmap

รากฐาน MVP: tenant grants, audit, entitlement, usage, policy settings, export, routing abstraction และ approval data model

เปิดก่อนรับลูกค้าที่ต้องใช้: SAML/OIDC SSO, SCIM, custom roles, multiple approval levels, SIEM export, dedicated resources, regional residency, customer-managed keys, ERP integration, SLA/DR ตามสัญญา

เอกสารนี้ไม่ใช่การรับรอง compliance หรือคำสัญญาว่าฟีเจอร์ roadmap เปิดใช้แล้ว
