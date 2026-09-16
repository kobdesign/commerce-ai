# Local verification — 2026-09-16

ตรวจบน Node.js 22, PostgreSQL 17 ใน Docker และ Chromium กับ Next.js production build ที่ http://127.0.0.1:3001 ข้อมูลทั้งหมด synthetic

| Check | ผลที่ตรวจได้ |
|---|---|
| TypeScript | ผ่าน root typecheck และ production build typecheck |
| ESLint | ผ่าน ไม่ยอมให้มี warning |
| PostgreSQL/domain integration | 21 tests ผ่าน ในฐานข้อมูลชั่วคราวแยกจากฐานข้อมูลเดโม |
| Production build | ผ่าน รวมหน้าระบบและ API |
| Browser E2E | 5 tests ผ่าน บน production server |
| Worker smoke | ผ่าน enqueue → catalog read ภายใต้สิทธิ์ → tenant audit event |
| Visual review | เปิดและตรวจภาพ overview/catalog/mobile; ไม่มี browser errors ใน session ที่ตรวจ |

Integration suite ตรวจ runtime role ไม่ bypass RLS, context ว่าง/connection reuse, cross-company read/write, composite FK, shop grants, cost access, revoked membership, audit immutability สำหรับ runtime role, identity/queue separation, sessions, creation flows, category-neutral catalog, missing costs, strict input, self-demotion prevention, AI preview evidence และ quota

Browser suite ตรวจ login → เลือกร้าน → ค้นหา → เพิ่มสินค้าที่ไม่ใช่เสื้อผ้า → tool preview; forged tenant API และ cross-origin denial; marketing ไม่มีต้นทุนทั้ง UI/API; เปลี่ยนบริษัทและ logout; หน้า catalog ที่ความกว้าง 390px ไม่มี horizontal overflow ของทั้งหน้า ตารางและเมนูเลื่อนในพื้นที่ของตัวเอง

พบและแก้ระหว่างตรวจ: Next.js worker รับ --env-file argument ไม่ได้ (เพิ่ม launcher), pg-boss ต้องใช้ schema ที่ migration สร้างไว้ (createSchema:false), label ของ category รวมข้อความ datalist (แยกออกจาก label) พร้อมแก้ test ให้เลือกร้านและ heading ชัดเจน

ไฟล์ภาพตรวจหน้าจออยู่ใน artifacts/overview.png, catalog.png และ mobile.png (ไม่ commit artifacts) Browser tests เพิ่มสินค้าทดสอบไว้ในฐานข้อมูลเดโม

ข้อจำกัด: ไม่ได้เรียกโมเดลจริงหรือวัด AI answer quality; ไม่ได้ตรวจไฟล์ marketplace จริง/กำไร; ไม่ได้ทดสอบ load, restore, production identity หรือ Enterprise requirements; CI workflow จัดเตรียมไว้แต่ยังไม่ได้รันบน GitHub ผลนี้เป็นการตรวจ local foundation ไม่ใช่ production approval
