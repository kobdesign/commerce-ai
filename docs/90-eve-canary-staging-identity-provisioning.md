# EVE-CANARY-13 — Staging Identity and Secret Provisioning

สถานะ: **Complete / verified / fail-closed**
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
- PR #19 merge ที่ commit `492a8428deebbe76892bd6713262e08a5bad8965`
- Render bootstrap deploy `dep-dbu3lh942hec73bg2k10` สร้าง principal สำเร็จ
- Product, Inventory และ Sales read contract ผ่าน; tenant อื่นถูกปฏิเสธด้วย `403 SHOP_FORBIDDEN`
- Render bootstrap ถูกปิดและล้าง hash/prefix/expiry แล้ว; cleanup deploy `dep-dbu3mt0u01pc73dj39u0` เป็น `live`
- ลบ credential และ verification script ชั่วคราวจากเครื่องแล้ว

## Service credential bootstrap

เพิ่ม [`scripts/provision-agent-staging-principal.ts`](../scripts/provision-agent-staging-principal.ts) สำหรับสร้าง read-only service principal เฉพาะ `staging-demo` โดย:

- Render รับเฉพาะ SHA-256 hash, prefix และวันหมดอายุ
- raw `svc_` credential มีปลายทางเฉพาะ Vercel Preview
- principal ผูก tenant/shop ข้อมูลสมมติและ scope `catalog:read`, `sales:read`, `inventory:read`
- เรียก `app.create_service_principal` จึงยังผ่าน owner policy และสร้าง `service_principal.created` audit event
- rerun ด้วยค่าเดิมเป็น idempotent; หาก policy หรือ hash ไม่ตรงจะ fail startup
- ตัวแปร bootstrap ถูกลบจาก runtime environment ก่อนเริ่ม Next.js

Integration test ตรวจ create, rerun, scope, tenant/shop, audit event และยืนยันว่า raw credential ไม่ถูกบันทึกในฐานข้อมูลแล้ว ผลรวมทั้ง repository คือ 49 test files / 303 tests และ agent runtime 12 tests ผ่าน พร้อม TypeScript, ESLint และ Eve build บน Node 24 ผ่าน

## ผลตรวจรับ

principal ผูก tenant `20000000-0000-4000-8000-000000000001`, TikTok shop `30000000-0000-4000-8000-000000000001` และ scope `catalog:read`, `sales:read`, `inventory:read` เท่านั้น การทดสอบหลัง cleanup deploy ยืนยันว่า credential ยังอ่านข้อมูล synthetic ได้และ shop ของ tenant อื่นถูกปฏิเสธ

Live AI ยังปิด, Render routing ยังปิด และ staging gate ยังคง `blocked / no-go` เพราะยังไม่มี alert-delivery dry run, owner acknowledgement, change ticket และ canary window

## ขั้นต่อไป

1. ทำ external alert-delivery dry run และบันทึกหลักฐาน
2. บันทึก owner acknowledgement และออก change ticket
3. กำหนด time-boxed synthetic canary window ก่อนเปลี่ยน execution gate

หลักฐาน machine-readable อยู่ที่ [`docs/evidence/eve-canary-staging-identity-2026-11-16.json`](evidence/eve-canary-staging-identity-2026-11-16.json)
