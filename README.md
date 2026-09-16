# Commerce — Local Workspace

ชื่อชั่วคราวสำหรับโครงการช่วยร้านค้าออนไลน์ตรวจเงินรับและกำไร มี AI ในกระบวนการทำงาน รองรับหลายองค์กร และมีเส้นทางขยายสู่ Enterprise

สถานะ: **Product workflow v0.6 — เว็บแอปและ PostgreSQL สำหรับทดลองในเครื่อง**

มี login, หลายบริษัท/ร้าน, catalog หลายประเภทสินค้า, รายละเอียดที่เพิ่มเองได้, หลาย SKU ต่อสินค้า, แก้ไขรายละเอียด/ราคา/ต้นทุนพร้อมประวัติ, สิทธิ์รายบทบาท/ร้าน, audit, AI tool preview, flow ตรวจ/ยืนยันรายการขาย, source line identity ป้องกันยอดซ้ำข้ามไฟล์ และ Review Inbox สำหรับยืนยันต้นทุนที่ขาดแบบมีประวัติแล้ว ข้อมูลเริ่มต้นเป็นข้อมูลสมมติ ยังไม่ใช่กำไรสุทธิหรือระบบ production/Enterprise ที่ตรวจรับแล้ว

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

ผลตรวจล่าสุด: **47 integration tests และ 15 browser tests ผ่าน** ดู [ผลตรวจ v0.6](docs/18-source-line-deduplication.md), [ผลตรวจ v0.5](docs/16-missing-cost-review-inbox.md) หรือ [Business Logic verification](docs/15-business-logic-verification.md)

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

เริ่มจากรายงาน TikTok ของร้านแฟน ผ่านไฟล์จริงที่ร้านดาวน์โหลดได้ รูปแบบไฟล์และความครบถ้วนต้องสำรวจก่อนเขียน adapter ส่วน Shopee/Lazada ใช้สัญญา adapter เดียวกันในระยะถัดไป

Product model เป็นกลางต่อหมวดสินค้า กางเกงเป็น pilot แรก เวอร์ชันแรกวางแผนรองรับสินค้าทางกายภาพที่ขายเป็นหน่วยนับและมีต้นทุนอ้างอิงได้ ทั้งมีและไม่มีตัวเลือก ข้อมูลสี/ไซซ์เป็น attributes; batch/expiry, serial, หน่วยชั่งตวง, bundle components และ subscription เป็นความสามารถขยายที่ต้องตรวจรับแยก

## งานถัดจาก Foundation

- ทำ discovery จากงานจริงและรายงานที่ตัดข้อมูลส่วนบุคคลไม่จำเป็นออก
- ยืนยันสูตรและความหมายของข้อมูลกับผู้ดูแลการเงิน
- ใช้ TypeScript / Next.js / PostgreSQL เป็นฐานที่ติดตั้งแล้ว และยืนยันข้อจำกัดการให้บริการก่อน production
- ตรวจ schema รายงาน TikTok จริงและยืนยัน source line ID ที่เพิ่มแล้ว → refunds/settlement → ค่าโฆษณาและค่าใช้จ่ายที่ยืนยันแล้ว โดยคงชุดทดสอบ Tenant A/B

ไม่มีกำหนดส่งที่ยืนยันแล้ว รอบพัฒนาเป็นลำดับงาน ไม่ใช่คำสัญญาระยะเวลา
