# EVE-POC-08 — Durability and Idempotency

สถานะ: **ผ่านในขอบเขต synthetic read-only** วันที่ 13 พฤศจิกายน 2026

## ผลลัพธ์

Commerce Lead มี identity คงที่ต่อหนึ่ง EVE workflow tool call และ Commerce Core รองรับกรณี runtime หลุดหลัง Core ประมวลผลสำเร็จแต่ก่อน workflow บันทึก checkpoint แล้ว การ retry ใช้ request ID เดิม รับ reduced response เดิม และไม่สร้าง receipt หรือ evidence response ซ้ำ

ขอบเขตนี้ไม่เปิด live model, production credential, marketplace account, mutation tool หรือ existing-session continuation

## Durable boundary

EVE `defineWorkflowTool` ใช้ Workflow SDK เป็น durable workflow และ checkpoint ที่ `use step` ตามเอกสารของ `eve@1.0.0-rc.10` ใน repo การส่งงานให้ child agent ผ่าน `ctx.agent(...).send()` อยู่ใน workflow lifecycle ของ EVE ส่วน external HTTP call อาจสำเร็จก่อน step checkpoint จึงต้องมี application idempotency เพิ่มที่ Commerce Core

หนึ่ง execution ใช้ identity จากค่าที่ EVE รับประกันว่าคงที่ใน call เดิม:

```text
eve:{session.id}:{session.turn.id}:{callId}
```

ค่าดังกล่าวไม่ถูกส่งออกไปโดยตรง แต่ hash แยก namespace เป็น UUID สำหรับ:

- promotion execution
- `products.query`
- `sales.query`
- `inventory.query`

operation ต่างกันจึงไม่ชนกัน และการใช้ key เดิมกับ body ต่างกันถูกปฏิเสธแบบ fail closed

## Core idempotency contract

1. Client ลงลายเซ็น request ใหม่ทุก attempt ด้วย timestamp ปัจจุบัน แต่ใช้ request ID ที่ derive จาก logical execution เดิม
2. `app.authorize_agent_service_request` ตรวจ credential, tenant, shop, scope, environment, audience และ request timestamp ทุก attempt
3. Request ID เดิมผ่านได้เฉพาะ principal, scope, shop, method, path และ body hash เดิม
4. `app.agent_service_request_receipts` มีหนึ่งแถวต่อ `(tenant_id, request_id)`
5. Reduced response ถูกบันทึกแบบ write-once ใน `app.agent_service_request_results`
6. Exact retry รับ response ที่บันทึกไว้ หาก attempt แรกยังไม่ทันบันทึก result จะคำนวณ read-only projection ซ้ำแล้วแข่ง insert แบบ write-once; ทุก caller ได้ค่าจากแถวที่ชนะ
7. Response และ error ยังคง `private, no-store`; header `x-commerce-idempotent-replay` ใช้ตรวจสอบพฤติกรรมโดยไม่เปิดเผย key

ตาราง result เก็บเฉพาะ reduced Agent API response ไม่มี raw credential, signature, customer identity หรือข้อมูล marketplace เต็มรูปแบบ และ runtime role เข้าถึงผ่าน SECURITY DEFINER functions ที่ผูกกับ receipt เท่านั้น

## Failure injection ที่ตรวจแล้ว

กรณีทดสอบจำลองลำดับต่อไปนี้:

1. Commerce Core authenticate, อ่านข้อมูล และบันทึก result สำเร็จ
2. transport จำลอง runtime crash ก่อน client ได้ response
3. client retry ด้วย execution key เดิมและ timestamp ใหม่
4. Core คืน stored response เดิม

เกณฑ์ที่ตรวจ:

- request ID ก่อนและหลัง retry ตรงกัน
- response ครั้ง retry ถูกระบุเป็น replay
- receipt มี 1 แถว
- result/evidence response มี 1 แถว
- key เดิมกับ payload ต่างกันได้ `REQUEST_REPLAYED`
- request ID ของคนละ operation ไม่ชนกัน
- execution ID และ snapshot boundary คงที่เมื่อ workflow call เดิมถูก replay

## Code references

- `apps/agent-runtime/agent/tools/analyze_promotion_candidates.ts` — สร้าง execution identity ก่อน delegation
- `apps/agent-runtime/agent/lib/promotion-analysis.ts` — durable preparation step, pinned snapshot และ idempotent Core reads
- `packages/commerce-agent-client/src/index.ts` — deterministic operation-scoped UUID
- `packages/agent-api/src/index.ts` — replay lookup, write-once result และ replay response
- `packages/db/migrations/0048-agent-read-idempotency.sql` — exact-retry authorization และ result store
- `tests/agent-read-api.test.ts` — crash-after-Core-commit failure injection
- `tests/agent-service-authentication.test.ts` — concurrent exact retry และ payload mismatch
- `apps/agent-runtime/tests/promotion-analysis.test.ts` — stable execution/snapshot identity

## ข้อจำกัดที่ยังคงอยู่

- existing-session continuation ยังปิดตาม EVE-POC-06 จนมี Core session registry/proxy ที่ผูก user, tenant และ shop ทุก follow-up
- POC ยังไม่มี business-facing `app.ai_runs` mapping สำหรับ EVE session/trace; EVE-POC-09 ส่งมอบ metadata-only trace link แล้ว แต่ durable Core-owned sink/mapping ยังเป็น production gate
- result retention/cleanup policy ต้องกำหนดก่อน production โดยต้องไม่ลบก่อน workflow retry window
- ทดสอบ restart ของ Vercel deployment จริงและ Workflow Store จริงยังเป็น Preview deployment gate; local tests ตรวจ application boundary และ failure injection
- ทุก flow ยัง read-only; mutation ในอนาคตต้องใช้ approval/policy API และ idempotency contract แยกตาม business command

## งานถัดไป

**EVE-POC-09 — Tracing, redaction และ cost attribution** ส่งมอบแล้วใน [docs/74](74-eve-tracing-redaction-cost-attribution.md), **EVE-POC-10 — Legacy/eve shadow comparison** ส่งมอบแล้วใน [docs/75](75-eve-legacy-shadow-comparison.md) และ **EVE-POC-11 — Rollback rehearsal** ส่งมอบแล้วใน [docs/76](76-eve-rollback-rehearsal.md) โดยยังไม่เปิด live model หรือ mutation
