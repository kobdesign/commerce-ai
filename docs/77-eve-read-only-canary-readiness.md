# EVE-CANARY-01 — Read-only Canary Readiness Review

> สถานะล่าสุด 16 พฤศจิกายน 2026: Bootstrap approvals ผ่าน 6/6 แล้ว เอกสารนี้เก็บผล review
> ณ เวลาที่ approval ยังว่าง ดูสถานะปัจจุบันที่ [docs/89](89-eve-canary-approval-closure-preflight.md)

สถานะ: **Review complete / Canary BLOCKED** วันที่ 15 พฤศจิกายน 2026

## Executive decision

EVE-POC-01–11 ให้หลักฐานทางเทคนิคครบสำหรับเริ่มกระบวนการพิจารณา canary แต่ยังไม่เพียงพอสำหรับเปิด Live AI หรือส่งข้อมูลร้านจริงไปยัง model provider

ผล machine-readable gate:

- Technical evidence: **7/7 verified**
- Required approvals: **0/6 approved**
- Canary decision: **BLOCKED**
- Production decision: **NO-GO**

ไม่มีการใส่ชื่อผู้อนุมัติ, provider, งบประมาณ, SLO หรือ incident owner สมมติลงใน manifest

## Readiness matrix

| Gate | สิ่งที่มีแล้ว | สิ่งที่ยังขาด | สถานะ |
|---|---|---|---|
| Identity & secrets | Ed25519 tenant/shop session grant, read-only service auth, no DB credential ใน Eve | production identity decision, approved secret manager, rotation rehearsal | Proposed |
| Data policy | reduced Product/Sales/Inventory contracts, evidence hashes, trace redaction | approved allowed-data contract, retention/DPA, provider retention/ZDR decision | Proposed |
| Model & budget | usage/cost attribution schema และ deterministic fallback | provider/model allowlist, monthly budget, per-run token/cost limits ที่อนุมัติ | Proposed |
| Dynamic routing | default legacy, global kill switch, [synthetic tenant control plane](78-eve-dynamic-tenant-routing-control.md) และ [one-time/revocable grant registry](83-eve-one-time-grant-registry.md) พร้อม | approved flag owner, production approver matrix และ revocation SLO | Proposed |
| Monitoring & SLO | local trace/eval/rehearsal, grant telemetry/rate-limit/retention และ existing Commerce monitor foundation | external Eve monitor, alert delivery evidence, approved SLO/threshold | Proposed |
| Incident ownership | rollback runbook และ failure classifications | named primary/backup owner, acknowledgement target, canary window/runbook approval | Proposed |

## Machine-readable gate

Manifest อยู่ที่ `config/eve-canary-readiness.json` และตรวจด้วย:

```sh
npm run agent:canary:readiness
```

คำสั่งปกติต้อง exit non-zero จนทุก approval gate ผ่านครบ CI ปัจจุบันใช้:

```sh
npm run agent:canary:readiness -- --expect-blocked
```

รูปแบบนี้ทำให้ CI ตรวจว่าระบบยัง fail closed ตามสถานะจริง เมื่อมีการอนุมัติครบ ต้องเปลี่ยน CI ให้เรียก gate ปกติ มิฉะนั้น `--expect-blocked` จะล้มและเตือนว่ากระบวนการ release ยังไม่ได้ปรับตามสถานะใหม่

## Approval integrity

การเปลี่ยน gate เป็น `approved` ต้องมีทั้งหมด:

- selected option
- ผู้อนุมัติอย่างน้อย 2 คนจากอย่างน้อย 2 owner roles ที่ประกาศไว้
- timestamp ที่ parse ได้
- evidence link อย่างน้อยหนึ่งรายการ
- structured controls เฉพาะ gate เช่น provider/secret manager/rotation, data contract/retention mode, model/token/cost budget, flag owner/audit/revocation SLO, monitor/SLO/alert evidence และ incident owners/runbook

การแก้ JSON ให้ครบ shape เป็นเพียง approval record ไม่พิสูจน์ implementation; staging rehearsal และ security review ยังต้องผ่านก่อน canary

## Technical references

- `config/eve-canary-readiness.json` — current facts และ approval gaps
- `packages/operations/src/agent-canary-readiness.ts` — fail-closed gate และ gate-specific controls
- `scripts/check-agent-canary-readiness.ts` — release/CI command
- `tests/agent-canary-readiness.test.ts` — blocked current state, incomplete approval rejection และ complete-shape acceptance
- `.github/workflows/checks.yml` — expected-blocked guard

## Recommended next engineering task

**EVE-CANARY-08 — Core-owned session continuation registry and per-session ACL**

[EVE-CANARY-07](84-eve-grant-operations.md) ผ่านแล้วและ machine gate ยัง blocked ขั้นถัดไปผูก Eve session ID กับ current user/tenant/shop ACL สำหรับ follow-up แบบ read-only โดยยังไม่เพิ่ม model key หรือเปิด canary จริง
