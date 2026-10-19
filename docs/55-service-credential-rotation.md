# AUTH-AG-01b — Credential rotation, audience binding และ usage telemetry v1.29

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Dual-key overlap · No provider connector**

## ผลลัพธ์

Owner หมุน Secret ของ Service Principal ได้โดยไม่ต้องหยุด connector ทันที Secret ใหม่เริ่มใช้ได้ทันที ส่วน Secret เดิมอยู่ในสถานะ `retiring` และใช้ได้ถึงเวลาสิ้นสุดช่วงทับซ้อน 5 นาที–24 ชั่วโมง หลังจากนั้น authorization ปฏิเสธ Secret เดิมอัตโนมัติ

ทุก credential ผูกกับ `environment` (`development`, `staging`, `production`) และ `audience` ของระบบปลายทาง นอกเหนือจาก tenant, shop และ scope เดิม การรับ Event ตรวจขอบเขตทั้งหมดใน transaction ทุกครั้ง จึงลดความเสี่ยงจากการนำ Secret ของ Staging ไปใช้กับ Production หรือใช้กับ connector คนละประเภทโดยไม่ตั้งใจ

## UX และ telemetry

- หน้า `/team/service-access` แสดงจำนวน credential ที่รับคำขอได้, รายการใกล้หมดอายุภายใน 7 วัน และจำนวนคำขอที่ผ่าน authorization
- แต่ละ Service Principal แสดง Environment, Audience และประวัติ credential แบบ safe metadata
- สถานะ credential แยก `active`, `retiring`, `retired`, `expired` และ `revoked`
- แสดง prefix, เวลาใช้ล่าสุด, จำนวนคำขอที่ผ่านสิทธิ์, วันหมดอายุหรือเวลาหยุดรับคำขอ โดยไม่คืน hash หรือ plaintext secret
- การหมุนต้องระบุวันหมดอายุใหม่ ช่วงทับซ้อน เหตุผล และ human confirmation
- Secret ใหม่แสดงครั้งเดียว พร้อมเวลาที่ Secret เดิมหยุดทำงาน
- Auditor ตรวจ telemetry ได้แบบ read-only; Owner เท่านั้นที่สร้าง หมุน หรือเพิกถอน

## Data และ authorization contract

- `app.service_principals` เพิ่ม `environment` และ `audience`
- `private.service_principal_credentials` เพิ่ม `retire_at`, rotation lineage, `last_used_at` และ `authorized_request_count`
- `app.rotate_service_principal_credential` lock principal, ตรวจ optimistic version, กำหนดเวลาหยุด Secret เดิม และสร้าง Secret ใหม่แบบ atomic
- `app.authorize_service_principal` ตรวจ credential lifecycle + environment/audience + tenant/shop/scope ก่อนเพิ่ม usage telemetry
- `app.service_principal_credential_summaries` เปิดเฉพาะ safe projection ให้ Owner/Auditor ที่มี shop grant
- Emergency revoke ปิด credential ทุกชุด รวม Secret เก่าและใหม่ที่อยู่ในช่วง overlap

Migration: `0042-service-credential-rotation.sql`

## การตรวจรับ

Service Principal integration 11/11 ผ่าน ครอบคลุม:

1. hash-only storage และ one-time disclosure
2. scoped queue boundary
3. shop/scope denial ก่อน Inbox write
4. current-policy revocation และ evidence retention
5. credential expiry
6. environment/audience mismatch
7. dual-key overlap และ automatic retirement
8. safe usage count/last-used projection
9. concurrent rotation ด้วย optimistic version
10. Auditor read-only และ private table boundary
11. emergency revoke ปิดทุก Secret ระหว่าง overlap

Browser 2/2 ผ่าน:

1. Owner สร้าง → หมุนพร้อม overlap → ตรวจสองสถานะ → เพิกถอนครบ flow
2. Auditor mobile 390×844 เห็น telemetry แบบ read-only และหน้าไม่ล้นแนวนอน

Regression รวม `195/195` ผ่าน พร้อม typecheck, lint และ production build

## ข้อจำกัด

- Usage count นับคำขอที่ผ่าน authorization และ commit สำเร็จ ไม่ใช่ billing meter หรือ security-event counter
- คำขอที่ใช้ Secret สุ่มหรือผิด scope ถูกปฏิเสธ แต่รอบนี้ยังไม่เก็บรายละเอียดความล้มเหลวเพื่อหลีกเลี่ยงการสร้าง write amplification และข้อมูลโจมตีใน tenant telemetry
- ยังไม่มี secret-manager integration, automatic rotation scheduler, mTLS หรือ SIEM export
- ยังไม่มี OAuth/seller authorization, webhook endpoint หรือ provider-specific signing/rate-limit contract
- Environment/Audience ลด accidental reuse แต่ bearer Secret ที่รั่วไหลยังต้องแก้ด้วย emergency revoke และการจัดเก็บ Secret ที่เหมาะสม

## งานถัดไป

CON-API-01a: สร้าง connector ingress gateway และ provider adapter contract แบบ synthetic/read-only ใช้ Service Principal v1.29, ตรวจ signature/replay/rate-limit metadata และแปลงเฉพาะ safe canonical Event เข้า Inbox โดยยังไม่เขียน Order/Inventory และไม่อ้างว่าเข้ากันได้กับ API จริงจน DEC-05/06 กับ sandbox/API access พร้อม
