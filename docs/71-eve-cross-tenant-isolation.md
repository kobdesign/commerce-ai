# EVE-POC-06 — Cross-Tenant Isolation

วันที่ตรวจรับ: 13 พฤศจิกายน 2026
สถานะ: **Complete สำหรับ non-live synthetic isolation gate; continuation/stream ปิดจนกว่าจะมี Core-owned session registry**

## ผลลัพธ์

เพิ่ม trust boundary ระหว่าง Commerce Web/Core บน Render กับ eve runtime บน Vercel โดย Commerce Core เป็นฝ่ายออก session grant อายุไม่เกิน 5 นาทีหลังตรวจ session ผู้ใช้, membership, role และร้านผ่าน PostgreSQL RLS แล้วเท่านั้น EVE ถือเฉพาะ Ed25519 public key และสร้าง `tenantId`/`shopIds` จาก claims ที่ตรวจลายเซ็นสำเร็จ ไม่รับค่าเหล่านี้จาก prompt, client context หรือ tool input

grant ใน POC นี้มี capability `create` เท่านั้น ใช้ได้เฉพาะ `POST /eve/v1/session` และใช้ follow-up, stream, compact, reset หรือ session ID เดิมไม่ได้ การจำกัดนี้ตั้งใจปิดความเสี่ยงจากข้อเท็จจริงของ eve ว่า route authentication ไม่ได้ให้ per-session ACL อัตโนมัติ ก่อนเปิด continuation ต้องมี Core-owned session registry/proxy ที่ผูก session กับ tenant, user และร้านแบบ server-to-server

## Trust flow

```mermaid
sequenceDiagram
  participant B as Commerce browser
  participant C as Commerce Core / Render
  participant D as PostgreSQL + RLS
  participant E as eve / Vercel Preview
  B->>C: POST tenant agent-session + selected shop IDs
  C->>D: Verify app session, membership, role and visible shops
  D-->>C: Trusted tenant/user/shop scope
  C->>C: Sign 5-minute Ed25519 create grant
  C-->>B: Opaque grant (private, no-store)
  B->>E: POST /eve/v1/session + Bearer grant
  E->>E: Verify public key, kid, environment, expiry, method/path
  E->>E: Pin signed initiator scope; classify trace private
  E-->>B: New-session response
  Note over B,E: Existing-session routes reject this create grant
```

## Implementation references

| Boundary | Code reference |
|---|---|
| Ed25519 issue/verify, strict claims, 5-minute TTL | `packages/agent-session-auth/src/index.ts` |
| RLS shop validation + immutable audit event | `packages/agent-session/src/index.ts` |
| Same-origin authenticated grant endpoint | `apps/web/app/api/tenants/[tenantId]/agent-session/route.ts` |
| EVE authenticator + exact create-route capability | `apps/agent-runtime/agent/lib/commerce-session-auth.ts` |
| Pinned initiator and same-caller enforcement | `apps/agent-runtime/agent/lib/commerce-scope.ts` |
| Private trace audience and live-AI gate | `apps/agent-runtime/agent/channels/eve.ts` |
| Service credential, cursor, evidence, cache boundary | `packages/agent-api/src/index.ts` |

## Key separation

- Render/Core เท่านั้นที่รับ `COMMERCE_AGENT_SESSION_PRIVATE_KEY`
- Vercel/eve รับ `COMMERCE_SESSION_PUBLIC_KEY` และ `COMMERCE_SESSION_KEY_ID` เท่านั้น
- runtime policy ปฏิเสธทันทีหาก private key, Commerce database key, marketplace secret หรือ model-provider secret หลุดเข้า EVE runtime
- key ใช้รูปแบบ Ed25519 PKCS8/SPKI DER ที่ encode เป็น base64url; ไม่มี shared signing secret ระหว่างสอง runtime
- environment claim ต้องเป็น `development` สำหรับ local หรือ `staging` สำหรับ preview และใช้ข้ามกันไม่ได้

## Isolation evidence

| Attack / boundary | ผล |
|---|---|
| แก้ tenant ใน payload แต่ใช้ signature เดิม | ปฏิเสธ signature |
| ใช้ grant ข้าม development/staging หรือหลังหมดอายุ | ปฏิเสธ |
| ส่ง `tenantId`, role หรือ subject เพิ่มใน request body | strict schema ปฏิเสธ |
| limited user ขอร้านอื่นใน tenant เดียวกัน | RLS + visible-shop count ปฏิเสธ |
| limited user ขอร้านของ tenant อื่น | RLS ปฏิเสธ |
| OIDC token ที่ไม่ใช่ Commerce grant | Commerce authenticator ไม่ดักไว้และส่งให้ authenticator ถัดไป |
| ใช้ create grant กับ session เดิมหรือ stream | ปฏิเสธก่อน runtime dispatch |
| current caller ไม่ตรง pinned initiator | tool scope ปฏิเสธ |
| replay cursor โดยเปลี่ยนร้านหรือ tenant | query fingerprint ปฏิเสธ |
| ขอ shop ข้าม tenant ผ่าน Agent API | database service authorization ปฏิเสธ |
| foreign tenant ID/shop/product ใน evidence response | ไม่พบใน serialized response |
| success/error response cache | `Cache-Control: private, no-store` ทั้งคู่ |
| trace audience | กำหนด `private` ชัดเจน; ไม่มี public trace route ใน POC |

## Verification

- ชุดรวม PostgreSQL/RLS จริง: **35 test files, 234 tests ผ่าน**
- agent runtime: session signature/tamper/environment/path, pinned scope และ runtime policy ผ่าน
- TypeScript typecheck ผ่าน
- Next.js production build และ eve Node 24 bundle build ผ่าน; sandbox-provider warning เดิมไม่กระทบเพราะ POC นี้ไม่มี sandbox tool
- ไม่มี production key, live model, marketplace account, mutation tool หรือ deployment ในการตรวจนี้

## ข้อจำกัดที่ตั้งใจคงไว้

- create grant ใช้ครั้งเดียวผ่าน Core-owned registry แล้วใน [EVE-CANARY-06](83-eve-one-time-grant-registry.md)
- client ยังใช้ grant นี้ติดตาม stream หรือสนทนาต่อไม่ได้ เพราะเปิด continuation โดยไม่มี session ACL จะเสี่ยง history leakage
- trace backend/operator RBAC และ field-level redaction จะทดสอบละเอียดใน EVE-POC-09; ระยะนี้บังคับ private audience และไม่เปิด trace ให้ tenant user
- live AI ยังคงถูกบล็อกด้วย `COMMERCE_AGENT_LIVE_AI=false`

งานต่อเนื่อง **EVE-POC-07 — Evidence-backed recommendation** ส่งมอบแล้วใน [docs/72](72-eve-evidence-backed-recommendation.md), **EVE-POC-08 — Durability/idempotency** ส่งมอบแล้วใน [docs/73](73-eve-durability-and-idempotency.md), **EVE-POC-09 — Tracing/redaction/cost attribution** ส่งมอบแล้วใน [docs/74](74-eve-tracing-redaction-cost-attribution.md), **EVE-POC-10 — Legacy/eve shadow comparison** ส่งมอบแล้วใน [docs/75](75-eve-legacy-shadow-comparison.md), **EVE-POC-11 — Rollback rehearsal** ส่งมอบแล้วใน [docs/76](76-eve-rollback-rehearsal.md) และ one-time grant registry อยู่ใน [docs/83](83-eve-one-time-grant-registry.md) ส่วน Eve session-ID mapping/proxy ยังต้องเสร็จก่อนเปิด continuation/HITL จริง
