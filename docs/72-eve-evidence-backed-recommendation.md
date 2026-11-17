# EVE-POC-07 — Evidence-Backed Recommendation

วันที่ตรวจรับ: 13 พฤศจิกายน 2026
สถานะ: **Complete ในขอบเขต synthetic read-only / live AI ปิด**

## ผลลัพธ์

Commerce Lead สามารถตอบคำถามตัวอย่าง “ควรโปรโมตสินค้าใดโดยไม่สร้างความเสี่ยงของขาดสต็อก” โดยทุก recommendation ต้องผ่านการตรวจหลักฐานจาก Commerce Core ก่อนสร้างคำตอบ ระบบไม่ใช้ข้อเท็จจริงจาก prose ของ specialist เป็น source of truth และไม่มี mutation tool

เส้นทางที่ใช้งานคือ:

1. Marketing และ Inventory specialists ส่ง candidate พร้อม `evidenceRefs`
2. Lead อ่าน Product, Sales และ Inventory ซ้ำจาก bounded Core APIs โดยตรึง `asOf` เดียวกัน
3. `@commerce/agent-evidence` ตรวจ schema, shop scope, request ID, pagination, source version, reference และ SHA-256 integrity ของ item
4. Specialist reference ต้อง resolve กลับไปยัง variant เดียวกันใน snapshot ที่ตรวจแล้ว มิฉะนั้น candidate ถูกตัดออกพร้อม limitation
5. deterministic stock policy สร้าง `stockConstraint`; SKU จะ `promote` ได้ต่อเมื่อมี distributable stock และไม่มี specialist constraint ที่บล็อก
6. ผลลัพธ์มี source metadata, evidence manifest, `verifiedAt`, limitations และ completeness summary ที่ unresolved ต้องเป็นศูนย์

## Contract ที่เพิ่ม

`@commerce/agent-evidence` เป็น boundary ร่วมระหว่าง Core producer และ Agent Runtime:

- `canonicalAgentEvidenceJson` เรียง object keys แบบ deterministic ก่อน hash เพื่อไม่ให้ PostgreSQL/Zod serializer order ทำให้ข้อมูลเดียวกันได้ hash คนละค่า
- `agentEvidenceIntegrityHash` ใช้ Web Crypto SHA-256 กับ canonical payload ที่ไม่รวม evidence envelope จึง bundle ใน eve workflow ได้โดยไม่ import Node builtin
- Product ต้องมี `product` และ `variant` evidence จาก `catalog-v1`
- Sales ต้องมี `sales_aggregate` จาก `sales-aggregate-v1` และ reference ผูกกับ hash ของ aggregate
- Inventory ต้องมี `inventory_balance` จาก `inventory-ledger-v1` และ `inventory_policy` จาก `inventory-policy-v1`
- evidence แต่ละรายการถูก resolve เป็น `resource`, `sourceRequestId`, `dataVersion`, `responseAsOf`, `productId` และ `variantId`
- bundle ต้องใช้ shop scope และ `asOf` เดียวกัน, request ID ไม่ซ้ำ, ไม่มีหน้าข้อมูลค้าง และ snapshot ต้องอยู่ใน verification window 5 นาที

Recommendation output เพิ่ม:

- `sources[]` สำหรับ Product/Sales/Inventory พร้อม request ID, as-of, data version และ limitations
- `evidenceManifest[]` ซึ่งทุก `recommendation.evidenceRefs[]` ต้อง resolve ได้
- `evidenceCompleteness` ซึ่ง schema บังคับจำนวน recommendation/reference และ `unresolvedReferenceCount: 0`
- `stockConstraint` พร้อม policy version, stock arithmetic, promotion capacity, block reasons และ consistency checks

## Fail-closed cases ที่ตรวจแล้ว

- payload ถูกแก้หลังออก integrity hash
- evidence kind หาย หรือใช้ source version ที่ไม่รองรับ
- Product/Sales/Inventory มาจากคนละ snapshot
- snapshot เก่าเกิน verification window
- response shop scope ไม่ตรง delegated scope
- specialist อ้าง reference ที่ไม่มีอยู่หรือเป็น variant อื่น
- response ยังมี pagination ค้าง
- action ขัดกับ stock constraint หรือ stock arithmetic

กรณี specialist reference ไม่ resolve จะตัด candidate นั้นออกและรายงาน limitation ส่วนกรณี Core evidence หรือ scope ไม่ผ่านจะหยุดทั้งการ consolidation เพื่อไม่สร้างคำแนะนำบนข้อมูลที่ตรวจไม่ได้

## Code references

- Evidence hash/resolver: `packages/agent-evidence/src/index.ts`
- Core evidence producer: `packages/agent-api/src/index.ts`
- Lead consolidation/output schema: `apps/agent-runtime/agent/lib/promotion-analysis.ts`
- Delegation workflow: `apps/agent-runtime/agent/tools/analyze_promotion_candidates.ts`
- Runtime acceptance tests: `apps/agent-runtime/tests/promotion-analysis.test.ts`
- Core API evidence test: `tests/agent-read-api.test.ts`

## Verification

- Agent Runtime typecheck ผ่าน
- Root TypeScript typecheck ผ่าน
- ESLint ผ่านโดยไม่มี warning
- Agent Runtime tests ผ่าน รวม integrity tampering, missing/version evidence, stale/split snapshot, cross-shop และ unresolved specialist reference
- Full isolated PostgreSQL integration suite ผ่าน รวมการตรวจ evidence ที่ Core สร้างจริงและ tamper detection
- Next production build และ eve Node 24 build ผ่าน; local eve build มีเพียง warning เดิมว่าไม่มี sandbox provider และ POC นี้ไม่มี sandbox tool

## ขอบเขตที่ยังคงปิด

- ยังไม่เปิด live model หรือ production credential
- ใช้ synthetic response เท่านั้น
- ไม่มี financial/inventory/marketplace mutation
- evidence manifest เป็น provenance ของ reduced Core snapshot ไม่ใช่ raw order, customer PII หรือ statement
- verification window เป็น runtime freshness gate; ความเก่าทางธุรกิจของข้อมูลต้นทางยังต้องแสดงด้วย `observedAt` และกำหนด SLA แยกตาม resource ก่อน production
- session continuation ยังคงปิดตาม EVE-POC-06

งานต่อเนื่อง **EVE-POC-08 — Durability และ idempotency** ส่งมอบแล้วใน [docs/73](73-eve-durability-and-idempotency.md): stable execution/request identity, exact replay และ write-once Core result ผ่าน crash-after-Core-commit failure injection, **EVE-POC-09 — Tracing/redaction/cost attribution** ส่งมอบแล้วใน [docs/74](74-eve-tracing-redaction-cost-attribution.md), **EVE-POC-10 — Legacy/eve shadow comparison** ส่งมอบแล้วใน [docs/75](75-eve-legacy-shadow-comparison.md) และ **EVE-POC-11 — Rollback rehearsal** ส่งมอบแล้วใน [docs/76](76-eve-rollback-rehearsal.md)
