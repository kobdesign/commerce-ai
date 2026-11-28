# Platform AI Control Center

สถานะ: **Engineering complete for synthetic local/staging evaluation** วันที่ 28 พฤศจิกายน 2026

## ปัญหาที่แก้

การกำหนด tenant ที่ใช้ AI ผ่าน Environment Variable ทำให้ทุกครั้งที่เพิ่มหรือหยุดบริษัทต้องแก้ deployment configuration และ deploy ใหม่ ซึ่งไม่เหมาะกับ Multi-Tenant SaaS และไม่ทิ้งประวัติระดับ tenant ที่ตรวจสอบได้

รอบนี้ย้าย tenant enrollment มาเป็น policy ใน PostgreSQL และเพิ่มหน้า **AI Control Center** สำหรับ Platform Owner ที่ `/platform/ai` ส่วน Render/Vercel คงรับผิดชอบเฉพาะ global availability, runtime endpoint, credentials และ emergency kill switch

## ขอบเขตที่ส่งมอบ

- Platform Owner เห็นบริษัททั้งหมดโดยไม่ต้องสลับ tenant ทีละราย
- เปิด AI แบบอ่านอย่างเดียวให้ tenant พร้อมเหตุผลและเวลาหมดอายุ 5 นาที–24 ชั่วโมง
- ปิด AI และ revoke active grant/session ของ tenant นั้นทันที
- บันทึก actor, เวลา, เหตุผล, environment และ policy version ใน durable audit
- AI workspace และ conversation API อ่าน policy ปัจจุบันจากฐานข้อมูลทุกครั้ง
- บริษัทที่ไม่มี policy, policy หมดอายุ, ถูก revoke หรือ environment ไม่ตรงยัง fail closed
- เมนูและ API ของ Platform Control Plane จำกัดด้วย `private.platform_operators`

## Control boundary

| ชั้น | หน้าที่ |
|---|---|
| Deployment configuration | เปิดความสามารถระดับระบบ, emergency kill switch, runtime URL และ secrets |
| Platform AI Control Center | เลือก tenant, กำหนดช่วงเวลา, เหตุผล และ revoke |
| Commerce Core | ตรวจ tenant/shop/user, ออก one-time grant, บังคับ read-only scope และบันทึก audit |
| Eve runtime | ทำงานตาม grant ที่ Core ออกให้ โดยไม่มีสิทธิ์อ่านฐานข้อมูล Commerce โดยตรง |

## Bootstrap ownership

ระยะแรก demo platform owner เป็นผู้ดูแลเพียงคนเดียวตามการตัดสินใจของเจ้าของโครงการ จึงสามารถ activate synthetic local/staging policy ได้โดยตรง หน้าที่นี้ไม่เท่ากับ tenant `owner` และไม่เกิดจากการเลือก tenant ใน session

ก่อน production หรือก่อนเพิ่มผู้ดูแล ต้องเพิ่ม lifecycle สำหรับ Platform Operator, MFA/SSO และ separation of duties ตามนโยบายองค์กร โดยไม่ใช้ seed เป็นวิธีจัดการบัญชีจริง

## Code references

- `packages/db/migrations/0056-platform-agent-control.sql` — platform operator, cross-tenant workspace, activate/revoke และ audit
- `packages/db/src/index.ts` — typed platform operations และ runtime policy lookup
- `apps/web/app/(workspace)/platform/ai/page.tsx` — server-side Platform Owner boundary
- `apps/web/components/platform-ai-control-center.tsx` — directory, activation และ revocation UI
- `apps/web/app/api/platform/agent-routes/route.ts` — authenticated management API
- `apps/web/lib/agent-workspace.ts` — dynamic tenant routing decision
- `apps/web/lib/agent-conversation-server.ts` — policy lookup ก่อน create/continue/end conversation
- `tests/agent-route-control-plane.test.ts` — cross-tenant owner boundary, activate, issue grant และ revoke
- `tests/e2e/platform-ai-control.spec.ts` — browser flow เปิดและปิด tenant AI

## Verification

- TypeScript typecheck: ผ่าน
- ESLint: ผ่าน
- Unit/integration: **323/323 ผ่าน จาก 53 test files**
- Production build: ผ่าน และมี route `/platform/ai`, `/api/platform/agent-routes`
- Browser E2E บนฐานข้อมูลแยก: **1/1 ผ่าน**
- Live model calls: 0
- Production tenant enrollment: 0

## สิ่งที่ยังปิดอยู่

หน้า Control Center จัดการ tenant policy ได้แล้ว แต่การสนทนาจริงยังต้องผ่าน global gates ได้แก่ Eve runtime availability, kill switch, conversation feature flag, credentials, budget และ approved test window การ merge/deploy งานนี้จึงไม่เปิด Live AI โดยอัตโนมัติ
