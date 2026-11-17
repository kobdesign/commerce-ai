# EVE-POC-02 — Vercel Non-Production Runtime Foundation

วันที่ตรวจรับ: 13 พฤศจิกายน 2026
สถานะ: **Pass — Preview only, live AI blocked**

## ผลลัพธ์

สร้าง eve runtime แยกใน monorepo ที่ [`apps/agent-runtime`](../apps/agent-runtime) และ deploy ไป Vercel project `commerce-ai-agent-poc` เฉพาะ Preview สำเร็จ โดย Commerce Web, Worker, PostgreSQL, RBAC, RLS, ledger, outbox และ legacy ToolLoopAgent บน Render ไม่เปลี่ยน

Preview ที่ตรวจรับล่าสุด:

- Runtime: `https://commerce-ai-agent-hozj5j8h9-abhisak-c.vercel.app`
- Vercel Authentication: เปิดสำหรับ Preview
- Production deployment: ไม่มี runtime ที่ผ่าน gate และไม่มี production alias
- live AI: ปิด และ route ที่อาจเรียก model ถูกปฏิเสธก่อน execution
- Commerce/marketplace data และ credentials: ไม่มี

URL เป็น deployment URL ชั่วคราวและอาจเปลี่ยนใน deployment ถัดไป หน้า Preview ต้องผ่าน Vercel Authentication ก่อนเข้าถึงจาก browser

## Runtime baseline

| ส่วน | ค่าที่ใช้จริง |
|---|---|
| Runtime | Node.js 24 (`nodejs24.x` บน Vercel) |
| Agent framework | `eve 1.0.0-rc.10` แบบ exact pin |
| AI SDK ใน agent workspace | `ai 7.0.137` |
| Validation | `zod 4.6.7` |
| TypeScript | `6.0.3` |
| Hosting | Vercel Preview project แยก; root directory `apps/agent-runtime` |
| Commerce runtime | Render/Node 22 เดิม ไม่ถูกย้าย |

Root application ยังคงใช้ `ai 7.0.102`; npm workspace แยก dependency ของ agent โดยไม่แทน legacy runtime

## Controls ที่บังคับใช้

1. `COMMERCE_AGENT_ENV` รับเฉพาะ `local` หรือ `preview`
2. `VERCEL_ENV=production` ทำให้ startup/build ล้มเหลว
3. `COMMERCE_AGENT_LIVE_AI` ต้องเป็นข้อความ `false` อย่างชัดเจน
4. ปฏิเสธ Commerce database URLs, provider API keys และ TikTok credentials หากหลุดเข้ามาใน agent environment
5. route ใช้ `vercelOidc()` และ `localDev()`; request ที่ไม่มี auth fail closed
6. initial message, follow-up message/answer และ compact ถูกปฏิเสธด้วย `403 live_ai_disabled`
7. อนุญาต bodyless session creation สำหรับทดสอบ Workflow/session durability โดยไม่เรียก model
8. ไม่มี authored tools, subagents, schedules, remote agents, connections หรือ mutation capability

Code references:

- [`agent/lib/runtime-policy.ts`](../apps/agent-runtime/agent/lib/runtime-policy.ts)
- [`agent/lib/poc-route-policy.ts`](../apps/agent-runtime/agent/lib/poc-route-policy.ts)
- [`agent/channels/eve.ts`](../apps/agent-runtime/agent/channels/eve.ts)
- [`agent/agent.ts`](../apps/agent-runtime/agent/agent.ts)
- [`tests/runtime-policy.test.ts`](../apps/agent-runtime/tests/runtime-policy.test.ts)
- [Node 24 CI job](../.github/workflows/checks.yml)

## Verification evidence

| Gate | ผล |
|---|---|
| Node 24 install/build | Pass |
| TypeScript typecheck | Pass |
| Runtime policy tests | Pass |
| Agent production dependency audit | Pass; 0 advisory หลังใช้ Next `16.4.6`, Zod `4.6.7` และ Undici `7.30.2` |
| `eve info` discovery | Pass; 0 discovery error/warning |
| Local `eve build` | Pass; output ประมาณ 10.1 MB |
| Vercel Preview build | Pass; environment gate รายงาน `preview` และ `liveAiEnabled:false` |
| Health | `200`, `status: ready`, Workflow entry พร้อม |
| Session route ไม่มี application auth | `401 unauthorized` |
| OIDC operator info | `200` |
| OIDC bodyless session creation | `202`, ได้ session ID |
| Initial model turn | `403 live_ai_disabled` ก่อน model execution |
| Compact/model work | `403 live_ai_disabled` |
| Session stream | `200`, NDJSON heartbeat |
| Resume ข้าม deployment | Pass; session จาก Preview รุ่นก่อนตอบ heartbeat ผ่าน Preview รุ่นใหม่ |
| Production separation | Pass; production-target build ถูก environment gate ปฏิเสธก่อน runtime build |
| Deployment Protection | เปิด `all_except_custom_domains`; automation bypass secret คงค้าง 0 ชุดหลังทดสอบ |

ไม่มี model invocation, token usage, Commerce API call, database access หรือ marketplace call ในการตรวจรับนี้

## Environment และ deployment

Vercel Preview มีเฉพาะ configuration ต่อไปนี้:

- `COMMERCE_AGENT_ENV=preview`
- `COMMERCE_AGENT_LIVE_AI=false`
- `EVE_TELEMETRY_DISABLED=1`

ไม่มีการตั้งค่าชุดนี้ใน Production การลอง deploy target ที่ CLI เลือกเป็น Production ถูก guard ปฏิเสธและไม่สร้าง production runtime ที่พร้อมใช้งาน

GitHub Actions มี job แยกบน Node 24 สำหรับ test, typecheck และ local eve build ส่วน Commerce checks เดิมยังรันบน Node 22

## ข้อจำกัดที่ยังเหลือ

- Vercel build/function อยู่ `iad1` ในผลตรวจ แม้ request ingress มาจาก `sin1`; ต้องวัด latency และตัดสิน data residency ก่อนเชื่อม Render Singapore
- Vercel Sandbox provider initialize ผ่านระหว่าง build แต่ยังไม่ได้รัน sandbox tool เพราะ POC นี้ไม่มี tool
- ยังไม่ได้พิสูจน์ retry ของ model/tool, trace redaction, tenant isolation หรือ cost attribution
- `eve` ยังเป็น release candidate ต้อง pin exact และทบทวนก่อนอัปเกรด
- npm install เตือน install script ของ `esbuild`; ต้องกำหนด dependency/install-script policy ก่อน production
- repository-wide audit ยังมี 9 moderate advisories ใน development tooling (`typescript-eslint`/`minimatch` และ Vitest mocker) แต่ production dependency audit เป็น 0; ห้ามใช้ dev server จากแหล่งที่ไม่เชื่อถือและต้องอัปเกรด tooling เมื่อมี compatible release
- production identity, Core service authentication และ business scopes ยังไม่ถูกสร้าง

## Gate decision

EVE-POC-02 ผ่านตาม acceptance criteria: health, Workflow session, resume ข้าม deployment และ environment separation ทำงานบน non-production project โดยไม่มี Commerce production secret/data และไม่มี live model execution

งานถัดไปคือ **EVE-POC-03 — Read-only Commerce Agent API contracts** กำหนด bounded Product, Sales และ Inventory schemas พร้อม evidence, as-of/version, pagination/limits และ error semantics ก่อนสร้าง service authentication ใน EVE-POC-04
