# EVE-CANARY-09 — Session Lifecycle Handshake and Reconciliation

สถานะ: **Engineering complete / Synthetic protocol / Live AI disabled / canary BLOCKED**
วันที่: 16 พฤศจิกายน 2026

## ผลลัพธ์

เพิ่ม lifecycle coordinator ระหว่าง Commerce Core และ Eve โดยไม่ส่ง prompt และไม่เรียก
model จริง Client ขอ create grant จาก Core, สร้าง prewarmed Eve session, แล้ว bind session ID
กลับเข้า Core ก่อนคืน session ให้ผู้ใช้ หาก bind ตอบ 5xx/429 client จะ retry ด้วย grant และ
session ID เดิม; database bind แบบ exact retry จะคืน record เดิมและไม่สร้าง audit ซ้ำ

หาก bind ถูกปฏิเสธ client เรียก abandonment callback เพื่อเก็บ session ID และสถานะ
`abandoned` แบบ tenant-scoped จากนั้น session นี้ไม่สามารถขอ continuation grant ได้

เมื่อผู้ใช้จบ session client ขอ continuation grant ใหม่, ส่ง Eve `end` ก่อน แล้วจึงเรียก Core
end callback หาก Eve ไม่รับคำสั่ง Core จะยังไม่รายงานว่า session จบ หาก Core callback ตอบ
ไม่ชัดเจน client retry แบบ idempotent และรายงาน `CORE_END_RECONCILIATION_PENDING` หากยัง
ไม่สำเร็จ เพื่อไม่กลบสถานะค้าง

## Protocol

```mermaid
sequenceDiagram
  participant U as Commerce lifecycle client
  participant C as Commerce Core
  participant E as Eve runtime
  participant D as PostgreSQL
  U->>C: request create grant (tenant + shops)
  C->>D: register one-time create grant
  U->>E: POST /eve/v1/session (no message)
  E->>C: consume create grant
  E-->>U: 202 + Eve session ID
  U->>C: bind session ID + original grant
  alt response uncertain
    U->>C: exact bind retry
    C-->>U: existing active binding
  else bind rejected
    U->>C: abandonment callback
    C->>D: terminal abandoned metadata
  end
  U->>C: request fresh continuation grant
  U->>E: POST /session/:id/end
  E-->>U: 202 accepted
  U->>C: end callback
  C->>D: active → ended; revoke unused continuation grants
```

## Lifecycle states

| State | ความหมาย | ขอ continuation ได้ | Retention |
|---|---|---:|---:|
| `active` | bind สำเร็จและยังไม่หมดอายุ | ได้ เมื่อ ACL ปัจจุบันยังผ่าน | สูงสุด 4 ชั่วโมงใน engineering POC |
| `ended` | Eve รับ end แล้ว หรือ worker ปิดเพราะหมดอายุ | ไม่ได้ | 30 วัน |
| `revoked` | ผู้ใช้/Owner/Auditor ยกเลิกสิทธิ์ฉุกเฉิน | ไม่ได้ | 30 วัน |
| `abandoned` | Eve create สำเร็จแต่ bind handshake ไม่สมบูรณ์ | ไม่ได้ | 30 วัน |

worker ทำ maintenance ทุกหนึ่งชั่วโมง โดยปิด active session ที่หมดอายุ, บันทึก consumed
create grant ที่ไม่มี bind เกิน 15 นาทีเป็น abandonment telemetry และลบ terminal session
metadata หลัง 30 วัน Grant events ยังคง retention 90 วันตาม EVE-CANARY-07

## Security properties

- Client ไม่ส่ง message ใน create handshake จึงไม่มี model call หรือ prompt content
- Core ยืนยัน signed create grant, tenant, subject และ consumed state ก่อน bind/abandon
- exact bind retry ยอมรับเฉพาะ initial grant และ Eve session ID เดิม
- abandoned session ID ถูกสงวนใน Core และไม่สามารถ bind ใหม่หรือ continue ได้
- end ใช้ continuation grant ใบใหม่ที่ผูก exact session ID และ Eve ต้องรับ end ก่อน Core ปิด
- callback ทุกตัวใช้ authenticated Commerce user context, origin check และ tenant transaction
- metadata/audit ไม่มี prompt, response, customer content หรือ signed token
- session RLS เดิมยังจำกัด subject และ Owner/Auditor ภายใน tenant เดียวกัน

## Code references

- `packages/db/migrations/0053-agent-session-lifecycle.sql` — retry-safe bind, abandon/end,
  lifecycle states, maintenance และ retention
- `packages/agent-session/src/client.ts` — Core/Eve lifecycle coordinator แบบ no-message
- `packages/agent-session/src/index.ts` — verified abandon/end service boundary
- `packages/db/src/index.ts` — tenant transaction adapters
- `apps/web/app/api/tenants/[tenantId]/agent-session/abandon/route.ts` — abandonment callback
- `apps/web/app/api/tenants/[tenantId]/agent-session/sessions/[sessionId]/end/route.ts` — end callback
- `apps/worker/src/index.ts` — hourly session maintenance ก่อน grant maintenance
- `tests/agent-session-lifecycle-client.test.ts` — protocol ordering, retry, abandon และ no false end
- `tests/agent-session-lifecycle.test.ts` — database idempotency, terminal ACL และ retention

## ขอบเขตที่ยังไม่ครอบคลุม

1. lifecycle client พร้อมใช้งานเป็น package แต่ยังไม่ผูกกับ live chat UI เพราะ live AI ถูกปิด
2. emergency revoke ปิดสิทธิ์ที่ Core ทันที แต่ยังไม่มี service credential สำหรับสั่ง Eve end
   หลัง revoke; Eve session จึงอาจเหลือใน runtime แม้ไม่มีผู้ใช้ Commerce เข้าถึงได้
3. retry ของ end callback อยู่ใน process สองครั้ง ยังไม่มี durable reconciliation queue สำหรับ
   network failure ที่ยาวนาน
4. retention 30 วันครอบคลุม Core authorization metadata เท่านั้น การเก็บ Eve conversation
   ต้องกำหนดแยกใน Eve world/storage policy ก่อนเปิดข้อมูลจริง
5. canary approvals ด้าน identity/secrets, data policy, budget, monitoring/SLO และ incident
   ownership ยังไม่ครบ จึงยัง BLOCKED และห้ามเปิด live AI

## Verification

```text
Integration test files 44/44 passed
Integration tests      283/283 passed
Agent runtime tests        9/9 passed
TypeScript / ESLint        passed
Next.js production build  passed
Canary technical gates      9/9 verified
Canary approval gates       0/6 approved — BLOCKED / NO-GO
```

## งานถัดไปที่แนะนำ

**EVE-CANARY-10 — Durable lifecycle reconciliation queue and operator evidence**

เพิ่ม durable intent/receipt สำหรับ end และ revoke, worker retry ที่มี bounded backoff,
operator-visible terminal mismatch metric และ synthetic failure rehearsal โดยยังไม่เปิด model
หรือ production account
