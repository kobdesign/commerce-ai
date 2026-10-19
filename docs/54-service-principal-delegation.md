# AUTH-AG-01a — Service Principal และ delegated shop scopes v1.28

วันที่ส่งมอบ: 18 ตุลาคม 2026
สถานะ: **Local synthetic complete · Machine ingress scoped · No provider connector**

## ผลลัพธ์

ระบบเชื่อมต่อไม่ต้องรับสิทธิ์ระดับ deployment เพื่อระบุ tenant และร้านเองอีกต่อไป เจ้าของบริษัทสร้าง Service Principal แยกตาม connector/environment และกำหนดร้าน, scope และวันหมดอายุให้แต่ละตัวได้ โดย secret แสดงครั้งเดียวและฐานข้อมูลเก็บเฉพาะ SHA-256 hash กับ prefix ที่ปลอดภัยสำหรับตรวจสอบ

Event ขาเข้าต้องผ่าน `app.ingest_scoped_integration_inbox_event` ซึ่งตรวจ credential, tenant, shop, `integration:ingest`, expiry และสถานะเพิกถอนภายใน transaction ก่อนบันทึก Inbox ทุกครั้ง สิทธิ์เรียกฟังก์ชัน ingest เดิมถูกถอนจาก `commerce_queue` แล้ว จึงไม่สามารถข้าม delegated policy ด้วย queue role ได้

## UX และสิทธิ์

- Owner เปิด `/team/service-access` เพื่อสร้าง credential โดยยืนยันร้าน, scope และวันหมดอายุ
- Secret แสดงครั้งเดียวหลังสร้าง; หน้ารายการและ API ส่งกลับเฉพาะ prefix
- Owner เพิกถอนพร้อมเหตุผลและ optimistic version; credential เดิมใช้กับคำขอใหม่ไม่ได้ทันที
- Auditor ตรวจชื่อ, prefix, ร้าน, scope, expiry และเหตุผลเพิกถอนได้แบบ read-only
- Operator และ Marketing เข้า workspace นี้ไม่ได้
- ประวัติที่ commit ก่อนเพิกถอนยังคงอยู่เป็นหลักฐาน ไม่ถูกย้อนหรือลบ

## โครงสร้างข้อมูลและขอบเขต

- `app.service_principals` เก็บ identity, lifecycle, expiry, actor และ version
- `app.service_principal_delegations` ผูก principal กับร้านและ scopes
- `private.service_principal_credentials` เก็บ hash/prefix/last-used และไม่เปิดให้ application tenant role อ่านโดยตรง
- RLS จำกัดรายการตาม tenant และ shop grants ของ Owner/Auditor
- Audit บันทึกการสร้างและเพิกถอน โดยไม่บันทึก plaintext secret

Migration อยู่ที่ `0040-service-principals.sql` และ corrective migration `0041-service-principal-authorize-fix.sql`

## การตรวจรับ

Integration 7 กรณีใหม่ผ่าน ครอบคลุม:

1. secret entropy, one-time disclosure, hash/prefix และ audit
2. scoped wrapper เป็น ingress path เดียวของ queue role
3. missing scope และร้านนอก delegation ถูกปฏิเสธก่อน insert
4. revocation ตรวจ policy ล่าสุดทุก Event และรักษาหลักฐานเดิม
5. expired credential ใช้งานไม่ได้
6. Owner/Auditor/Operator/Marketing และ private credential boundary
7. concurrent revocation สำเร็จหนึ่งคำสั่งด้วย optimistic version

Regression รวม `191/191` ผ่าน

Browser 2/2 ผ่าน:

1. Owner สร้าง credential, เห็น secret ครั้งเดียว และเพิกถอนพร้อมเหตุผล
2. Auditor บน mobile 390×844 เห็น read-only view ไม่มี mutation control และไม่มี horizontal overflow

Typecheck, lint และ production build ผ่าน

## ข้อจำกัด

- ยังไม่มี credential rotation แบบ overlap, environment/audience binding หรือ service-to-service mTLS
- Scope `integration:read` และ `outbox:publish` เป็น vocabulary สำหรับงานถัดไป แต่รอบนี้มี enforcement path จริงเฉพาะ `integration:ingest`
- ยังไม่มี TikTok/Shopee/Lazada webhook adapter, OAuth/seller authorization, rate-limit handling หรือ provider key rotation
- Credential เป็น bearer secret ผู้ deploy ต้องเก็บใน secret manager และห้ามวางใน source code, browser storage หรือ log
- การ revoke หยุดคำขอใหม่ ไม่ย้อน Event หรือ side effect ที่ commit แล้ว

## งานถัดไป

AUTH-AG-01b ส่งมอบแล้วใน [Credential rotation v1.29](55-service-credential-rotation.md) งานต่อคือ connector ingress gateway และ provider adapter contract แบบ synthetic/read-only ก่อนเชื่อม API จริง
