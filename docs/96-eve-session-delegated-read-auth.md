# Eve Session-Delegated Commerce Reads

สถานะ: **Engineering complete for synthetic local/staging evaluation** วันที่ 28 พฤศจิกายน 2026

## ผลลัพธ์

Eve runtime ไม่ต้องกำหนด `COMMERCE_AGENT_TENANT_ID`, `COMMERCE_AGENT_CANARY_SHOP_IDS` หรือ service credential ราย tenant ใน Vercel อีกต่อไป Tenant, ร้าน, ผู้ใช้, role, session และ policy version มาจาก signed continuation grant ที่ Commerce Core ออกให้ในแต่ละ turn

เมื่อ Eve รับ grant จะต้อง consume แบบ one-time ก่อน จากนั้น read tool ใช้ grant เดิมเป็น short-lived bearer สำหรับ Products, Sales และ Inventory APIs โดย Commerce Core ตรวจซ้ำกับ durable grant/session/policy records ก่อนอ่านข้อมูลทุกครั้ง

## Security boundary

- grant มีอายุไม่เกิน 5 นาทีและใช้เริ่ม turn ได้ครั้งเดียว
- read request ต้องเป็น continuation grant ที่ผูกกับ Eve session ปัจจุบัน
- tenant และร้านมาจากลายเซ็นของ Commerce Core ไม่รับจาก prompt หรือ Vercel config
- query ร้านนอก signed scope ถูกปฏิเสธ
- policy ต้อง active, environment ตรง, version ตรง และยังไม่หมดอายุ
- session และสมาชิกต้องยัง active ณ เวลาที่ tool เรียก
- request/result receipt แยกจาก service principal receipts และรองรับ exact retry
- การ revoke tenant policy ทำให้ session และ tool call ถัดไปใช้ไม่ได้

## Code references

- `packages/db/migrations/0057-agent-session-read-delegation.sql` — delegated receipts, current-state authorization และ result idempotency
- `packages/agent-api/src/index.ts` — service credential / session grant dual authentication
- `packages/commerce-agent-client/src/index.ts` — short-lived grant client mode
- `apps/agent-runtime/agent/lib/commerce-canary-auth.ts` — consumes and pins the signed grant to the current Eve principal
- `apps/agent-runtime/agent/lib/commerce-scope.ts` — requires a fresh continuation grant for tools
- `apps/agent-runtime/agent/lib/runtime-policy.ts` — rejects tenant/shop pinning and tenant credentials in Vercel
- `tests/agent-read-api.test.ts` — delegated read, receipt, tenant isolation and out-of-scope shop rejection

## Verification

- TypeScript typecheck: ผ่าน
- ESLint: ผ่าน
- Agent runtime tests: **12/12 ผ่าน**
- Targeted routing/read integration: **18/18 ผ่าน**
- Full unit/integration suite: **324/324 ผ่าน จาก 53 test files**
- Next.js production build: ผ่าน
- Eve build บน Node.js 24: ผ่าน
- Live model calls: 0

## Deployment transition

ก่อนเปิด Preview ใหม่ให้ลบ legacy variables สามตัวจาก Vercel Preview แล้วกำหนด canary expiry รอบใหม่แบบไม่เกิน 4 ชั่วโมง การเปลี่ยนนี้ไม่เปิด production และไม่เพิ่ม mutation tool
