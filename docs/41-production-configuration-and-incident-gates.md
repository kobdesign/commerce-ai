# Production configuration gates และ Incident runbook — v1.15

วันที่ตรวจ local: 27 กันยายน 2026
ขอบเขต: REL-AG-01d

## สิ่งที่ส่งมอบ

- `release:preflight` ตรวจ `APP_MODE`, trusted origin, staging AI boundary และ production capabilities ก่อนเปิด web/worker
- `/api/ready` รวม configuration gate เข้ากับ database roles และ worker heartbeat
- startup ของ web (`npm start`), Render service และ worker ปฏิเสธ configuration ที่ไม่ผ่าน
- operational controls สองตัวใน PostgreSQL พร้อมประวัติผู้เปลี่ยน เหตุผล และเวลา
  - `web_mutations`: หยุดการสร้าง/แก้ไข/ยืนยันข้อมูล แต่ยังให้ login, เลือก workspace, เปิดรายงาน และใช้ inspect/preview/status ที่ไม่เขียนข้อมูล
  - `import_commits`: หยุด worker จากการ claim งาน import ใหม่ งานที่ claim ไปแล้วจะทำต่อจนถึง transaction boundary
- runtime role อ่านสถานะผ่าน function แบบ fail closed เท่านั้น การเปลี่ยน switch ต้องใช้ admin connection

Production preflight **ยังต้องไม่ผ่าน** เพราะยังไม่มี audited production identity adapter และ private production evidence storage การออกแบบนี้ตั้งใจป้องกันการนำ demo identity หรือ inline evidence backend ไปเปิดรับข้อมูลจริงโดยไม่ตั้งใจ ไม่มี environment variable สำหรับข้าม gate นี้

## Release preflight

ตรวจ web และ worker ด้วย environment ของปลายทาง:

```sh
npm run release:preflight -- web
npm run release:preflight -- worker
```

ผลต้องเป็น `status: ok` ทุก check จึงเปิด service ได้ `staging-demo` ต้องใช้ HTTPS origin และ `AI_ENABLED=false` ส่วน `production` จะถูก block จนกว่า capability ที่ขาดจะถูก implement, review และเปลี่ยนสถานะในโค้ดพร้อมหลักฐาน

หลัง deploy ให้ตรวจทั้งสอง endpoint:

```sh
curl --fail --silent --show-error https://<host>/api/health
curl --fail --silent --show-error https://<host>/api/ready
```

`health` ใช้ตัดสินว่า process/database ตอบสนองขั้นต้น ส่วน `ready` ใช้ตัดสินว่า configuration, restricted roles และ worker พร้อมรับงานครบ ห้ามใช้ health ผ่านเพียงตัวเดียวเป็นหลักฐานเปิด pilot

## ดูและเปลี่ยน operational controls

คำสั่งเหล่านี้ต้องมี `ADMIN_DATABASE_URL` ของ environment เป้าหมาย ห้ามส่ง connection string ใน ticket/chat/log

```sh
npm run ops:status

npm run ops:control -- set \
  --control web_mutations \
  --enabled false \
  --reason "INC-123 freeze writes while reconciling impact" \
  --actor "oncall@example.com"

npm run ops:control -- set \
  --control import_commits \
  --enabled false \
  --reason "INC-123 stop claiming new import jobs" \
  --actor "oncall@example.com"
```

ตรวจ `ops:status` หลังทุกการเปลี่ยน และบันทึก JSON ที่ไม่มี secret ไว้ใน incident evidence เหตุผลควรมี incident/ticket ID และข้อความที่บอกวัตถุประสงค์ ห้ามแก้ตารางด้วย SQL โดยตรงในขั้นตอนปกติ

## Incident procedure

1. เปิด incident ID ระบุเวลา environment ผู้ประสานงาน และอาการที่ยืนยันได้
2. ถ้าความถูกต้องของข้อมูลยังไม่ชัด ให้ปิด `web_mutations` ก่อน ถ้าเกี่ยวกับ import/worker ให้ปิด `import_commits` เพิ่ม
3. ตรวจ `ops:status`, `/api/health`, `/api/ready`, deployment/log และจำนวนงาน `queued/running` โดยไม่เปลี่ยนข้อมูล
4. ระบุ tenant/shop/time range ที่อาจได้รับผลกระทบ หลีกเลี่ยงการพิมพ์ข้อมูลลูกค้าและหลักฐานดิบลง log หรือ ticket
5. เลือก recovery ตามหลักฐาน: rollback release, แก้ configuration, recovery transaction หรือ restore ตาม [restore rehearsal](40-backup-restore-rehearsal.md)
6. ทดสอบ fix กับ synthetic/staging และรัน regression ที่เกี่ยวข้อง ห้ามเปิด switch เพียงเพราะ process กลับมาตอบ
7. เปิด `import_commits` เมื่อ schema/data invariants และ worker พร้อม จากนั้นเปิด `web_mutations` เมื่อ write path ผ่าน smoke test
8. ตรวจสถานะอีกครั้ง เฝ้าดู error rate, queue age และ reconciliation anomalies แล้วบันทึกเวลา recovery
9. ทำ post-incident review ระบุ root cause, affected scope, detection gap, corrective owner และ regression test

## Recovery criteria

เปิด switch กลับได้เมื่อมีหลักฐานทุกข้อที่เกี่ยวข้อง:

- migration/schema checksum ตรงกับ release
- restricted runtime roles, tenant isolation และ evidence integrity ยังผ่าน
- ไม่มีงาน running ที่ไม่ทราบผล; งาน queued มีแผน replay/idempotency ชัดเจน
- write smoke test ด้วย synthetic tenant ผ่าน และรายการที่สร้างตรวจสอบย้อนกลับได้
- ผู้รับผิดชอบ incident อนุมัติการเปิด พร้อม reason/actor ใหม่ใน audit trail

คำสั่งเปิดกลับ:

```sh
npm run ops:control -- set --control import_commits --enabled true --reason "INC-123 recovery checks passed" --actor "oncall@example.com"
npm run ops:control -- set --control web_mutations --enabled true --reason "INC-123 write smoke test passed" --actor "oncall@example.com"
npm run ops:status
```

## Verification evidence

- TypeScript และ ESLint ผ่าน
- integration/regression **114/114** ผ่าน
- production preflight ปฏิเสธ `production` ด้วย `production-identity` และ `private-evidence-storage`
- local preflight ผ่าน
- ทดสอบ default enabled, disabled response `503 / OPERATION_PAUSED`, read-only parsing ระหว่าง freeze, audit event และ recovery เป็น enabled

Monitoring และ local rehearsal ส่งมอบต่อใน [v1.16](42-runtime-monitoring-and-incident-rehearsal.md) ขอบเขตที่ยังไม่ส่งมอบคือ production identity, external private object storage/retention, production backup policy/RPO/RTO, alert destination/owner จริง และการซ้อม incident บน staging
