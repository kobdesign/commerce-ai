# EVE-CANARY-02 — Dynamic Tenant Routing Control Plane

สถานะ: **Complete for synthetic local/staging evaluation** วันที่ 15 พฤศจิกายน 2026

## ผลลัพธ์

Commerce Core มีนโยบาย route ต่อ tenant ที่เปลี่ยนได้โดยไม่แก้ environment allowlist และยัง fail closed เป็น legacy เสมอเมื่อไม่มี policy, policy รออนุมัติ, ถูกเพิกถอน, หมดอายุ หรือ environment ไม่ตรงกัน

ความสามารถนี้ยังไม่เปิด live AI และไม่ใช่การอนุมัติ canary โดย `CANARY-DYNAMIC-ROUTING` ใน readiness manifest ยังคงเป็น `proposed`

## Control flow

```mermaid
sequenceDiagram
  participant O as Owner
  participant C as Commerce Core
  participant A as Auditor
  participant U as User
  participant E as Eve runtime

  O->>C: propose(tenant, environment, expiry, expectedVersion)
  C->>C: pending + append audit
  A->>C: approve(expectedVersion)
  C->>C: active + append audit
  U->>C: request agent session
  C->>C: lock policy + verify tenant/environment/expiry
  C-->>U: five-minute tenant/shop grant
  U->>E: create read-only session
  O->>C: revoke(expectedVersion)
  C->>C: revoked + append audit
  U->>C: request another grant
  C-->>U: legacy route; no grant
```

## State และ separation of duties

- `pending`: Owner เสนอ policy พร้อมเหตุผลและอายุไม่เกิน 24 ชั่วโมง แต่ยังออก Eve grant ไม่ได้
- `active`: Auditor ซึ่งเป็นคนละผู้ใช้กับผู้เสนออนุมัติด้วย version ปัจจุบัน
- `revoked`: Owner หรือ Auditor หยุดการออก grant ใหม่ได้ทันที
- การเสนอซ้ำขณะ policy active และยังไม่หมดอายุถูกปฏิเสธ ต้อง revoke ก่อน
- Production role model ยังไม่ได้เพิ่ม Security role ใหม่; POC ใช้ `auditor` เป็น independent reviewer ตาม role ที่มีอยู่จริง การเลือก production approver matrix ยังเป็น approval decision

## Security properties

| Control | Implementation |
|---|---|
| Tenant isolation | `tenant_id`, RLS และ `app.tenant_id()` ทุก read/transition |
| Runtime scope | เฉพาะ `local-demo/development` และ `staging-demo/staging` พร้อม `AI_ENABLED=false` |
| Optimistic concurrency | ทุก transition ต้องส่ง `expected version`; stale request ได้ `409` |
| Durable audit | `agent_route_policy_events` เป็น append-only สำหรับ runtime role และเขียนพร้อม policy transition ใน transaction เดียวกัน รวม event ใน `audit_events` |
| Least privilege locking | Runtime เรียก `read_agent_route_policy_for_grant()` ซึ่งล็อกแถวผ่าน `SECURITY DEFINER`; ไม่ได้รับสิทธิ์ UPDATE บนตาราง policy |
| Global emergency gate | `COMMERCE_AGENT_EVE_ENABLED` และ `COMMERCE_AGENT_EVE_KILL_SWITCH` ยังครอบ dynamic policy |
| Expiry | policy เกินเวลา route กลับ legacy โดยไม่ออก grant |
| Revocation | การขอ grant หลัง revoke commit ถูกปฏิเสธ; grant ที่ออกก่อนหน้าใช้ได้จนหมดอายุสูงสุด 5 นาที |

## Runtime configuration

Dynamic routing ต้องตั้งครบ:

```text
AI_ENABLED=false
COMMERCE_AGENT_EVE_ENABLED=true
COMMERCE_AGENT_EVE_KILL_SWITCH=false
COMMERCE_AGENT_DYNAMIC_ROUTING=true
```

Render Blueprint เปิดเฉพาะ `COMMERCE_AGENT_DYNAMIC_ROUTING=true` เพื่อให้ runtime อ่าน policy จากฐานข้อมูล ส่วน Eve global enable, kill switch และ conversation gate ยังคงปิดแบบ fail closed

## Code references

- `packages/db/migrations/0049-agent-route-control-plane.sql` — policy, state transitions, RLS และ append-only events
- `packages/db/src/index.ts` — typed control operations และ runtime/environment guard
- `packages/agent-routing/src/index.ts` — fail-closed dynamic route resolution
- `packages/agent-session/src/index.ts` — transactional policy lock ก่อนออก signed grant
- `tests/agent-route-control-plane.test.ts` — approval, revoke, stale version, append-only audit, expiry และ tenant boundary
- `tests/agent-routing.test.ts` — missing/pending/revoked/expired/environment decision matrix

## Verification

- Integration tests: **256/256 ผ่าน จาก 38 test files**
- TypeScript typecheck: ผ่าน
- ESLint: ผ่าน
- Migration rehearsal บน PostgreSQL แยก: ผ่าน
- Live model calls: 0
- Marketplace writes: 0

## ข้อจำกัดที่เหลือ

- Platform Owner UI และ HTTP management endpoint ส่งมอบแล้วใน [EVE-CANARY-16](95-platform-ai-control-center.md) สำหรับ synthetic local/staging โดย tenant enrollment ไม่ต้องแก้ deployment allowlist
- signed grant ใช้ครั้งเดียวและ active grant ถูก revoke พร้อม route แล้วใน [EVE-CANARY-06](83-eve-one-time-grant-registry.md); ยังต้องกำหนด production revocation SLO
- ยังไม่มี external monitor, alert delivery evidence, approved availability SLO หรือ incident owner
- readiness approvals ยัง 0/6 และ production decision ยัง NO-GO

## งานถัดไปที่แนะนำ

**EVE-CANARY-03 — Canary monitoring, SLO and incident control rehearsal** ส่งมอบแล้วใน [docs/79](79-eve-canary-monitoring-incident-rehearsal.md)

ขั้นถัดไปคือ **EVE-CANARY-04 — Canary approval decision pack and staging execution runbook** เพื่อเตรียมตัวเลือก SLO/provider/incident ownership และหลักฐานให้ผู้มีอำนาจอนุมัติ โดยยังไม่เปิด live AI หรือ production tenant
