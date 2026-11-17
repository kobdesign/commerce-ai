# EVE-POC-11 — Tenant Routing and Rollback Rehearsal

สถานะ: **ผ่าน technical gate ในขอบเขต synthetic read-only** วันที่ 15 พฤศจิกายน 2026

## ข้อสรุป

Commerce Core มี route policy รุ่น `commerce-agent-route-v1` ที่ใช้ legacy เป็นค่าเริ่มต้น และจะออก Eve session grant เฉพาะเมื่อครบทั้งสามเงื่อนไข:

1. `COMMERCE_AGENT_EVE_ENABLED=true`
2. `COMMERCE_AGENT_EVE_KILL_SWITCH=false`
3. Tenant UUID อยู่ใน `COMMERCE_AGENT_EVE_TENANT_IDS` แบบระบุราย tenant โดยไม่รองรับ wildcard

หากเงื่อนไขไม่ครบ endpoint จะตอบ route `legacy` โดยไม่สร้าง Eve token และไม่เรียก Eve runtime ส่วน execution controller สามารถ abort การรอ Eve เมื่อ timeout หรือได้รับ rollback signal แล้วเรียก legacy หนึ่งครั้ง

## ผล rehearsal

| กรณี | ผล | Eve calls | Legacy calls | Commerce snapshot |
|---|---|---:|---:|---|
| ไม่ตั้งค่า flag | legacy | 0 | 1 | ไม่เปลี่ยน |
| Tenant ไม่อยู่ allowlist | legacy | 0 | 1 | ไม่เปลี่ยน |
| Tenant เปิด Eve และ Eve ตอบสำเร็จ | eve | 1 | 0 | ไม่เปลี่ยน |
| Eve unavailable | fallback legacy | 1 | 1 | ไม่เปลี่ยน |
| Eve timeout | abort wait + fallback legacy | 1 | 1 | ไม่เปลี่ยน |
| Operator rollback ระหว่างรอ | abort wait + fallback legacy | 1 | 1 | ไม่เปลี่ยน |

ผลรวม: **6/6 ผ่าน**, business data mutations **0**, control tenant ไม่เรียก Eve และ legacy ยังคงเป็นค่าเริ่มต้น

รันซ้ำด้วย:

```sh
npm run agent:eval:rollback
```

## Enforcement points

- `packages/agent-routing/src/index.ts` — strict environment parser, tenant route decision, timeout/rollback abort และ fallback-once controller
- `packages/agent-session/src/index.ts` — Commerce Core ไม่ออก signed Eve grant เมื่อ route เป็น legacy หรือ kill switch ทำงาน
- `fixtures/eve-rollback-rehearsal.json` — versioned synthetic Commerce snapshot และ tenant identities
- `apps/agent-runtime/evals/synthetic-rollback.ts` — six-scenario rehearsal และ before/after SHA-256 snapshot comparison
- `tests/agent-routing.test.ts` — default-deny, no wildcard, tenant isolation, unavailable/timeout/rollback cases
- `tests/agent-session-auth.test.ts` — Core grant issuance เฉพาะ allowlisted tenant และไม่มี token เมื่อ rollback
- `.github/workflows/checks.yml` — รัน rehearsal ใน Node 24 agent job

## ขอบเขตความปลอดภัย

- Eve ยังใช้ reduced read-only Product/Sales/Inventory APIs และไม่มี mutation tool หรือ database credential
- Rollback ไม่ย้ายหรือแก้ inventory ledger, tenant/RLS, finance, outbox หรือ Commerce data
- Legacy ToolLoopAgent ยังอยู่ใน Commerce Core และเป็น user-visible default
- Live AI, production credential และ existing-session continuation ยังปิด

## ข้อจำกัด

- Rehearsal v1 นี้ยังทดสอบ deploy-scoped fallback path; dynamic control plane, approver และ durable audit เพิ่มแล้วใน [EVE-CANARY-02](78-eve-dynamic-tenant-routing-control.md) แต่ยังไม่มี operator UI และยังไม่เปิดใช้งานจริง
- การ abort หยุดการรอผลใน routing layer แต่ไม่รับรองว่า remote process ที่ไม่เคารพ signal หยุดทันที สิทธิ์ read-only จึงยังเป็น safety boundary หลัก
- Session grant ใช้ครั้งเดียวและมี online consumption/revocation registry แล้วใน [EVE-CANARY-06](83-eve-one-time-grant-registry.md); continuation ยังคงปิด
- Rehearsal ใช้ synthetic handlers ไม่ได้พิสูจน์ Vercel outage, network partition หรือ provider latency จริง

## Decision

EVE-POC-01–11 ผ่าน POC technical gates ในขอบเขต synthetic/non-live แล้ว แต่ production ยังคง **NO-GO** ส่วน **read-only canary readiness review** ส่งมอบแล้วใน [docs/77](77-eve-read-only-canary-readiness.md) และยัง BLOCKED 0/6 approvals [dynamic tenant routing control](78-eve-dynamic-tenant-routing-control.md) ส่งมอบแบบ synthetic/staging และ disabled by default แล้ว ขั้นวิศวกรรมถัดไปคือ monitoring/SLO/incident rehearsal โดยยังไม่เปิด live model หรือ production tenant
