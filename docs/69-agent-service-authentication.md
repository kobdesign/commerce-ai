# EVE-POC-04 — Commerce Agent Service Authentication

วันที่ตรวจรับ: 13 พฤศจิกายน 2026
สถานะ: **Complete — authentication boundary ready; Commerce data routes remain closed**

> สถานะนี้เป็นขอบเขตเมื่อปิด EVE-POC-04 ต่อมา EVE-POC-05 เปิด reduced read-only routes แล้วตาม [docs/70](70-eve-commerce-lead-delegation.md); authentication protocol ในเอกสารนี้ยังเป็น boundary เดิม

## ผลลัพธ์

เพิ่มชั้นยืนยันตัวตนระหว่าง eve Agent Runtime กับ Commerce Core โดยต่อยอด Service Principal เดิม ไม่สร้าง database credential ให้ Vercel และไม่เชื่อ `tenantId` จาก body, header หรือ prompt ระบบรองรับ scope อ่าน `catalog:read`, `sales:read` และ `inventory:read` ที่ผูกกับ tenant, ร้าน, environment, audience และวันหมดอายุ

โค้ดหลักอยู่ที่:

- [`@commerce/agent-api`](../packages/agent-api/src/index.ts) — canonical request, HMAC signing/verification, bounds, safe error และการสร้าง trusted context
- [`@commerce/db`](../packages/db/src/index.ts) — เรียก authorization function ผ่าน runtime role
- [migration 0046](../packages/db/migrations/0046-agent-service-authentication.sql) — current-policy recheck, request receipt และ replay protection
- [integration tests](../tests/agent-service-authentication.test.ts) — ทดสอบ request ผ่าน/ไม่ผ่านกับ PostgreSQL และ RLS จริง

ยังไม่มี `/api/agent/v1/*` route ที่คืน Product/Sales/Inventory และยังไม่มี eve tool เรียก Commerce Core การแยกนี้ป้องกันไม่ให้ route ถูกเปิดก่อน query/evidence implementation พร้อมใน EVE-POC-05

## Signed request protocol

ทุกคำขอต้องเป็น `POST` ผ่าน HTTPS และมี:

| ส่วน | ค่า |
|---|---|
| `Authorization` | `Bearer svc_...` credential ที่แสดงครั้งเดียว |
| `x-commerce-request-id` | UUID ใหม่ต่อหนึ่งคำขอ |
| `x-commerce-timestamp` | ISO timestamp มี offset; clock skew ไม่เกิน 5 นาที |
| `x-commerce-environment` | `development`, `staging` หรือ `production` และต้องตรงกับ Core runtime |
| `x-commerce-audience` | `commerce-agent-api` |
| `x-commerce-signature` | `v1=<HMAC-SHA256 hex>` |

Canonical payload ที่ลงลายเซ็นคือ:

```text
v1
POST
/api/agent/v1/{resource}/query
SHA256(raw body)
request UUID
timestamp
environment
commerce-agent-api
```

ลายเซ็นครอบ method, path, body, request ID, เวลา, environment และ audience จึงไม่สามารถเปลี่ยน shop/filter หรือย้ายคำขอไป endpoint อื่นโดยใช้ signature เดิมได้ Body จำกัด 32 KiB และต้องผ่าน strict schema ก่อนเข้าฐานข้อมูล

## Request-time authorization

```mermaid
sequenceDiagram
  participant E as eve Runtime
  participant C as Commerce Core Authenticator
  participant D as PostgreSQL Security Function
  E->>C: Bearer credential + signed bounded query
  C->>C: method/path/size/time/env/audience/HMAC/schema
  C->>D: credential hash + requested shops/scope + request hashes
  D->>D: lock credential; recheck active/expiry/delegations
  D->>D: insert unique request receipt
  D-->>C: tenant/principal/scoped shops/scope/expiry
  C->>C: build trusted context + contract authorization
  C-->>E: authentication result for future route handler
```

Tenant มาจาก credential ในฐานข้อมูลเท่านั้น Query schema ไม่มี `tenantId` ร้านทุกแห่งต้องอยู่ใน delegation ที่ยังใช้งานและมี scope ของ operation นั้น ฐานข้อมูลตรวจ policy ใหม่ทุก request ดังนั้นการ revoke, expire หรือ retire credential มีผลกับคำขอถัดไปทันที

## Replay protection และ audit evidence

ตาราง `app.agent_service_request_receipts` ใช้ `(tenant_id, request_id)` เป็น primary key และบันทึกเฉพาะ:

- principal/credential ID
- scope และ shop IDs ที่ขอ
- environment/audience/method/path
- body hash และ canonical request hash
- request/authenticated timestamps

ไม่เก็บ raw credential, signature หรือ request body การ insert receipt และเพิ่ม authorized usage counter อยู่ใน transaction เดียวกับ authorization; request ID เดิมจึงถูกปฏิเสธแม้ยิงพร้อมกัน

## Stable failure semantics

| กรณี | Public code |
|---|---|
| ไม่มี credential | `UNAUTHENTICATED` |
| signature หายหรือผิด | `SIGNATURE_INVALID` |
| timestamp เกินหน้าต่าง | `REQUEST_EXPIRED` |
| request ID ซ้ำ | `REQUEST_REPLAYED` |
| identity หมดอายุ | `SERVICE_IDENTITY_EXPIRED` |
| environment/audience ผิด | `WRONG_ENVIRONMENT` / `WRONG_AUDIENCE` |
| scope/shop ไม่ได้รับมอบหมาย | `SCOPE_FORBIDDEN` / `SHOP_FORBIDDEN` |
| body มี `tenantId` หรือผิด schema | `INVALID_REQUEST` |

Public response ไม่มี SQL error, stack trace หรือข้อมูลบอกว่ามี tenant/shop อื่นอยู่จริง

## Verification

ผลรันรวม: **33 test files, 222 tests ผ่านทั้งหมด**

ชุด EVE-POC-04 ยืนยัน:

- success path สร้าง trusted context จาก credential และบันทึก safe receipt
- unsigned, bad signature และ stale timestamp ถูกปฏิเสธก่อนสร้าง receipt
- request เดิม replay ไม่ได้และมี receipt เพียงหนึ่งรายการ
- audience, runtime environment, operation scope และ delegated shop ถูกตรวจทุก request
- expired และ revoked credential ใช้ต่อไม่ได้
- caller ส่ง tenant เองไม่ได้ และ credential ของ tenant หนึ่งใช้ shop อีก tenant ไม่ได้
- runtime role ยังไม่เป็น owner/superuser/BYPASSRLS และทุกตาราง app ที่เปิด RLS ยังคง policy ตาม baseline

## ขอบเขตที่ยังปิด

- ยังไม่ mount Product/Sales/Inventory route และยังไม่มี Commerce data response
- ยังไม่มี Commerce API credential ใน Vercel Preview หรือ Production
- ยังไม่มี live AI, production data, marketplace account หรือ mutation tool
- ยังไม่มี rate limit/budget ต่อ principal และยังไม่กำหนด retention ของ request receipt
- raw service credential ต้องเก็บใน secret store, ส่งผ่าน HTTPS เท่านั้น และหมุนตาม credential lifecycle เดิม

งานถัดไปคือ **EVE-POC-05 — Commerce Lead delegation** โดยเริ่มจาก mount read-only Core handlers ที่ใช้ authenticator นี้ สร้าง bounded Commerce client/tool ใน runtime แล้วให้ Lead มอบหมาย Marketing Analysis และ Inventory Analysis ด้วย synthetic tenant data เท่านั้น
