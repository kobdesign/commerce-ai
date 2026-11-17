# EVE-POC-09 — Tracing, Redaction and Cost Attribution

สถานะ: **ผ่านในขอบเขต synthetic metadata-only POC** วันที่ 13 พฤศจิกายน 2026

## ผลลัพธ์

EVE runtime มี trace contract ที่เชื่อม Commerce execution เดียวกับ root session/turn/tool call, Marketing และ Inventory child sessions, Commerce Core request IDs และ evidence references ได้แล้ว Lifecycle instrumentation บันทึกเฉพาะ allow-listed metadata และ provider-reported usage/cost ไม่บันทึก prompt, message, tool input/output, model response, reasoning, error detail, provider metadata, principal ID, credential หรือข้อมูลลูกค้า

ขอบเขตนี้ไม่เปิด live model, production credential, marketplace account, mutation tool หรือ existing-session continuation และยังไม่เขียน EVE trace ลง `app.ai_runs`

## Trace model

หนึ่ง promotion analysis คืน `commerce-agent-trace-v1` link ซึ่งประกอบด้วย:

- trusted `tenantId` จาก signed Commerce session scope
- stable execution ID จาก EVE session/turn/call ตาม EVE-POC-08
- root session, turn และ call IDs
- agent set: `commerce-lead`, `marketing-analysis`, `inventory-analysis`
- Core Product/Sales/Inventory request IDs
- evidence references ที่ใช้จริงใน recommendation
- `contentCaptured: false` และ redaction policy version

EVE lifecycle records ใช้ `rootSessionId` เป็น join key ของ root และ children ส่วน `idempotencyKey` ของ event ใช้ upsert/deduplicate เมื่อ workflow replay Event ที่มี scope ระบุ session, turn, run และ attempt; `session.started` ระบุ parent session/call สำหรับ delegation lineage

## Redaction policy

มีการป้องกันสามชั้น:

1. `otel({ tracePolicy })` ปิด input และ output capture ทุก environment รวม local development
2. Vercel Agent Runs export policy redact inputs/outputs ทุก span และ drop attribute key ที่สื่อถึง authorization, cookie, secret, token, credential, password, API key, customer/buyer identity, email, phone, address, prompt, message, response, reasoning, input หรือ output
3. Commerce lifecycle exporter project event ผ่าน allow-list schema เท่านั้น จึงไม่มี field สำหรับ prompt, tool payload, response, error body, provider metadata หรือ principal ID

การทดสอบใส่ service credential, bearer header, email, เบอร์โทร, ที่อยู่, prompt และ model response ลง fake events แล้วตรวจว่า serialized safe record ไม่มีค่าเหล่านั้น

## Usage and cost attribution

`model.call.settled` ของ eve ให้ input/output/cache token usage และ `costUsd` เมื่อ provider รายงาน ระบบรวมเฉพาะ provider-call terminal records จึงไม่บวก subagent `call.settled` summary ซ้ำ แล้วผูกผลกับ:

- tenant ID
- stable execution ID
- root session ID
- agent/session
- model-call และ tool-call counts

Cost มีสถานะชัดเจน:

- `reported` — ทุก completed model call มี provider-reported cost
- `partial` — provider รายงาน cost เพียงบาง call
- `unavailable` — ไม่มี cost; amount เป็น `null` และระบบไม่ประดิษฐ์ราคาจาก rate card ที่ไม่ได้ยืนยัน

ตัว POC ปิด live AI จึงตรวจ aggregation ด้วย synthetic lifecycle events เท่านั้น ยังไม่มีข้ออ้างว่าต้นทุนจริงของ provider ได้รับการตรวจแล้ว

## Code references

- `apps/agent-runtime/agent/lib/observability.ts` — trace/link schemas, metadata allow-list projection, usage/cost attribution และ sensitive attribute policy
- `apps/agent-runtime/agent/instrumentation/commerce-audit.ts` — EVE lifecycle exporter แบบ metadata-only
- `apps/agent-runtime/agent/instrumentation/otel.ts` — process-wide no-content OpenTelemetry policy
- `apps/agent-runtime/agent/instrumentation/agent-runs.ts` — Agent Runs span/attribute redaction
- `apps/agent-runtime/agent/lib/promotion-analysis.ts` — ผูก tenant/execution/Core/evidence trace link กับผลวิเคราะห์
- `apps/agent-runtime/tests/observability.test.ts` — secret/PII non-disclosure, lineage, usage/cost attribution และ missing-cost behavior
- `apps/agent-runtime/tests/promotion-analysis.test.ts` — execution-to-Core/evidence trace link

## Verification

- Agent runtime tests: 5 files ผ่าน รวม observability/redaction tests
- Agent runtime TypeScript: ผ่าน
- Repository ESLint: ผ่าน
- EVE Node 24 production build: ผ่าน และ compile instrumentation ทั้งสาม provider
- Live model/provider billing validation: ไม่ได้รันตาม POC restriction

## ข้อจำกัดที่ยังคงอยู่

- Metadata records ถูกส่งเป็น structured runtime logs และ Agent Runs trace; ยังไม่มี durable Commerce-owned telemetry ingestion/exporter หรือ retention policy ที่ตรวจรับ production แล้ว
- `app.ai_runs` ยังเป็น legacy/business-facing run index และยังไม่ผูก EVE execution/session อย่างถาวร การเพิ่ม mapping ต้องผ่าน Core API/RLS ไม่ให้ EVE เขียนฐานข้อมูลตรง
- Agent Runs availability, retention และ billing บน Vercel account จริงยังไม่ได้ตรวจ เพราะยังไม่ deploy งานนี้
- Metadata-only OTel policy ทำให้ completed private workflow payload ถูกลบตาม EVE retention behavior; ต้องทบทวน retention พร้อม session continuation/HITL โดยห้ามเปิด content capture เป็นค่าเริ่มต้น
- Cost เป็น provider-reported เท่านั้น ไม่มี hard-coded model price และไม่มีการแปลงสกุลเงิน

## งานถัดไป

**EVE-POC-10 — Legacy/eve shadow comparison** ส่งมอบแล้วใน [docs/75](75-eve-legacy-shadow-comparison.md) และ **EVE-POC-11 — Rollback rehearsal** ส่งมอบแล้วใน [docs/76](76-eve-rollback-rehearsal.md) โดยยังให้ legacy เป็น user-visible default และไม่เปิด mutation
