# EVE-CANARY-15 — Deployable Alert Receiver Runtime

สถานะ: **Engineering runtime complete; Vercel/Redis/provider delivery pending** วันที่ 17 พฤศจิกายน 2026

## ผลลัพธ์

เพิ่ม `apps/alert-bridge` เป็น Next.js 16 Node.js service แยกจาก Commerce Web, PostgreSQL และ Eve Agent Runtime ตัว service รับ signed metadata-only alert ที่ `POST /api/v1/alerts`, ตรวจสัญญาจาก EVE-CANARY-14 และใช้ Upstash Redis `SET NX PXAT` เป็น atomic consume เพื่อกัน event ID ซ้ำข้าม instance และ restart

เส้นทาง operational:

- `GET /api/health` — process liveness โดยไม่ตรวจ secret หรือ external dependency
- `GET /api/ready` — fail closed เมื่อ configuration ไม่ครบหรือ Redis ตอบไม่สำเร็จ
- `POST /api/v1/alerts` — ตอบ 202 เฉพาะ alert ที่ signature, timestamp, strict schema, environment/source scope และ replay guard ผ่าน

Response มีเฉพาะ event ID, source, environment, status, timestamp, tenant ID และ `contentCaptured:false` ไม่มี prompt, model output, customer payload หรือ secret และระบุ `incidentDelivery: pending-provider-adapter` ตามสถานะจริง

## Deployment boundary

สร้าง Vercel project แยกโดยตั้ง Root Directory เป็น `apps/alert-bridge` แล้วเชื่อม dedicated Upstash Redis จาก Vercel Marketplace ตัว integration จะ inject Redis credentials เข้า project environment โดยอัตโนมัติ ห้ามใช้ Commerce PostgreSQL เป็น replay cache และห้ามแชร์ signing secret ไป Better Stack

Environment ที่ต้องกำหนด:

```text
ALERT_BRIDGE_ENVIRONMENT=staging
ALERT_BRIDGE_ALLOWED_SOURCES=commerce-agent-canary-monitor
ALERT_BRIDGE_SIGNING_SECRET=<random secret at least 32 characters>
UPSTASH_REDIS_REST_URL=<injected by integration>
UPSTASH_REDIS_REST_TOKEN=<injected by integration>
```

secret เดียวกันต้องตั้งที่ sender monitor เป็น `MONITOR_ALERT_WEBHOOK_SECRET`; URL sender ชี้ไป `https://<alert-bridge>/api/v1/alerts` การเปลี่ยน environment variable ต้อง redeploy ก่อนค่าจะมีผล

อ้างอิง provider: [Vercel Marketplace Storage](https://vercel.com/docs/marketplace-storage), [Vercel Redis](https://vercel.com/docs/redis), [Upstash SET command](https://upstash.com/docs/redis/sdks/ts/commands/string/set), [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)

## Verification

- config ขาด secret, source ว่างหรือ source นอก allowlist ถูกปฏิเสธ
- replay adapter ใช้ Redis operation เดียวพร้อม `NX` และ `PXAT`
- alert ถูกต้องผ่านและคืน safe projection
- event ซ้ำตอบ 409
- signature ผิดตอบ 401
- declared request ใหญ่เกิน 16 KiB ตอบ 413 ก่อนเรียก replay store
- Redis error ตอบ 503 โดยไม่ส่งรายละเอียดภายใน
- TypeScript, ESLint, targeted tests 10/10, integration suite 313/313 และ Next.js production build ผ่าน
- production-server smoke test ให้ health 200 และ readiness 503 เมื่อ Redis ใช้งานไม่ได้ตาม fail-closed contract
- GitHub Actions มี job `alert-bridge` บน Node 24

รันซ้ำได้ด้วย:

```sh
npm run alert-bridge:typecheck
npx vitest run tests/alert-bridge-runtime.test.ts tests/alert-verification.test.ts
npm run alert-bridge:build
```

## สิ่งที่ยังไม่อ้างว่าสำเร็จ

- ยังไม่ได้สร้าง Vercel project หรือ Upstash resource
- ยังไม่มี network delivery จาก Render monitor เข้า receiver ที่ deploy จริง
- ยังไม่มี Better Stack provider adapter, incident ID, human acknowledgement หรือ escalation evidence
- ยังไม่เติม `preflightEvidence.alertDeliveryDryRun` ใน staging plan
- ยังไม่เปิด Live AI, Eve routing, marketplace writes หรือ real-tenant canary

## งานถัดไป

1. สร้าง Vercel project สำหรับ `apps/alert-bridge` และเลือก Upstash plan หลังตรวจค่าใช้จ่าย
2. ตั้ง secret แบบ project-scoped และ deploy preview/staging
3. ต่อ Better Stack incoming webhook adapter พร้อม delivery idempotency โดยไม่ส่ง signing secret
4. ส่ง synthetic breach/recovery ผ่าน network จริงและให้ `github:kobdesign` acknowledge
5. บันทึก provider incident ID, event ID, delivery/ack timestamp และผล replay test แล้วจึงปิด alert-delivery gate

## Code references

- `apps/alert-bridge/app/api/v1/alerts/route.ts`
- `apps/alert-bridge/app/api/ready/route.ts`
- `apps/alert-bridge/src/receiver.ts`
- `apps/alert-bridge/src/replay-store.ts`
- `tests/alert-bridge-runtime.test.ts`
