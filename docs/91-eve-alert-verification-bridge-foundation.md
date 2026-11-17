# EVE-CANARY-14 — Signed Alert Verification Bridge Foundation

สถานะ: **Engineering foundation complete; external delivery remains pending** วันที่ 17 พฤศจิกายน 2026

## ผลลัพธ์

เพิ่มสัญญาตัวรับ alert ที่ตรวจ raw body ก่อนเชื่อถือข้อมูล โดยใช้ HMAC-SHA256 แบบ constant-time, จำกัด body 16 KiB, จำกัดอายุห้านาทีและ future skew หนึ่งนาที ตรวจ event ID/timestamp ระหว่าง header กับ body, ผูก environment/source กับ configuration และเรียก replay-store contract หลัง signature/schema ผ่านแล้วเท่านั้น

ตัวรับรองรับเฉพาะ `commerce-runtime-monitor` และ `commerce-agent-canary-monitor` ด้วย top-level schema แบบ allowlist ข้อมูลที่ส่งต่อจาก bridge ถูกลดเหลือ event ID, source, environment, status, time, tenant scope และ `contentCaptured:false` ไม่มี prompt, model response, customer data, authorization หรือ secret

## สิ่งที่ทดสอบแล้ว

- alert ที่ลงลายเซ็นถูกต้องผ่านหนึ่งครั้ง
- event ID เดิมถูกปฏิเสธเป็น replay
- body ที่ถูกแก้แม้มี whitespace เพิ่มถูกปฏิเสธ
- timestamp เก่าหรืออยู่ในอนาคตเกินขอบเขตถูกปฏิเสธ
- signed payload ที่เพิ่ม `prompt` ถูกปฏิเสธด้วย strict schema
- alert จาก environment หรือ source ที่ไม่ตรง configuration ถูกปฏิเสธ
- secret สั้น, header mismatch และ payload เกินขนาดมี fail-closed path
- typecheck, lint, monitoring/security tests 18 รายการ และ integration suite 308 รายการผ่าน

รัน rehearsal ซ้ำได้ด้วย:

```sh
AI_ENABLED=false COMMERCE_AGENT_LIVE_AI=false npm run agent:alert-bridge:rehearse
```

หลักฐาน machine-readable อยู่ที่ [eve-alert-verification-bridge-foundation-latest.json](evidence/eve-alert-verification-bridge-foundation-latest.json)

## ขอบเขตที่ยังไม่ผ่าน

Rehearsal ใช้ replay store ใน memory จึงมีไว้ตรวจสัญญาเท่านั้น การใช้งาน staging ต้องมี shared durable store ที่ `consume(eventId)` แบบ atomic เพื่อกัน replay ข้าม instance และ restart

ยังไม่มี alert วิ่งผ่าน receiver ที่ deploy แยก, Better Stack หรือ provider ภายนอก และยังไม่มี human acknowledgement/escalation ดังนั้น `config/eve-canary-staging-plan.json` ยังคง `preflightEvidence.alertDeliveryDryRun: null` ตามจริง งานนี้ไม่อนุญาตให้เปิด Live AI หรือ canary window

## งานถัดไป

1. เลือกปลายทาง deploy receiver และ durable replay store แยกจาก Commerce Core/Eve runtime
2. เก็บ signing secret ใน provider secret store และห้ามส่ง secret ให้ incident provider
3. ส่ง synthetic metadata-only breach/recovery ผ่าน network จริง
4. ตรวจ event ID, delivery timestamp, signature result, provider incident ID และการ acknowledge ของ `github:kobdesign`
5. เมื่อหลักฐานครบจึงสร้าง external alert dry-run evidence และเชื่อมเข้า staging plan

## Code references

- `packages/operations/src/alert-verification.ts`
- `packages/operations/src/monitoring.ts`
- `tests/alert-verification.test.ts`
- `scripts/rehearse-alert-verification-bridge.ts`
