# EVE-CANARY-05 — Live-turn Policy Adapter and Negative Security Harness

สถานะ: **Engineering complete / runtime disabled / canary BLOCKED**
วันที่: 15 พฤศจิกายน 2026

## ผลลัพธ์

แทน route block แบบถาวรด้วย policy adapter ที่ยังคงปิด Live AI เป็นค่าเริ่มต้น
และเปิดได้เฉพาะ Vercel Preview ที่เป็น Commerce staging พร้อม approval/window
ที่ระบุชัดเจน งานนี้ไม่ได้เพิ่ม model key, ไม่เรียก model จริง, ไม่ deploy และไม่
เปิด canary

## Fail-closed controls

| Control | Enforcement |
|---|---|
| Environment | ต้องเป็น `COMMERCE_AGENT_ENV=preview` และ `VERCEL_ENV=preview`; production ถูกปฏิเสธ |
| Approval/window | ต้องเป็น `approved-staging`, มี approval ID และ expiry ในอนาคตไม่เกิน 4 ชั่วโมง |
| Session identity | รับเฉพาะ Ed25519 Commerce grant สำหรับ staging |
| Tenant/shop/role | claims ต้องตรง tenant และเป็น subset ของ shop/role allowlist |
| Auth order | live request ต้องผ่าน Commerce canary auth ตัวแรก ห้าม fall through ไป Vercel OIDC/localDev |
| Model | allowlist ต้องมีเพียง `openai/gpt-5.4-mini` |
| Budget | input ใหม่, output และ USD limit ต้องต่ำกว่า compiled hard ceilings; Eve ตรวจทุกครั้งก่อน model call |
| Tools | authored tools ต้องตรง reviewed allowlist 5 ไฟล์ และ framework default tools ต้องปิด |
| Credentials | database, direct provider, marketplace, token-encryption และ session private key ถูกห้ามใน Eve runtime |
| Session lifecycle | อนุญาตเพียง initial turn; existing-session follow-up/compact ยังปิด |

## Code references

- `apps/agent-runtime/agent/lib/runtime-policy.ts` — environment, approval,
  model, tenant/shop/role, expiry, credential และ budget validation
- `apps/agent-runtime/agent/lib/commerce-canary-auth.ts` — ordered live-turn
  authentication และ scope enforcement
- `apps/agent-runtime/agent/lib/canary-policy-constants.ts` — compiled model,
  hard limits และ reviewed tool allowlist
- `apps/agent-runtime/agent/channels/eve.ts` — canary auth อยู่ก่อน authenticator อื่น
- `apps/agent-runtime/agent/agent.ts` และ specialist configs — input/output/cost limits
- `apps/agent-runtime/tests/commerce-canary-auth.test.ts` — negative tenant/shop/role,
  missing grant, auth fallthrough, expiry และ continuation cases
- `apps/agent-runtime/tests/runtime-policy.test.ts` — environment/model/budget/window/credential cases
- `apps/agent-runtime/tests/canary-tool-policy.test.ts` — exact tool inventory และ default-tool guard

## Verification evidence

```text
npm run agent:test       9/9 test files passed
npm run agent:typecheck  passed
```

ไม่มี network/model call ในชุดทดสอบ ทุก grant และ tenant เป็น synthetic

## Remaining blockers

1. readiness approval ยัง 0/6 และ plan ยัง `executionEnabled=false`
2. ยังไม่ได้เลือก monitoring/SLO หรือ incident owners
3. signed alert delivery, external monitoring และ canary-window evidence ยังไม่มี
4. ยังไม่ได้ทดสอบ Vercel Preview ด้วย provider/model จริง
5. consume endpoint ยังรอ retention, telemetry และ abuse controls

ช่อง replay/revocation ถูกปิดแล้วใน [EVE-CANARY-06](83-eve-one-time-grant-registry.md)

## งานถัดไปที่แนะนำ

**EVE-CANARY-07 — Grant registry retention, operational telemetry and abuse controls**

เพิ่ม cleanup, issued/consumed/replay/revoked/expired metrics, alert threshold และ
bounded consume rate limit โดยยังคง Live AI ปิดและไม่เพิ่ม model key
