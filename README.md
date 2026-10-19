# Commerce — Local Workspace

ชื่อชั่วคราวสำหรับโครงการช่วยร้านค้าออนไลน์ตรวจเงินรับและกำไร มี AI ในกระบวนการทำงาน รองรับหลายองค์กร และมีเส้นทางขยายสู่ Enterprise

**ทิศทางโครงการล่าสุด — 18 ตุลาคม 2026:** ต่อฐาน financial evidence และ canonical catalog ไปสู่ AI ช่วยงานร้านและช่องทางขายแบบเป็นช่วง ดู [แผน Agentic Commerce](docs/29-agentic-commerce-project-plan.md) และ [active backlog](docs/04-backlog.md) ปัจจุบันมี manual stock ledger, internal orders, transactional outbox และ synthetic incoming event inbox ใน local แล้ว แต่ยังไม่มี provider connector/marketplace automation/checkout หรือ Co-browsing SDK เปิดใช้

สถานะ: **Product workflow v1.30 — Stock Distribution Policy แบบ Shared, Fixed และ Hybrid**

งาน OPS-AG-02a: [Stock Distribution Policy v1.30](docs/62-stock-distribution-policy.md) — ค่าเริ่มต้นระดับบริษัทและ override ราย SKU, Shared Pool/Fixed Quota/Hybrid, Safety stock, quota/cap รายช่องทาง, optimistic version, audit, tenant/shop RLS และ mobile UX; เป็น planning-only และยังไม่ส่งยอดออก Marketplace

งาน AUTH-AG-01b: [Credential rotation v1.29](docs/55-service-credential-rotation.md) — หมุน Secret แบบ dual-key overlap, ผูก Environment/Audience, หยุด Secret เดิมอัตโนมัติ, emergency revoke ทุกชุด และแสดง safe usage telemetry สำหรับ Owner/Auditor; ยังไม่มี provider connector หรือ secret-manager integration

งาน AUTH-AG-01a: [Service Principal v1.28](docs/54-service-principal-delegation.md) — owner สร้าง machine credential แยก tenant/shop/scope/expiry, secret แสดงครั้งเดียวและเก็บเฉพาะ hash, ingest ตรวจ current policy ทุก Event, เพิกถอนมีผลต่อคำขอใหม่ทันที และ Auditor ตรวจได้แบบ read-only; ยังไม่มี provider connector หรือ credential rotation

งาน INT-AG-01c: [Operational Event Inbox v1.27](docs/53-operational-inbox-review.md) — หน้า review/filter, safe evidence projection, gap/cursor/SLA metrics, human-confirmed replay request และการปิดติดตาม พร้อม optimistic version, action history, audit, RLS และ mobile UX; replay เป็นเพียงงานใน Outbox ยังไม่เปลี่ยน Order/Inventory

งาน INT-AG-01b: [Incoming event inbox v1.26](docs/52-integration-inbox.md) — ตรวจ HMAC ก่อนบันทึก, dedup ตาม provider namespace/event ID, ตรวจ conflict, แยก accepted/gap/stale/unordered/invalid signature, เลื่อน contiguous gap กลับ ready อัตโนมัติ, ส่ง status เข้า outbox และบังคับ RLS; ยังไม่มี webhook/provider adapter หรือการเปลี่ยน business state

งาน INT-AG-01a: [Transactional outbox v1.25](docs/51-transactional-outbox.md) — order/inventory event เขียนพร้อม business transaction, delivery state แยก consumer, lease + SKIP LOCKED, backoff/dead letter, idempotent receipt, crash recovery, queue role boundary และ readiness; ยังไม่มี incoming webhook หรือ provider connector

งาน OPS-AG-01c: [Internal commerce orders v1.24](docs/50-internal-commerce-orders.md) — manual/shadow order lines resolve listing identity เป็น canonical SKU, pending ไม่แตะ stock, paid สร้าง reservation/shortage, shipped ตัด stock แบบ atomic, cancel คืนยอดจองและปิด shortage, concurrent idempotency และ role/RLS boundary; ยังไม่มี marketplace connector, partial return หรือ refund automation

งาน OPS-AG-01b: [Human-confirmed reservation lifecycle v1.23](docs/49-inventory-reservation-contract.md) — reserve/commit/release/expire/retry แบบ atomic, shortage ไม่สร้าง movement เท็จ, last-item concurrency, idempotent reference, optimistic version และ role/RLS boundary; marketplace automation และกติกา provider-specific ยังรอ DEC-06

งาน OPS-AG-01a: [Inventory authority และ stock ledger v1.22](docs/48-inventory-authority-and-stock-ledger.md) — คลังหลักระดับบริษัท, on-hand/reserved/available ต่อ canonical SKU, movement แบบ append-only, human confirmation, idempotent reference, concurrent/non-negative guard และ role/RLS boundary; มี [หน้าสต็อกกลาง](docs/61-central-inventory-ux.md) รวม SKU ทุกช่องทางตามสิทธิ์และแสดง placement รายร้านแล้ว แต่ยังไม่ใช่ marketplace realtime หรือ controlled write

งาน CAT-AG-01b: [Channel listing mapping v1.21](docs/47-channel-listing-mapping.md) — ผูก SKU กลางกับ Product/Variant ID รายร้าน, บังคับผู้ใช้ยืนยัน, กัน external identity ซ้ำ, ยกเลิก/นำกลับพร้อมเหตุผล/audit/version และ RLS; ยังไม่เรียก marketplace API, sync listing หรือจัดการ stock

งาน CAT-AG-01a: [Product และ SKU lifecycle v1.20](docs/46-product-and-sku-lifecycle.md) — แท็บพร้อมขาย/หยุดขาย/ทั้งหมด, เปลี่ยนสถานะระดับสินค้าและ SKU พร้อมเหตุผล/audit/optimistic version, รักษา canonical ID ต้นทุนและ Statement ย้อนหลัง; ยังไม่ใช่ stock หรือสถานะจริงบน marketplace

งาน SUPPORT-01b: [Local Co-browsing PoC surface v1.19](docs/45-cobrowsing-local-poc-surface.md) — หน้า owner-only `/support/poc` ใช้ข้อมูลสมมติ จำลอง consent, รหัส 6 หลัก, agent view-only, timeout/stop, data classification, dynamic modal, Thai text และ mobile layout; **พักการพัฒนาตามคำขอวันที่ 8 ตุลาคม 2026** และยังไม่มี vendor SDK, remote access หรือข้อมูลออกจาก browser

งาน SUPPORT-01: [Co-browsing vendor discovery และ synthetic PoC v1.18](docs/44-cobrowsing-vendor-discovery-and-synthetic-poc.md) — shortlist Cobrowse.io/Unblu, threat review, machine-readable pilot policy และ automated control-plane harness สำหรับ consent, one-time code, tenant/case/agent scope, view-only, masking baseline, webhook และ kill switch; vendor SDK/sandbox, SUP-T10 และ DEC-09 ยัง pending

งาน REL-AG-01f: [Production dependency decision pack v1.17](docs/43-production-dependency-decision-pack.md) — เสนอ WorkOS, AWS S3, Render PITR/offsite backup, Better Stack และ OpenAI data-minimized policy พร้อม cost/RPO/RTO/retention/migration gates; manifest ยัง blocked จนเจ้าของงานอนุมัติพร้อมหลักฐาน

งาน REL-AG-01e: [Runtime monitoring และ incident rehearsal v1.16](docs/42-runtime-monitoring-and-incident-rehearsal.md) — ตรวจ health/readiness/queue lag, แจ้ง unavailable/recovered ตาม threshold ผ่าน signed webhook, retry และซ้อม kill switch พร้อมคืนสถานะอัตโนมัติ; staging จริงยังรอ URL, alert destination และ incident owner

งาน REL-AG-01d: [Production configuration และ incident gates v1.15](docs/41-production-configuration-and-incident-gates.md) — preflight/startup/readiness ปฏิเสธ environment ที่ไม่ปลอดภัย, แยก switch หยุด web mutations กับ import claims, เก็บ actor/reason/time และมี recovery runbook; production ยังถูก block จนมี identity และ private evidence storage จริง

งาน REL-AG-01c: [Backup/restore rehearsal v1.14](docs/40-backup-restore-rehearsal.md) — สร้าง native dump, กู้เข้า database ชั่วคราว, เปรียบเทียบ manifest/migrations/RLS/checksums/roles และ cleanup อัตโนมัติ; local rehearsal ผ่านแล้ว แต่ยังไม่กำหนด production RPO/RTO หรือ backup policy

งาน REL-AG-01b: [Evidence storage registry และ lifecycle v1.13](docs/39-evidence-storage-registry.md) — หลักฐาน order/statement ใช้ adapter กลาง, ตรวจ SHA-256 ทุกครั้งที่อ่าน, แยก backend/object key/retention/lifecycle และ backfill ข้อมูล local เดิมครบ; ยัง dual-write legacy bytes และยังไม่ใช่ Private Object Storage production

งาน REL-AG-01a: [Runtime readiness และ worker heartbeat v1.12](docs/38-runtime-readiness-and-worker-heartbeat.md) — `/api/ready` ตรวจ application/identity database roles และ background worker ล่าสุดโดยไม่เปิดเผย secret; production identity, private object storage และ restore rehearsal ยังไม่ผ่าน gate

งาน FIN-AI-01 และผลตรวจล่าสุด: [ที่มาของยอดรวมกระทบยอด v1.6](docs/31-settlement-total-provenance.md) — แยกยอดตาม Statement / ยอดที่ระบบรวมเอง / unknown; ไม่ใช้ยอดที่รวมเองยืนยันยอดโอน

งาน FIN-AI-02: [เครื่องมืออ่านการเงินพร้อมหลักฐาน v1.7](docs/32-financial-read-tools.md) — จำกัดร้าน/ช่วงเวลา/จำนวนผล แยกเวลาต้นทางและที่มาของยอด ไม่ส่ง raw file หรือหมายเหตุให้โมเดล และไม่มี write tool

งาน FIN-AI-03: [ผู้ช่วยสรุปการกระทบยอด v1.8](docs/33-settlement-review-assistant.md) — สรุปจากระบบได้แม้ไม่มีโมเดล, AI จัดลำดับได้เฉพาะ evidence ID ที่มีจริง และบันทึก workflow/prompt/tool/policy versions พร้อม usage/status

งาน FIN-AI-04: [งานติดตามที่ผู้ใช้ยืนยัน v1.9](docs/34-human-confirmed-financial-review-tasks.md) — draft หมดอายุและตรวจ evidence hash ซ้ำ, confirmation/task/audit เป็น atomic, กันยืนยันและงานเปิดซ้ำ และแยก lifecycle งานออกจากตัวเลขกระทบยอด

งาน FIN-AI-05: [ผลประเมินและ UAT readiness v1.10](docs/35-financial-ai-evaluation-and-uat.md) — ชุดกรณีประเมินแบบมีเวอร์ชัน, automated grounding/safety gates, flow browser → API → DB และแบบตรวจรับโดยผู้ใช้การเงินจริง; live model/UAT ยังรอ DEC-04 และผู้ตรวจ

งาน DATA-AG-01 readiness: [เครื่องมือเตรียมและตรวจรับ Statement v1.11](docs/36-statement-sample-intake.md) — แทนรหัสคำสั่งซื้อ/ธุรกรรมแบบคงที่, ลบค่าคอลัมน์อื่น, ตรวจ PII โดยไม่พิมพ์ค่าดิบ และผูก finance sign-off กับ checksum ของไฟล์ที่ตรวจจริง

มี login, หลายบริษัท/ร้าน, catalog หลายประเภทสินค้า, รายละเอียดที่เพิ่มเองได้, หลาย SKU ต่อสินค้า, แก้ไขรายละเอียด/ราคา/ต้นทุนพร้อมประวัติ, สิทธิ์รายบทบาท/ร้าน, audit, AI tool preview, flow ตรวจรายการขายและส่งยืนยันให้ worker ทำต่อเบื้องหลัง, หลักฐานไฟล์ต้นฉบับพร้อม checksum, source line identity ป้องกันยอดซ้ำข้ามไฟล์, Review Inbox สำหรับยืนยันต้นทุนที่ขาด, refund/fee rebate, การนำเข้าและกระทบยอด statement ต่อรอบโอนและคำสั่งซื้อ, ตัวอ่าน CSV/XLSX แบบมีเวอร์ชันสำหรับ TikTok Shop/Shopee/Lazada และบัญชีค่าใช้จ่ายร้านแบบ append-only พร้อมการแก้กลับโดยไม่ลบหลักฐานแล้ว ข้อมูลเริ่มต้นเป็นข้อมูลสมมติ ตัวเลข “เงินเหลือหลังค่าใช้จ่ายที่บันทึก” ยังไม่ใช่กำไรสุทธิหรือระบบ production/Enterprise ที่ตรวจรับแล้ว การสร้างทรัพยากร Render จริงต้องตรวจราคาและยืนยันใน Render Dashboard ก่อน

ตัวอ่าน statement แยกแพลตฟอร์มและการตรวจจับอัตโนมัติ: [Product workflow v1.5](docs/28-marketplace-settlement-adapters.md)

การนำเข้า statement หลายบรรทัดจาก CSV พร้อม preview และหลักฐานต้นฉบับ: [Product workflow v1.4](docs/27-settlement-csv-import.md)

การกระทบยอดเงินโอนตาม statement พร้อมรายการที่ต้องตรวจ: [Product workflow v1.3](docs/26-settlement-reconciliation.md)

งานยืนยันนำเข้าแบบเบื้องหลัง สถานะ และ retry: [Product workflow v1.2](docs/25-async-import-worker.md)

หลักฐานไฟล์ต้นฉบับของการนำเข้าและการดาวน์โหลดตามสิทธิ์: [Product workflow v1.1](docs/24-import-source-evidence.md)

บัญชีค่าโฆษณา เงินเดือน การเดินทาง และค่าใช้จ่ายระดับร้าน: [Product workflow v1.0](docs/22-shop-expense-ledger.md)

ผลตรวจรับบัญชีค่าใช้จ่ายครบทั้งหน้าจอ API ฐานข้อมูล สิทธิ์ และการแยกบริษัท: [Shop expense UAT](docs/23-shop-expense-uat.md)

โครงสร้างและคู่มือ staging บน Render: [Render staging readiness](docs/21-render-staging.md)

การแก้กลับรายการการเงินที่บันทึกผิด: [Product workflow v0.8](docs/20-financial-event-reversals.md)

คืนเงินและรายการปรับยอดหลังการขาย: [Product workflow v0.7](docs/19-financial-events.md)

การป้องกันรายการขายซ้ำข้ามไฟล์: [Product workflow v0.6](docs/18-source-line-deduplication.md)

รายการที่ต้องตรวจและต้นทุนย้อนหลัง: [Product workflow v0.5](docs/16-missing-cost-review-inbox.md)

ผลทดสอบ usability และ responsive layout: [Usability review](docs/17-usability-review.md)

การยืนยันรายการขาย เงินรับ ต้นทุน และส่วนต่างเบื้องต้น: [Product workflow v0.4](docs/14-confirmed-orders-and-contribution.md)

การแก้ไขสินค้า ประวัติต้นทุน และการป้องกันบันทึกทับกัน: [Product workflow v0.3](docs/13-product-editing-and-cost-history.md)

การปรับ UX, วิธีเพิ่มหลาย SKU และขอบเขตการนำเข้า: [Product workflow v0.2](docs/12-product-ux-and-import-preview.md)

## เปิดแอป

ต้องมี Node.js 22 และ Docker Compose:

```sh
npm ci
npm run env:init
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

เปิด http://127.0.0.1:3001 ใช้ `owner@chino.demo` / `StudioDemo!2026` (บัญชีข้อมูลสมมติเท่านั้น) เปิดอีก terminal รัน `npm run worker` หากต้องการทดลองงานคิว

คู่มือคำสั่ง บัญชีทดสอบ ขอบเขตฟีเจอร์และข้อจำกัด: [Foundation runbook](docs/10-foundation-runbook.md)

ผลตรวจรอบ v1.30: integration **200/200 ผ่าน** และ Browser Stock Distribution **2/2 ผ่าน** ครอบคลุม company/SKU policy, Hybrid 70/60 บน stock 100, Safety stock 10, Fixed quota guard, inherit, version/audit, role/shop/tenant RLS และ mobile UX พร้อม typecheck/lint/build; ดู [OPS-AG-02a](docs/62-stock-distribution-policy.md) ข้อมูลยังเป็น synthetic และยังไม่ส่งยอดออก Marketplace

เอกสารอ้างอิงบทสนทนาของผู้ใช้ ข้อมูลร้านจริงและเทคโนโลยีที่ทีมถนัดยังรอยืนยัน ตัวอย่างทั้งหมดที่ติดป้าย synthetic ไม่ใช่ข้อมูลร้านหรือรูปแบบไฟล์ทางการของแพลตฟอร์ม

## อ่านตามลำดับ

1. [ขอบเขตผลิตภัณฑ์แรก](docs/01-product-brief.md)
2. [Requirements และสิทธิ์](docs/02-requirements.md)
3. [สถาปัตยกรรมและการตัดสินใจ](docs/03-architecture.md)
4. [Backlog และลำดับพัฒนา](docs/04-backlog.md)
5. [เกณฑ์ตรวจรับและการประเมิน AI](docs/05-verification.md)
6. [SDLC และการปล่อยระบบ](docs/06-sdlc.md)
7. [Discovery และข้อมูลที่ต้องยืนยัน](docs/07-discovery.md)
8. [Stack ที่แนะนำและเหตุผล](docs/08-stack-recommendation.md)
9. [การรองรับสินค้าหลายประเภท](docs/09-product-model.md)

ตัวอย่างข้อมูลสำหรับตรวจสูตร: [synthetic financial scenarios](fixtures/financial-scenarios.json)

## เป้าหมายเวอร์ชันแรก

องค์กรที่ได้รับอนุญาตนำเข้าข้อมูล → ตรวจคุณภาพและ mapping → จับคู่รายการเงิน → คำนวณเงินเหลือ → AI อธิบายพร้อมหลักฐาน → ผู้ใช้จัดการรายการที่ต้องตรวจ

เริ่มจากรายงาน TikTok ของร้านแฟน ผ่านไฟล์จริงที่ร้านดาวน์โหลดได้ Adapter contract สำหรับ TikTok/Shopee/Lazada และตัวอย่างสมมติมีแล้ว แต่รูปแบบและความครบถ้วนยังต้องตรวจรับกับ export จริงที่ปกปิดข้อมูลส่วนตัว

Product model เป็นกลางต่อหมวดสินค้า กางเกงเป็น pilot แรก เวอร์ชันแรกวางแผนรองรับสินค้าทางกายภาพที่ขายเป็นหน่วยนับและมีต้นทุนอ้างอิงได้ ทั้งมีและไม่มีตัวเลือก ข้อมูลสี/ไซซ์เป็น attributes; batch/expiry, serial, หน่วยชั่งตวง, bundle components และ subscription เป็นความสามารถขยายที่ต้องตรวจรับแยก

## งานถัดจาก Foundation

- **FIN-AI-01 ส่งมอบใน local แล้ว:** แยกยอดรวมตามต้นทางออกจากยอดที่รวมจากบรรทัดเอง และสถานะที่หลักฐานยังไม่พอ ก่อนให้ AI อธิบายผล
- **FIN-AI-02 ส่งมอบใน local แล้ว:** เครื่องมืออ่านการเงินตามสิทธิ์พร้อม evidence contract และข้อจำกัด โดยยังไม่เรียกโมเดลหรือเขียนข้อมูล
- **FIN-AI-05 ผ่าน technical gate ใน local:** automated synthetic/mock eval และ full-flow regression พร้อมแล้ว; human-graded live-model eval และ finance UAT รอ model/data policy, threshold และผู้ตรวจตาม DEC-04
- **UX-MER-04 ส่งมอบใน local:** หน้าเงินอธิบายสูตรและขอบเขต ส่วน [หน้าผู้ช่วย](docs/60-merchant-assistant-ux.md) แยกผลจากระบบ/โมเดล แสดงหลักฐาน และเก็บประวัติแยกร้าน; งานถัดไปคือ UAT กับผู้ค้าจริง
- **DATA-AG-01 มี intake tooling แล้ว:** รอ export จริงที่ร้านปกปิดด้วยเครื่องมือและผู้ใช้การเงินตรวจยอด/semantics ก่อนรับรอง adapter ของแต่ละ platform/version
- **REL-AG-01:** Production identity, data lifecycle, restore, model/data policy และ budget ก่อน pilot จริง
- Stock ledger และ reservation แบบผู้ใช้ยืนยันส่งมอบใน local แล้ว; live orders/connectors, published catalog/MCP และ checkout อยู่ stage ถัดไปตามเกณฑ์

ไม่มีกำหนดส่งที่ยืนยันแล้ว รอบพัฒนาเป็นลำดับงาน ไม่ใช่คำสัญญาระยะเวลา
