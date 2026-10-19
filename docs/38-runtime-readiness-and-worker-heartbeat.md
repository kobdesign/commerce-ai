# Product workflow v1.12 — Runtime readiness และ worker heartbeat

วันที่: 24 กันยายน 2026 · งาน: REL-AG-01a

## ผลลัพธ์

เพิ่ม operational readiness ที่แยกจาก health check เดิม เพื่อจับกรณีเว็บยังตอบได้แต่ระบบ login ใช้ไม่ได้, runtime ต่อฐานข้อมูลด้วย role ที่มีสิทธิ์สูงเกินไป หรือ background worker หยุดจนงานนำเข้าค้าง

- `GET /api/health` คงเป็น health check ขั้นต่ำของ web/application database สำหรับ load balancer
- `GET /api/ready` ตรวจ configuration, application database, identity database, worker heartbeat, import queue lag และ transactional outbox lag พร้อมกัน ตอบ `200` เมื่อครบ และ `503` แบบ fail-closed เมื่อส่วนใดไม่พร้อม
- Database checks ยืนยัน role `commerce_app` / `commerce_identity` และปฏิเสธ superuser หรือ `BYPASSRLS`
- Worker บันทึก heartbeat ทุก 15 วินาที; readiness ถือว่า stale หลัง 45 วินาที และ worker ระบุ stopped เมื่อปิดตามปกติ
- Response เปิดเผยเฉพาะสถานะ `ok`/`unavailable` ของแต่ละส่วน ไม่ส่ง connection string, database details, instance ID หรือ timestamp
- เพิ่ม `npm run readiness:check` สำหรับ smoke check จาก runtime environment

ตัวอย่างผลเมื่อพร้อม:

```json
{
  "status": "ok",
  "checks": {
    "applicationDatabase": "ok",
    "identityDatabase": "ok",
    "worker": "ok",
    "importQueue": "ok",
    "outboxQueue": "ok"
  }
}
```

## Data model และขอบเขตสิทธิ์

Migration `0024-service-readiness.sql` เพิ่ม `app.service_heartbeats` แบบไม่มี tenant business data เพราะเป็น operational state ระดับ deployment ตารางไม่ grant ให้ runtime อ่านหรือเขียนโดยตรง Runtime เรียกเฉพาะ security-definer functions ที่รับ service `worker` และ instance ID ความยาวจำกัด พร้อมล้างแถวที่เก่ากว่า 7 วัน

ข้อมูล heartbeat ไม่ใช้เป็นหลักฐานว่างานแต่ละรายการสำเร็จ และไม่แทน job-level status/retry/audit ที่มีอยู่แล้ว หากมี worker หลาย instance readiness พร้อมเมื่ออย่างน้อยหนึ่ง instance มีสถานะ running และ heartbeat ยังสด

## Verification

- `npm run typecheck` ผ่าน
- `npm run lint` ผ่าน
- `npm test` ผ่าน 16 files, 106 tests
- Test ใหม่ยืนยัน heartbeat fresh → readiness พร้อม และ stopped → readiness unavailable
- Migration ใช้ role เดิมที่ไม่ใช่ owner/superuser/BYPASSRLS และ automated test สร้างฐานข้อมูลแยกเหมือนเดิม
- Local smoke check หลัง migration: เมื่อ worker ทำงาน `npm run readiness:check` ตอบทุก check เป็น `ok`; หลังหยุด worker คำสั่งออกด้วยสถานะไม่ผ่านและรายงานเฉพาะ `worker: unavailable`

Browser E2E 26/26 เป็นผลล่าสุดจาก v1.11 และไม่ได้รันซ้ำในรอบนี้ เพราะไม่มีการเปลี่ยน user workflow; endpoint ใหม่และ database functions ตรวจผ่าน integration test แล้ว

## ข้อจำกัดและงานต่อไป

REL-AG-01 ยังไม่เสร็จทั้งก้อน ความสามารถนี้ยืนยัน runtime dependencies เท่านั้น และจงใจไม่ทำให้ production ผ่านด้วย configuration หลอก:

1. Production identity adapter, invitation และ MFA/SSO ยังรอ DEC-03
2. Raw files ยังอยู่ PostgreSQL bytea; ต้องย้ายไป private object storage พร้อม scoped access และ lifecycle
3. ต้องเลือก backup policy และทำ restore rehearsal พร้อมหลักฐาน RPO/RTO
4. Monitoring/signed alert tooling มีแล้วตาม docs/42 แต่ต้องเชื่อม staging alert destination และ incident owner จริง
5. Data/model policy, budget และ human UAT ยังเป็น gate ก่อน pilot จริง

งานถัดไปที่ทำได้โดยไม่รอ provider คือออกแบบและทดสอบ storage adapter contract/lifecycle ด้วย local test backend โดยไม่อ้างว่าเป็น private production object storage
