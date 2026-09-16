# Foundation v0.1 — 2026-09-16

เอกสารนี้บันทึก Foundation รอบแรก ขอบเขตปัจจุบันเพิ่มรายละเอียดสินค้าแบบ dynamic, หลาย SKU และ CSV draft preview แล้ว ดู [Product workflow v0.2](12-product-ux-and-import-preview.md) คำสั่งเริ่มแอปและบัญชีเดโมด้านล่างยังใช้ได้

## สิ่งที่ทดลองได้

- เข้าสู่ระบบ local-demo, session อายุ 8 ชั่วโมง, logout ลบ session และเลือกบริษัท/ร้านตามสิทธิ์
- สร้างบริษัทและร้าน; เจ้าของเปลี่ยนบทบาท/ระงับสมาชิกที่มีอยู่ ยกเว้นตัวเอง; ยังไม่มี invitation flow
- catalog ใช้ product → variant/SKU, category, sales unit และ attributes กลาง ทั้งกางเกง สกินแคร์ และแก้วน้ำ
- ค้นหา/กรองสินค้า เพิ่มสินค้าใหม่พร้อม SKU เริ่มต้นหนึ่งรายการ; สินค้าไม่มีตัวเลือกใช้ attributes ว่าง ไม่จำเป็นต้องมีสี/ไซซ์
- ราคากับต้นทุนเก็บเป็นจำนวนสตางค์ แยกตารางต้นทุนและวันมีผล; ต้นทุนไม่ทราบเป็น null ผู้ใช้การตลาดและ operator ไม่มีสิทธิ์อ่านต้นทุน
- audit สำหรับการเปลี่ยนข้อมูลและ AI runs; runtime เขียน audit เพิ่มได้แต่แก้หรือลบไม่ได้
- หน้า AI ทดสอบ typed tool อ่าน catalog ภายในขอบเขตผู้ใช้/ร้านและแสดงหลักฐาน ไม่มีตัวเลขยอดขาย/กำไรที่สร้างขึ้น
- worker ใช้ pg-boss อ่าน catalog หลังตรวจสิทธิ์ล่าสุด และบันทึก audit

ยังไม่มี order import, settlement, profit calculation, stock movements, cost editing/history UI, product editing, multi-currency หรือ marketplace API สกินแคร์ในตัวอย่างยืนยัน catalog กลางเท่านั้น ไม่ใช่ batch/expiry tracking

## Stack ที่ติดตั้ง

Next.js App Router + React + TypeScript; PostgreSQL 17 + Drizzle/pg; Zod; pg-boss; AI SDK; Vitest + Playwright; npm workspaces โดยรุ่นถูกล็อกใน package-lock.json

ใช้ CSS และ self-hosted Noto Sans Thai สำหรับหน้าจอชุดแรก เลือก npm ตาม runtime ใน workspace นี้แทนเพิ่ม package manager ใหม่ โครงสร้างแยก apps/web, apps/worker และ packages/db, domain, contracts, ai ไม่มี microservices เพิ่มในรอบนี้

## เริ่มใช้งาน

ทำตามคำสั่งใน README `.env` สร้างรหัสผ่านฐานข้อมูลแบบสุ่มและไม่อยู่ใน source control; คำสั่ง env:init ไม่ทับไฟล์เดิม Docker เก็บข้อมูลใน named volume และเปิด PostgreSQL เฉพาะ loopback พอร์ต 55432

APP_ORIGIN เริ่มต้น http://127.0.0.1:3001 ต้องตรงกับ URL ที่เปิดและพอร์ตของแอป เปลี่ยนใน .env หากพอร์ตชน ระบบตรวจ Origin ของคำสั่งแก้ข้อมูล

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

ใช้ dev หรือ start ครั้งละตัวบนพอร์ตเดียวกัน Build โหลด .env ผ่าน launcher แทนส่ง --env-file ต่อให้ Next.js workers

### บัญชีสมมติ

ทุกบัญชีใช้รหัสผ่าน `StudioDemo!2026` ห้ามใช้บัญชีหรือรหัสผ่านนี้ใน production:

| บัญชี | สิทธิ์ |
|---|---|
| owner@chino.demo | owner บริษัท Chino Studio มี TikTok / Shopee |
| owner@goods.demo | owner บริษัท Everyday Goods |
| marketing@chino.demo | marketing, อ่าน catalog โดยไม่มีต้นทุน |
| advisor@commerce.demo | auditor สองบริษัท สลับบริษัทได้ |
| staff@chino.demo | operator เฉพาะร้าน TikTok ใน Chino Studio |

ชื่อแพลตฟอร์มในร้านเป็นป้ายข้อมูลเดโม ไม่ได้แปลว่าเชื่อมบัญชี marketplace แล้ว Seed เป็น idempotent และไม่ลบข้อมูลที่เพิ่มเอง

## การแยกข้อมูลและสิทธิ์

DATABASE_URL ใช้ commerce_app ที่ไม่ใช่ table owner, superuser หรือ BYPASSRLS ทุกตารางธุรกิจ FORCE RLS และใช้ composite tenant foreign keys Session กำหนด actor; membership และ shop grant ตรวจฝั่ง server และฐานข้อมูล การตั้ง context ใช้ transaction-local เพื่อไม่ค้างใน pool

IDENTITY_DATABASE_URL ใช้ role แยกอ่านผู้ใช้และจัดการ session ไม่มีสิทธิ์ตารางธุรกิจ QUEUE_DATABASE_URL ใช้ role แยกเฉพาะ schema jobs Worker ใช้ runtime app role อีก connection เมื่อต้องอ่านธุรกิจ ADMIN_DATABASE_URL มีไว้ migration/seed/isolated tests ไม่ใช้ทำคำขอเว็บ

Production ต้องเปลี่ยน local identity adapter เป็นผู้ให้บริการ identity ที่ตรวจรับแล้ว พร้อม invitation, MFA/SSO/SCIM ตาม requirement ไม่มีการอ้างว่า version นี้ผ่าน Enterprise certification ระบบ RLS อาศัย application server ที่เชื่อถือได้ในการตั้ง actor จึงต้องเก็บ credentials เฉพาะ server และไม่ให้ผู้ใช้ต่อฐานข้อมูลโดยตรง

## AI ตั้งแต่ Foundation

ค่าเริ่มต้น AI_ENABLED=false หน้า tool-preview ทำงานแบบ deterministic ระบุชัดว่าไม่ได้เรียกโมเดล นับ usage เป็นศูนย์ บันทึก run/evidence เพื่อทดสอบ permission boundary และ UI

มี live adapter ผ่าน AI SDK Gateway แต่ **ยังไม่ได้เรียกหรือประเมินโมเดลจริง** ต้องกำหนด AI_ENABLED=true, AI_GATEWAY_API_KEY และ AI_MODEL โดยผู้ดูแลภายหลังตรวจข้อมูลที่จะส่งออก/ผู้ให้บริการ

เครื่องมือ readCatalog ผูก tenant/actor/shop ฝั่ง server โมเดลส่ง tenant เป้าหมายไม่ได้ ผล tool ไม่ส่งราคา/ต้นทุน อ่านสูงสุด 200 SKU และตัวอย่าง 12 SKU จึงไม่ใช่รายงาน catalog ทั้งหมด ข้อความชื่อสินค้าเป็น untrusted data

Live run จำกัด 3 steps, output 600 tokens ต่อ step, timeout 45 วินาที, ไม่มี model retry; บังคับเรียก tool ใน step แรก จำกัดหนึ่ง live run พร้อมกันและ 20 live runs ต่อ tenant ใน 24 ชั่วโมงย้อนหลัง Preview 100 ครั้งใน 24 ชั่วโมงย้อนหลัง ตรวจ quota แบบ atomic และตรวจสิทธิ์อีกครั้งก่อนบันทึกผล

Request quota ไม่ใช่วงเงินดอลลาร์สูงสุด hard cap: token usage ที่รายงานไม่ใช่ใบแจ้งหนี้ และ rate ที่กำหนดเองใช้ประมาณการเท่านั้น ถ้าไม่กำหนดราคาแสดงว่าไม่ทราบ Failed/timeout run อาจมีค่า provider แม้ยังไม่ได้ usage กลับมา ต้องเพิ่ม reconciliation และ spend enforcement ก่อนขายจริง

ก่อนเปิด live model ต้องมี evaluation สำหรับ grounding, prompt injection, tenant isolation, malformed output และ quality thresholds ชุดทดสอบตอนนี้ตรวจ preview และการปฏิเสธเมื่อไม่ได้ตั้งค่า live เท่านั้น

## Worker และการทดสอบ

เปิด terminal แยก:

```sh
npm run worker
```

แล้วตรวจงานคิวจริง:

```sh
node --env-file-if-exists=.env --import tsx scripts/check-worker.ts
```

Worker reauthorizes tenant/shop ตอน execute ไม่เชื่อ ID ใน payload ลำพัง งานทดลองเป็นการอ่านและเพิ่ม audit; delivery แบบ at-least-once อาจมี audit ซ้ำ ยังไม่ใช่ import worker ที่รองรับ exactly-once financial effects หรือ transactional outbox

`npm test` สร้างฐานข้อมูลชื่อสุ่ม commerce_test_*, migrate/seed ทดสอบ แล้วลบเฉพาะฐานข้อมูลที่สร้างในรอบนั้น ไม่ทดสอบการเปลี่ยนข้อมูลในฐานข้อมูลเดโม ต้องใช้ admin บน PostgreSQL เครื่องพัฒนา อย่าตั้ง ADMIN_DATABASE_URL เป็น production

Browser test ใช้แอปที่เปิดอยู่และข้อมูล synthetic เท่านั้น มีการเพิ่มสินค้าทดสอบ:

```sh
npx playwright install --with-deps chromium
npm run test:e2e
```

CI workflow ใน .github/workflows/checks.yml ใช้ PostgreSQL service ชั่วคราวสำหรับ checks/build/production browser test/worker check ยังไม่ได้รันบน GitHub จนกว่าจะนำ repository ขึ้นไป

## ขั้นต่อไปและ release gate

1. รับไฟล์รายงานจริงที่ลดข้อมูลส่วนบุคคลแล้ว: orders, settlement/fees, ads และต้นทุน SKU พร้อมช่วงเวลาเดียวกัน
2. ยืนยันนิยามตัวเลขและ source mapping แล้วเพิ่ม import preview/validation/reject rows โดยไม่สมมติ schema marketplace
3. ทำ reconciliation และ deterministic calculation พร้อม golden tests ก่อนให้ AI อธิบายกำไร
4. ก่อน pilot จริง: production identity, secrets hosting, object storage policies, backup/restore rehearsal, retention, monitoring และตรวจ load/security/AI eval ตามเอกสาร 05/06

ฐานข้อมูลมี persistence ใน Docker volume แต่ยังไม่ใช่ backup ที่ตรวจ restore แล้ว Audit ป้องกัน runtime แก้ไข ไม่ใช่ immutable storage ที่ป้องกัน database administrator ไม่เปิดแอปออกสาธารณะจาก foundation นี้
