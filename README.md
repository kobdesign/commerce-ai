# Commerce — Local Workspace

ชื่อชั่วคราวสำหรับโครงการช่วยร้านค้าออนไลน์ตรวจเงินรับและกำไร มี AI ในกระบวนการทำงาน รองรับหลายองค์กร และมีเส้นทางขยายสู่ Enterprise

**ทิศทางโครงการล่าสุด — 17 กันยายน 2026:** ต่อฐาน financial evidence ไปสู่ AI ช่วยงานร้าน และการเปิดช่องทางขายผ่าน AI แบบเป็นช่วง ดู [แผน Agentic Commerce](docs/29-agentic-commerce-project-plan.md), [active backlog](docs/04-backlog.md) และ [slice ถัดไป: AI ช่วยตรวจเงินและสร้างงานติดตาม](docs/30-financial-review-assistant-slice.md) เป็นแผนพัฒนา ยังไม่มี inventory/live orders/API connectors/checkout เปิดใช้จากการปรับเอกสารครั้งนี้

สถานะ: **Product workflow v1.11 — เพิ่ม secure intake สำหรับ Statement จริงที่ปกปิดข้อมูลและ finance sign-off**

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

ผลตรวจรอบ v1.11: **105 integration/regression tests ผ่าน** และ browser E2E ล่าสุด **26/26 ผ่าน** ชุดใหม่ตรวจ redaction/intake/sign-off ของ TikTok, Shopee และ Lazada ดู [ผลส่งมอบ v1.11](docs/36-statement-sample-intake.md) ข้อมูล marketplace ที่ใช้ใน automated tests ยังเป็น synthetic

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
- **DATA-AG-01 มี intake tooling แล้ว:** รอ export จริงที่ร้านปกปิดด้วยเครื่องมือและผู้ใช้การเงินตรวจยอด/semantics ก่อนรับรอง adapter ของแต่ละ platform/version
- **REL-AG-01:** Production identity, data lifecycle, restore, model/data policy และ budget ก่อน pilot จริง
- Inventory/orders/connectors, published catalog/MCP และ checkout อยู่ stage ถัดไปตามเกณฑ์ ไม่เป็น dependency ทั้งชุดของ AI ตรวจเงิน

ไม่มีกำหนดส่งที่ยืนยันแล้ว รอบพัฒนาเป็นลำดับงาน ไม่ใช่คำสัญญาระยะเวลา
