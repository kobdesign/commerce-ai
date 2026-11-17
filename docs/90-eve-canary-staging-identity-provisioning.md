# EVE-CANARY-13 — Staging Identity and Secret Provisioning

สถานะ: **Partial / configured, awaiting Commerce Core deployment**
วันที่: 17 พฤศจิกายน 2026

## ผลที่ทำแล้ว

- สร้าง Ed25519 key pair สำหรับ staging และแยกขอบเขตตามสถาปัตยกรรม
  - Render/Core เก็บ private signing key
  - Vercel Preview เก็บเฉพาะ public verification key
- ตั้ง key ID เดียวกันทั้งสองฝั่ง: `commerce-agent-staging-20261116-1`
- Render ยังคง `COMMERCE_AGENT_EVE_ENABLED=false`, kill switch เป็น `true` และ dynamic routing เป็น `false`
- Vercel Preview ยังคง `COMMERCE_AGENT_LIVE_AI=false`
- ตั้ง canary policy metadata ใน Vercel Preview: approval ID, model allowlist, synthetic shop allowlist, owner role และ per-run limits
- ไม่มี database URL, marketplace secret, session private key หรือ direct provider API key ถูกส่งไป Vercel
- เก็บ raw service credential เป็น Secret เฉพาะ Vercel Preview แล้วตาม owner approval
- ตั้งค่า Commerce Core URL, environment และ synthetic tenant ID ใน Vercel Preview แล้ว
- Render รับเฉพาะ credential hash, prefix และ expiry และเปิด one-time bootstrap metadata แล้ว

## Service credential bootstrap

เพิ่ม [`scripts/provision-agent-staging-principal.ts`](../scripts/provision-agent-staging-principal.ts) สำหรับสร้าง read-only service principal เฉพาะ `staging-demo` โดย:

- Render รับเฉพาะ SHA-256 hash, prefix และวันหมดอายุ
- raw `svc_` credential มีปลายทางเฉพาะ Vercel Preview
- principal ผูก tenant/shop ข้อมูลสมมติและ scope `catalog:read`, `sales:read`, `inventory:read`
- เรียก `app.create_service_principal` จึงยังผ่าน owner policy และสร้าง `service_principal.created` audit event
- rerun ด้วยค่าเดิมเป็น idempotent; หาก policy หรือ hash ไม่ตรงจะ fail startup
- ตัวแปร bootstrap ถูกลบจาก runtime environment ก่อนเริ่ม Next.js

Integration test ตรวจ create, rerun, scope, tenant/shop, audit event และยืนยันว่า raw credential ไม่ถูกบันทึกในฐานข้อมูลแล้ว ผลรวมทั้ง repository คือ 49 test files / 303 tests และ agent runtime 12 tests ผ่าน พร้อม TypeScript, ESLint และ Eve build บน Node 24 ผ่าน

## เหตุที่ยังไม่ Complete

Render deploy ที่เกิดจากการตั้ง environment ยังใช้ revision `main` เดิมซึ่งไม่มี bootstrap script จึงยังไม่สร้าง service principal ใน Commerce Core ต้อง merge และ deploy revision นี้ก่อน แล้วจึงทดสอบ read-only Product, Sales, Inventory และ cross-tenant rejection ได้

ไฟล์ credential ชั่วคราวถูกจำกัดสิทธิ์เป็น mode `0600` และจะถูกลบหลังการตรวจสอบสำเร็จ Live AI ยังปิด, Render routing ยังปิด และ staging gate ยังคง `blocked / no-go`

## ขั้นต่อไป

1. review และ merge revision ที่มี bootstrap script
2. รอ Render deploy และตรวจ audit event ของ principal
3. ทดสอบ Product, Sales และ Inventory read รวม cross-tenant rejection
4. ล้างค่า bootstrap จาก Render และลบ credential ชั่วคราวหลัง principal ถูกสร้าง
5. บันทึก metadata-only evidence และผูกหลักฐานเข้ากับ `preflightEvidence.stagingSecretProvisioning`

หลักฐาน machine-readable อยู่ที่ [`docs/evidence/eve-canary-staging-identity-2026-11-16.json`](evidence/eve-canary-staging-identity-2026-11-16.json)
