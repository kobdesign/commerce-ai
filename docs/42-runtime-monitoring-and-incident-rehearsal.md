# Runtime monitoring, alert delivery และ Incident rehearsal — v1.16

วันที่ตรวจ local: 27 กันยายน 2026
ขอบเขต: REL-AG-01e

## ผลลัพธ์

- เพิ่ม monitor process ที่ตรวจ `/api/health` และ `/api/ready` แยกจาก web/worker
- แจ้งเตือนเมื่อ unavailable หรือ recovered หลังสถานะติดต่อกันตาม threshold เพื่อลด false alarm และไม่ส่งซ้ำขณะสถานะคงเดิม
- ส่ง webhook แบบ JSON พร้อม event ID, timestamp และ `HMAC-SHA256` retry ได้ 3 ครั้งโดยค่าเริ่มต้น
- กรอง readiness ให้ส่งต่อเฉพาะ `configuration`, `applicationDatabase`, `identityDatabase`, `worker` และ `importQueue`
- เพิ่ม queue readiness: งาน queued ที่ claim ได้แต่รอเกิน 10 นาที หรืองาน running เกิน 6 นาทีทำให้ `/api/ready` ตอบ unavailable
- เพิ่ม local incident rehearsal ที่ปิด switch ทั้งสอง, ตรวจ 503/read path/audit, เปิดกลับใน `finally` และเขียนรายงานแบบ permission `0600`

Monitor ไม่ส่ง connection string, instance ID, tenant/shop, queue count, raw evidence, error stack หรือค่าจาก response ที่ไม่อยู่ใน allowlist

## เริ่มใช้งาน

ตรวจครั้งเดียว:

```sh
MONITOR_BASE_URL=http://127.0.0.1:3001 npm run monitor:once
```

รันต่อเนื่อง:

```sh
MONITOR_BASE_URL=https://staging.example.com \
MONITOR_ENVIRONMENT=staging \
MONITOR_ALERT_WEBHOOK_URL=https://alerts.example.com/runtime \
MONITOR_ALERT_WEBHOOK_SECRET='<อย่างน้อย 32 ตัวอักษร>' \
npm run monitor:start
```

ค่าปรับได้:

| Environment | ค่าเริ่มต้น | ช่วงที่ยอมรับ | ความหมาย |
|---|---:|---:|---|
| `MONITOR_INTERVAL_SECONDS` | 30 | 10–300 | ระยะห่างระหว่างการตรวจ |
| `MONITOR_TIMEOUT_MS` | 5000 | 500–15000 | timeout ต่อ endpoint |
| `MONITOR_FAILURE_THRESHOLD` | 2 | 1–10 | จำนวนผลล้มติดต่อกันก่อนแจ้ง |
| `MONITOR_RECOVERY_THRESHOLD` | 2 | 1–10 | จำนวนผลผ่านติดต่อกันก่อนแจ้งว่าฟื้น |

Staging/production preflight บังคับ target และ webhook เป็น HTTPS พร้อม secret อย่างน้อย 32 ตัวอักษร Local อนุญาต loopback และพิมพ์ `local-alert` แทน webhook เมื่อยังไม่มี destination

## Webhook contract

Headers:

- `Content-Type: application/json`
- `X-Commerce-Event-Id`: UUID เดียวกับ payload
- `X-Commerce-Event-Timestamp`: เวลา ISO-8601 เดียวกับ payload
- `X-Commerce-Signature`: `sha256=<hex>` จาก HMAC ของ `<timestamp>.<raw-body>`

Payload schema version `1` มีเฉพาะ environment, `unavailable|recovered`, observed time และสถานะ checks ที่ผ่าน allowlist ผู้รับต้องตรวจ timestamp window, HMAC แบบ constant-time และ deduplicate ด้วย event ID ก่อนสร้าง incident/notification

ถ้า webhook ตอบไม่สำเร็จ monitor retry แบบ exponential แล้วเก็บ event ไว้ส่งซ้ำในรอบถัดไปตามลำดับ ไม่พิมพ์ secret หรือ response body ลง log การเก็บคิว alert อยู่ใน memory ของ process; production ควรใช้ alert provider ที่มี delivery durability หรือเพิ่ม durable outbox หลังเลือก provider

## Local incident rehearsal

```sh
npm run ops:rehearse-incident
```

Safety boundary:

- ทำงานได้เฉพาะ `APP_MODE=local-demo`
- `ADMIN_DATABASE_URL` และ `DATABASE_URL` ต้องเป็น loopback
- เริ่มได้เมื่อ switch ทั้งสองเปิดอยู่เท่านั้น
- คืน switch เป็นเปิดใน `finally` แม้ check ระหว่างทางล้มเหลว
- รายงานล่าสุดอยู่ที่ [incident-rehearsal-latest.json](evidence/incident-rehearsal-latest.json)

ผลรอบล่าสุดผ่าน `startedEnabled`, `controlsDisabled`, `mutationGateBlocked`, `readPathAvailable`, audit events 4 รายการ และ `controlsRestored`

## Outage/recovery rehearsal กับ process จริง

ซ้อม local ด้วย production build + worker + monitor interval 10 วินาที:

1. เริ่มจาก health/readiness healthy
2. หยุด web; รอบล้มครั้งแรกยังไม่แจ้ง
3. รอบล้มครั้งที่สองออก `unavailable` หนึ่ง event
4. ระหว่าง web ยังล่มไม่มี event ซ้ำ
5. เปิด web กลับ; รอบผ่านครั้งแรกยังไม่แจ้ง
6. รอบผ่านครั้งที่สองออก `recovered` หนึ่ง event
7. readiness หลังฟื้นผ่าน configuration, database roles, worker และ import queue

## Staging rehearsal gate

ยังไม่ได้ซ้อมกับ staging จริง เพราะ workspace นี้ไม่มี `MONITOR_BASE_URL`, alert destination และ incident owner ที่อนุมัติ ห้ามใช้ local alert เป็นหลักฐานว่า notification ปลายทางจริงทำงานแล้ว

เมื่อข้อมูลพร้อม ให้กำหนด maintenance window และทำตามลำดับ:

1. ตรวจ `release:preflight -- monitor`, health/ready และ `ops:status`
2. เริ่ม monitor จาก service/runner ที่แยกจาก web และ worker
3. ปิด `web_mutations`; ยืนยันหน้าอ่านยังใช้ได้และ mutation ตอบ `503 / OPERATION_PAUSED`
4. ปิด `import_commits`; สร้าง synthetic queued job ที่อนุมัติสำหรับ staging และยืนยันว่าไม่ถูก claim
5. ทำให้ health หรือ readiness ล้มตาม failure mode ที่อนุมัติ ห้ามใช้ production/customer data
6. ยืนยัน alert destination ได้ unavailable เพียงครั้งเดียวพร้อมลายเซ็นและ incident owner รับทราบ
7. คืน dependency และเปิด `import_commits` ก่อน `web_mutations`
8. ยืนยัน recovered เพียงครั้งเดียว, queue ระบาย, switches เปิด และบันทึก evidence/เวลา

การเพิ่ม monitor service ใน Render ยังไม่ทำใน `render.yaml` เพราะจะสร้างทรัพยากรที่มีค่าใช้จ่ายและยังไม่มี alert destination/owner ที่อนุมัติ

## Verification

- integration/regression **121/121** ผ่าน
- TypeScript, ESLint และ production build ผ่าน
- HMAC exact-body, retry, allowlist, malformed response, threshold และ recovery ผ่าน automated tests
- queue-lag readiness ผ่าน automated database test
- local incident rehearsal ผ่านและคืน switches เป็น enabled
- local process outage/recovery rehearsal ผ่าน
- Browser E2E ล่าสุดยังเป็น **26/26** จาก v1.15; รอบนี้ไม่เปลี่ยน user workflow

ขอบเขตที่ยังรอ: staging URL, alert provider/channel, incident owner/escalation policy, Render monitor resource approval และ staging rehearsal evidence
