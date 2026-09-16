# Stack recommendation v0.1

## ข้อเสนอหลัก

ใช้ **TypeScript ทั้งระบบ, Next.js สำหรับเว็บและ API, PostgreSQL + Drizzle สำหรับข้อมูล, Node.js worker + pg-boss สำหรับงานเบื้องหลัง และ AI SDK สำหรับ AI**

เป็นคำแนะนำตามสมมติฐานทีมเล็กและงานที่เน้นข้อมูลธุรกรรม/AI ยังไม่ใช่ benchmark หรือการยืนยันว่าผ่าน Enterprise requirements ทุกข้อ ไม่มีการ provision บริการจากเอกสารนี้

## องค์ประกอบ

| ส่วน | เทคโนโลยีที่แนะนำ | เหตุผลและขอบเขต |
|---|---|---|
| ภาษา | TypeScript บน Node.js รุ่น LTS ที่รองรับ ณ วันเริ่ม implementation | แชร์ types/contracts ระหว่างเว็บ workers และ tools; pin versions ใน lockfile |
| Web/API | Next.js App Router + React | หน้ารายงานและ AI workspace ในโปรเจกต์เดียว; ใช้ Node runtime สำหรับ DB/SDK |
| UI | Tailwind CSS และ accessible components | สร้างหน้ารายงานและฟอร์มไทยที่ responsive; เลือก component library ตอนเริ่ม UI |
| Contracts | Zod | ตรวจ input/output ที่ขอบระบบและ tool schema; schema validation ไม่แทนการตรวจตัวเลข/สิทธิ์ |
| Database | Managed PostgreSQL | transactions, relational integrity, decimal values และ RLS |
| ORM/migrations | Drizzle ORM + reviewed SQL migrations | schema มี type safety แต่ทีมยังควบคุม constraints และ RLS ผ่าน SQL ได้ |
| Background work | Node.js worker + pg-boss | ใช้ PostgreSQL เป็นคิว ลดการเพิ่ม Redis ใน pilot; จำกัด concurrency และตรวจ tenant context ทุก job |
| Files | Private S3 object storage | ไฟล์ต้นทาง/รายงานแยกจาก filesystem ของแอป; server ตรวจสิทธิ์ก่อนออก URL |
| Identity | WorkOS AuthKit | ใช้ hosted identity, organizations และเส้นทาง SSO/SCIM; สิทธิ์ธุรกิจและ tenant isolation ยังต้องบังคับในแอป |
| AI runtime | Vercel AI SDK | TypeScript tools/structured output/streaming; model policy และ business authorization เป็นของแอป |
| Model access | Vercel AI Gateway เป็นตัวเลือกเริ่มต้น | เลือก allowlist/model ผ่าน eval; ใช้เฉพาะเมื่อ data policy อนุญาต รวมถึงเส้นทาง fallback |
| Tests | Vitest + Playwright + real PostgreSQL ใน integration tests | ตรวจสูตรเร็วและทดสอบ DB roles/RLS จริง; E2E ครอบคลุม workflow สำคัญ |
| Repo/CI | pnpm workspace + GitHub Actions | แชร์ domain/contracts โดยเริ่มโครงสร้างเท่าที่ใช้จริง |
| Telemetry | OpenTelemetry + structured logs + PostgreSQL audit/usage records | เชื่อม request/run/import พร้อม redaction; audit แยกจาก diagnostic logs |

ข้อเสนอ WorkOS ต้องตรวจราคา การเปิดใช้ enterprise connection และเงื่อนไขข้อมูลก่อนใช้งานจริง SCIM/SSO ไม่ทำให้สิทธิ์ในแอปถูกต้องเอง ต้อง sync/revoke membership และตรวจ session ตามนโยบาย

## รูปแบบ repo ที่จะสร้างใน implementation

```text
apps/
  web/                 # Next.js: workspace, API, authenticated entrypoints
  worker/              # imports, reconciliation, AI background jobs
packages/
  domain/              # financial rules, business commands
  db/                  # schema, migrations, tenant transaction helpers
  contracts/           # request/result/tool schemas
  ai/                  # orchestrator, tools, model policy, eval fixtures
  connectors/          # normalized interface; file adapters first
  observability/       # audit, metrics, correlation, redaction
docs/
fixtures/
```

ผังนี้เป็นแบบที่จะพัฒนา ยังไม่มี directories เหล่านี้เป็นแอปที่ทำงานได้ การเข้าถึง domain จาก web/worker ต้องผ่าน policy เดียวกัน ไม่ทำ authorization เฉพาะ route handler

## Hosting ที่แนะนำสำหรับ pilot

**Render: Web Service + Background Worker + Managed PostgreSQL** และ private S3 สำหรับไฟล์ เลือก region ที่เหมาะกับผู้ใช้และข้อกำหนดข้อมูล แนะนำพิจารณา Singapore หากไม่มีข้อกำหนดให้อยู่ในประเทศไทยโดยเฉพาะ

Render มีเอกสารสำหรับ Next.js, workers และ Singapore region ใช้ deployment แบบ container หรือ Node service ที่ปรับไปยังผู้ให้บริการอื่นได้ ควรให้แอปและ DB อยู่ region เดียวกันและใช้ private connection ตามบริการที่เลือก

การเลือก app region ไม่รับประกันว่า Identity, AI, logs หรือ backups จะอยู่ region เดียวกัน ต้องตรวจ data flow ทุก provider แยกก่อนรับข้อกำหนด Enterprise

Production pilot ใช้แผนบริการที่รองรับลักษณะงานและ backup ที่ต้องการ ไม่อ้าง SLA จาก free tier ราคายังไม่ประมาณเพราะไม่ทราบขนาดไฟล์ ปริมาณออเดอร์ AI usage และ enterprise connections

หากมีข้อกำหนด dedicated/network/data residency ที่บริการ pilot รองรับไม่ได้ ให้ประเมินเส้นทาง Docker บน AWS ECS/Fargate + RDS + S3 ตามสัญญา การย้ายไม่ใช่อัตโนมัติ ต้องมี migration/restore rehearsal และประเมินภาระ operations

## ข้อแลกเปลี่ยนที่ต้องรับรู้

- Next.js ใช้ทั้งเว็บ/API ได้ แต่งาน import/AI ที่ยาวต้องอยู่ worker ไม่ผูกกับอายุ HTTP request
- pg-boss ลดบริการคิวเพิ่มเติม แต่เพิ่มโหลดฐานข้อมูล ต้องจำกัดงาน ติดตาม contention และแยกทรัพยากรเมื่อมีหลักฐานจำเป็น
- คิวไม่ได้รับประกันว่า business side effects จะเกิดครั้งเดียว ต้องมี idempotency และตรวจผล external calls ในแอป
- ใช้ schema/role สำหรับ job infrastructure แยกจาก application data role; worker อ่าน business data ผ่าน tenant-scoped role ไม่ผ่าน owner credential
- Drizzle/RLS ช่วยวางกลไก แต่การใช้ owner role หรือ policy ผิดยังทำข้อมูลรั่วได้ จึงต้องมี integration tests
- managed identity ช่วยลดงาน auth แต่มีต้นทุนและ dependency ภายนอก เก็บ app tenant ID ของเราเองและ mapping ไป provider ID
- AI SDK/Gateway ไม่แทนระบบ authorization, audit, budgets ต่อ tenant หรือ evaluation ของผลิตภัณฑ์
- ยังไม่แยก backend framework เพิ่ม, ไม่เพิ่ม Kubernetes/Kafka/vector database จนมีความต้องการที่ตรวจได้
- งาน analytics/data science ในอนาคตเพิ่ม Python service ได้ผ่าน contracts เดิม โดยไม่จำเป็นต้องเริ่มสองภาษาทั้งระบบ

## Versions และ model selection

ก่อน scaffold ตรวจ compatibility ของ Node/Next/React/AI SDK/Drizzle/pg-boss และ pin รุ่นที่ผ่าน tests ไม่คัดลอก model ID จากความจำ ทดสอบภาษาไทย tool accuracy, evidence, latency และ cost แล้วจึงเลือกโมเดลเริ่มต้น

ตรวจ AI SDK README/tool documentation จากแพ็กเกจที่ติดตั้งแยกไว้ในโฟลเดอร์ชั่วคราวสำหรับงานวิจัย ไม่ได้เพิ่ม dependency ลง workspace โครงการ

## แหล่งข้อมูลทางการที่ตรวจประกอบคำแนะนำ

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Drizzle RLS](https://orm.drizzle.team/docs/rls)
- [pg-boss](https://github.com/timgit/pg-boss)
- [WorkOS AuthKit organizations](https://workos.com/docs/authkit/users-organizations)
- [WorkOS documentation](https://workos.com/docs)
- [AI SDK](https://ai-sdk.dev/docs/introduction) — ตรวจประกอบจาก README และ bundled docs ในแพ็กเกจด้วย
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Render Next.js](https://render.com/docs/deploy-nextjs-app)
- [Render background workers](https://render.com/docs/background-workers)
- [Render regions](https://render.com/docs/regions)
- [Render PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting)

ตรวจเอกสารใน session นี้เพื่อประกอบ planning เท่านั้น ก่อนซื้อบริการหรือ deploy ต้องตรวจ pricing, limits, region, security และ data terms ที่เกี่ยวข้องอีกครั้ง
