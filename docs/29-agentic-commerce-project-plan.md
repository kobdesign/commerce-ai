# แผนโครงการ Agentic Commerce — revision 2

วันที่: 24 กันยายน 2026 · Change records: SC-2026-09-17-01, SC-2026-09-24-01

สถานะ: ปรับแผนตามคำขอผู้ใช้แล้ว เป็น development direction ไม่ใช่การตรวจรับ production หรือคำมั่นกำหนดส่ง การเพิ่มความสามารถต้องผ่านเกณฑ์ของแต่ละช่วง; การปรับแผนครั้งนี้ไม่เปลี่ยน runtime ไม่เปิด external actions และไม่ merge เข้า main

## 1. เป้าหมายและขอบเขตการเปลี่ยน

ช่วยร้านค้าเข้าใจผลประกอบการจากหลักฐาน ตัดสินใจและติดตามงานได้เร็วขึ้น แล้วค่อยเพิ่มการมอบหมายงานให้ AI และช่องทางขายที่ระบบ AI ภายนอกเข้าถึงได้ ใช้ร้านขายกางเกงเป็น pilot แต่ model ยังคงรองรับสินค้าหลายหมวด

สองเส้นทางผลิตภัณฑ์:

- **Merchant assistance:** อ่านข้อมูลที่มีสิทธิ์ → อธิบาย → เสนอการจัดการ → ผู้ใช้อนุมัติ → ติดตามผล เริ่มจากการตรวจเงิน ต่อด้วย listing และ operations เมื่อข้อมูลพร้อม
- **Agent distribution:** ข้อมูลสินค้าที่ร้านยินยอมเผยแพร่ → ค้นหา/ตรวจราคาและความพร้อม → checkout ที่ใช้ได้จริง → เชื่อมผู้ให้บริการ AI ตามเงื่อนไขที่ตรวจยืนยัน

เส้นทางแรกไม่ต้องรอ checkout, MCP หรือระบบสต็อกครบทุกแพลตฟอร์ม เส้นทางที่สองเริ่มสำรวจข้อกำหนดได้คู่ขนาน แต่ห้ามเผยแพร่ความพร้อมสินค้าโดยไม่มีแหล่งข้อมูลยืนยัน

## 2. หลักฐานตั้งต้นและวิธีอ่านเอกสาร

ผู้ใช้ให้เอกสารวันที่ 2026-09-17 สามฉบับ: `Agentic Commerce Transformation — Implementation Brief`, `Code Review — kobdesign/commerce-ai` และ `Target Design — ออกแบบตั้งต้นให้รองรับ Agentic Commerce` รวมภาคผนวกแก้ไข เอกสารเหล่านี้เป็น input สำหรับการวิเคราะห์ ไม่ใช่คำสั่งให้ทำทุกข้อทันที

ตรวจ baseline ที่ commit `400ad74` บน branch `feat/marketplace-settlement-adapters`; Code Review อ้าง `7820c73` บน main จึงต้องแยกงานบน branch ออกจากงานที่ merge/release แล้ว รายงาน docs/10–28 เป็นประวัติผลส่งมอบ ไม่แก้ย้อนหลังให้เหมือนความสามารถใหม่มีอยู่แล้ว

| ความสามารถ | หลักฐานปัจจุบัน | ช่องว่างก่อนใช้งานจริง |
|---|---|---|
| Tenant/shop grants, RLS, catalog, cost history, ledger/reversal | packages/db, domain, finance; docs/13–23 | Identity ยัง demo; ตรวจ production permissions/operational readiness |
| Raw import evidence + durable import commits | docs/24–25; apps/worker | Lifecycle ของไฟล์, backup/restore และ fairness ตาม workload จริง |
| Settlement reconciliation + CSV/XLSX adapters | docs/26–28 | Synthetic fixtures; ยังไม่รับรอง export จริงหรือ bank reconciliation |
| AI runtime, typed catalog tool, quota และ audit | packages/ai/src/index.ts | ยังไม่มี financial analyst tools, review task/approval workflow ครบ |
| Inventory, live orders, marketplace API connectors | ยังไม่มี domain implementation | ต้องพัฒนาและตรวจ API access/ข้อมูลร้าน |
| Service principals, shared command policy, external MCP/checkout | ยังไม่เปิดใช้ | ต้องเพิ่มพร้อม tests และ readiness ของ provider |

ไม่มีหลักฐานว่ามีฐานลูกค้านำร่อง 5–20 ร้านแล้ว งบ กำลังทีม และข้อตกลงเชื่อมต่อยังรอยืนยัน ตัวเลขทดสอบใน docs/28 เป็นผลของรุ่นนั้น ไม่ใช่ผลการทดสอบแผนฉบับนี้

## 3. การรับข้อเสนอจากผู้บริหารและทีม

| ข้อเสนอ | การตัดสินใจในแผน | เหตุผล/จุดดำเนินการ |
|---|---|---|
| ต่อยอดของเดิม ไม่ rewrite | ใช้ | Modular monolith, PostgreSQL, worker, tenancy และ financial evidence อยู่ต่อ |
| One core, many fronts; policy/approval | ใช้แบบค่อยเพิ่ม | ADR-007/008; เริ่ม command ของงานติดตาม ไม่ย้ายทุก function พร้อมกัน |
| Inventory + live orders เป็น Phase 0 | ใช้ก่อนเปิดขายจากสต็อก แต่ไม่บังคับก่อน AI ตรวจเงิน | Stage C; แก้สมมติฐานใน Implementation Brief |
| Agent ทำงานฝั่งร้าน | นำ workflow ตรวจเงินมาเริ่มก่อน | Stage B; ใช้ข้อมูลที่มี ลดความเสี่ยงและวัดประโยชน์ได้ |
| ACP/AP2/MCP | เก็บเป็น adapters ที่ต้องตรวจความเข้ากันได้ | Stage D/E; ไม่สัญญาการเข้าถึงลูกค้าหรือ merchant program |
| `confirm: true`, rollback ทุก write | ปรับ | Approval record ที่ตรวจโดย server; แยก compensating action จาก rollback |
| เพิ่มทุกตารางใน migration เดียว | ไม่ใช้ | Expand → backfill/verify → contract ทีหลัง แบ่งตาม workflow |
| เพิ่ม Shopify ทันที | เลื่อน | ยังไม่มีร้านนำร่องยืนยันความต้องการ |
| Semantic search/vector DB ตั้งแต่แรก | เลื่อน implementation | ทดสอบความต้องการค้นจริงก่อน; keyword/structured filters ยังใช้ต่อ |
| Roadmap 12 เดือน, Phase 0 6–8 สัปดาห์, market/KPI figures | ใช้เป็นสมมติฐานสำหรับประเมิน | ไม่ใช่ deadline หรือผลลัพธ์ที่ยืนยัน; ประเมินหลังทราบทีม/ข้อมูล/API |

## 4. Roadmap ตามเกณฑ์ผ่าน

Priority P0 = งานรอบถัดไป/ตัวกั้น pilot ไม่ได้แปลว่าทุกโมดูลต้องทำพร้อมกัน

| Stage | ผลลัพธ์ให้ร้าน | งานหลักและ dependency | เกณฑ์ผ่านก่อนขยาย |
|---|---|---|---|
| **A — Data trust** | เข้าใจยอดและหลักฐานที่ยังขาด | แยกยอดจากต้นทางกับยอดรวมที่คำนวณเอง; ตรวจไฟล์จริงแต่ละ platform/version; ยืนยันคำศัพท์และ baseline | Golden cases ตรง; ไม่กล่าวว่าเงินเข้าธนาคารจาก Statement อย่างเดียว; การเงินตรวจรับ export ที่จะใช้ |
| **B — Financial review assistant** | ตรวจรายการเงินและสร้างงานติดตามจากหน้าเดิม | Tools ตามสิทธิ์ → สรุปพร้อม evidence → draft → user confirmation → task; เริ่ม synthetic ได้ระหว่างรอ A | เกณฑ์ใน docs/30 ผ่าน; โมเดลล่มยังใช้รายงาน; ไม่เปลี่ยน ledger/สั่งงานภายนอก; pilot จริงผ่าน A และ REL-AG-01 |
| **C — Connected operations** | เห็นและจัดการออเดอร์/ความพร้อมสินค้า | SKU lifecycle + listing mapping → inventory/reservation + orders → outbox/inbox → connector แรกแบบ read-only/shadow → เปิด write ตามการตรวจรับ | ไม่ตัดสต็อกซ้ำ; รับมือ oversell, cancellation/partial return; ตรวจ sync freshness/conflict และผลปลายทางได้ |
| **D — Published catalog & APIs** | เปิดข้อมูลสินค้าที่เลือกให้ระบบภายนอก | Identity/machine scopes + consent + published projection + API/MCP; ออกแบบ/ทดลอง read-only คู่ B/C ได้ | ข้อมูล public ไม่รั่วต้นทุน/การเงิน; revoked access ใช้ไม่ได้; แสดงความสด; inventory endpoint ต้องผ่าน C |
| **E — Checkout & bounded automation** | รับออเดอร์จากช่องทางใหม่และมอบหมายงานเฉพาะประเภท | Checkout/payment state, mandates ตาม integration จริง, post-purchase, approved connector writes; ต้องผ่านส่วน C/D ที่ใช้ | Payment timeout/expiry/replay/partial refund ผ่าน; ตรวจผลและชดเชยได้; provider readiness และร้านตรวจรับ |

Cross-cutting: tenancy, observability, cost controls, UX, tests และ security ทำในทุก stage ไม่เลื่อนไปท้ายโครงการ การเปิด Stage B ให้ร้านนำร่องไม่ต้องรอ C/D/E

อัปเดต UX ตามคำขอผู้ใช้ 2026-10-18: ให้ผู้ค้าชาวไทยที่ไม่เคยใช้ระบบเลือกงานจากภาษาธุรกิจและคำแนะนำทีละขั้น โดยคงความสามารถ สิทธิ์ และการยืนยันเดิม เริ่มหน้าแรก/เมนู (UX-MER-01) แล้วปรับเพิ่มสินค้า นำเข้า และการเงินก่อนตรวจรับกับผู้ค้าจริง ดู [แผน UX-MER-01–05](56-merchant-first-ux.md) การปรับหน้าจอไม่ใช่หลักฐานว่า pilot หรือ live integrations พร้อมแล้ว

**Stage C progress:** Product/SKU lifecycle, listing mapping, stock/reservation, internal orders, integration core และ machine ingress identity/lifecycle ส่งมอบใน local แล้วตาม [docs/46](46-product-and-sku-lifecycle.md)–[docs/55](55-service-credential-rotation.md) Event ออกเขียนพร้อม business state; event เข้าตรวจ HMAC, dedup/order/recovery และ delegated tenant/shop/scope/environment/audience พร้อม dual-key rotation ก่อนเข้า operational review โดยยังไม่แตะ business state งานถัดไปคือ CON-API-01a synthetic connector ingress contract ส่วน provider webhook จริง/partial return/refund/safety-stock policy ยังรอ DEC-05/06

**Support Experience track:** Co-browsing เป็นความสามารถสนับสนุนการใช้งาน ไม่เป็น dependency ของ Stage A/B หรือ production pilot แรก ปัจจุบันพักไว้ตามคำขอวันที่ 8 ตุลาคม 2026 โดยคง local synthetic PoC และเอกสารเดิมไว้ ไม่เชื่อม vendor SDK จนกว่าจะมีคำสั่งให้กลับมาดำเนินการ รายละเอียดอยู่ใน [แผน Co-browsing](37-cobrowsing-support-plan.md)

## 5. ขอบเขตและข้อจำกัดที่เก็บไว้

- ใช้ stack เดิมและ npm workspaces; ยังไม่เพิ่ม Kafka, microservices หรือ vector database จาก vision เพียงอย่างเดียว แผนนี้ไม่เปลี่ยนผู้ให้บริการ hosting
- Physical products ขายเป็นจำนวนเต็ม, THB, สินค้ามี/ไม่มีตัวเลือก; เสื้อผ้าและหมวดอื่นใช้ core เดียวกัน
- Stage C เตรียม locations แต่เริ่มคลังเดียว; ไม่เปิด BOM/kit components, lot/expiry/serial, fractional units, subscriptions หรือ multi-currency โดยปริยาย
- ข้อมูล stock quantity แยกจาก inventory valuation; cost history ปัจจุบันไม่ใช่ FIFO/ถัวเฉลี่ยและไม่อ้างเป็นมูลค่าสต็อกทางบัญชี
- ไม่เรียก contribution ว่ากำไรสุทธิ; ไม่ทำบัญชี/ภาษีครบระบบใน scope นี้
- แยก file adapter verification ออกจาก API connector authorization; ไฟล์จริงช่วยยืนยัน semantics แต่ไม่พิสูจน์ว่า API พร้อมใช้
- การแจ้งเตือน LINE/email, cross-tenant analytics และการขายข้อมูลให้ partner ยังไม่อยู่ใน slice แรก

## 6. UX ที่ใช้ร่วมกัน

คงหน้า catalog, settlements, review และรายงานเดิม เพิ่ม AI ตามบริบทที่ผู้ใช้กำลังทำงาน ไม่บังคับเริ่มผ่าน chat

- แสดงปัญหา → หลักฐาน → สิ่งที่เสนอ → สิ่งที่จะเปลี่ยน → สถานะผลลัพธ์ ด้วยภาษาไทยของงานจริง
- แยกข้อมูลจริง/ข้อมูลสมมติ, ที่มาของยอด, เวลาอัปเดตของแหล่งข้อมูล และเวลา AI วิเคราะห์
- ปุ่มบอกผลที่เกิด เช่น “สร้างงานติดตาม” ไม่ใช้ “ยืนยัน” โดยไม่บอกว่าจะทำอะไร
- “ร่าง”, “รอผู้ใช้ยืนยัน”, “สร้างงานแล้ว”, “ทำไม่สำเร็จ” และในอนาคต “รอตรวจผลปลายทาง” เป็นสถานะคนละเรื่อง ไม่ใช้คำว่าสำเร็จเมื่อแค่ส่งคำขอ
- เห็นก่อน–หลัง ผู้ได้รับมอบหมาย ขอบเขตร้าน และเหตุผล; ข้อเสนอใหม่หรือข้อมูลเปลี่ยนต้องให้ตรวจใหม่
- สิทธิ์หน้าจอต้องตรง API/tool; มือถือ 390 px ใช้งานได้ ไม่มี horizontal overflow ของหน้า, touch target ตาม docs/17, รองรับ keyboard/focus และไม่บอกสถานะด้วยสีอย่างเดียว

## 7. Enterprise readiness

รายการนี้เป็น requirements ไม่ใช่คำรับรองว่ามีครบแล้ว

| ก่อนเปิดความสามารถ | สิ่งที่ต้องตรวจรับ |
|---|---|
| Production pilot ทุกขนาด | Production identity, grants, isolated secrets/data, backup/restore rehearsal, retention, monitoring, incident owner และ AI usage budget |
| Service/Agent access | Principal + delegated scope/shop grants, credential rotation/revocation, per-tenant quotas, audit ที่เห็น requester/approver/executor, cache/queue/file/model isolation |
| External writes | Durable approval, replay protection, policy recheck, execution attempts, payload/data version, expiry, kill switch และ unknown-outcome recovery |
| Enterprise ตามความต้องการที่ขายจริง | SSO/SCIM, custom roles, separation of duties/multiple approvals, SIEM export, support access audit, RPO/RTO/SLA ตามข้อตกลง |
| เปิด Co-browsing ให้ tenant นำร่อง | Explicit consent, short-lived single-use session, page allowlist, local masking, persistent stop control, agent SSO/MFA, session audit และ tenant kill switch |
| Co-browsing ระดับ Enterprise | Data residency/self-hosting, SCIM/custom support roles, SIEM export, retention policy, vendor incident/SLA และ masking regression ผ่านก่อนเสนอขาย |
| เมื่อลูกค้าต้องการ isolation/region เฉพาะ | Dedicated resources, residency, customer-managed keys และ tenant migration/restore ที่ผ่านการซ้อม ก่อนรับปาก |

## 8. การวัดคุณค่าและการประเมินระยะเวลา

| ตัวชี้วัด | วิธีเก็บและข้อจำกัด | ผู้รับผิดชอบที่เสนอ |
|---|---|---|
| เวลาตรวจรายการ | วัดงานชุดเดียวกันก่อน/หลัง; แยกเวลาคนกับเวลารอระบบ | Product + ผู้ใช้การเงิน |
| รายการปิดได้อย่างถูกต้อง | จำนวนที่ตรวจหลักฐานครบ/รายการที่ตรวจทั้งหมด; แยกเปิดใหม่ภายหลัง | การเงิน |
| จำนวนเงินที่แก้ไข/ติดตามได้ | นับเฉพาะผลที่มีหลักฐานยืนยัน; ไม่รวมซ้ำกับยอดเดิม ไม่เรียกข้อสงสัยว่าเงินรั่ว | การเงิน |
| คุณภาพ AI | Unsupported claims, evidence access, correction/rejection และเหตุผล; approval rate ไม่ใช่ความถูกต้อง | Engineering + domain reviewer |
| Unit economics | AI/infra/support ต่อ active tenant และ completed workflow; จับคู่กับรายได้จริงเมื่อมี | Product + Engineering |
| การใช้งานซ้ำ/ยินดีจ่าย | รอบใช้งานถัดไปและ paid pilot จริง; ไม่อนุมานจากจำนวน API calls | Product |
| ประสิทธิผล Co-browsing | เปรียบเทียบเวลาแก้ปัญหา, first-contact resolution, abandonment และ CSAT กับเคสประเภทเดียวกัน; รายงาน masking/privacy incident แยก | Support + Product |

เก็บ baseline ก่อนตั้งเป้าเชิงธุรกิจ ไม่มีเป้ารับรอง GMV/conversion/latency จากเอกสารภายนอก รายงาน median และจำนวนตัวอย่าง ไม่สรุปจาก demo เดียว ประเมินงานตามกำลังทีมที่ยืนยันและ dependency; ใช้รอบ 1–2 สัปดาห์เพื่อ demo/ทบทวน ไม่ใช่รับประกันว่าจะส่งครบตามปฏิทินเดิม

แนวทางรายได้ที่ต้องทดลอง: ค่าบริการช่วยงานร้านรายเดือนพร้อมโควตา; checkout/channel fee พิจารณาภายหลังเมื่อ attribution และต้นทุนจริงชัดเจน; partner API ต้องมีสิทธิ์ข้อมูลและขอบเขตยินยอม ไม่ขายข้อมูลลูกค้าโดยปริยาย

## 9. Decision register และ external dependencies

| ID | ข้อเสนอ/สิ่งที่ยังไม่ทราบ | Owner ที่เสนอ / จุดที่ต้องได้คำตอบ |
|---|---|---|
| DEC-01 | งบ ทีม และผู้รับผิดชอบจริงยังไม่ทราบ | Product / ก่อนกำหนดวันส่งและปริมาณงานต่อรอบ |
| DEC-02 | Export ปกปิดข้อมูลอย่างน้อยหนึ่งชุดต่อ platform/version พร้อม edge cases และยอดยืนยัน | ร้าน + การเงิน / ก่อนรับรอง adapter และ pilot ของช่องทางนั้น |
| DEC-03 | Production identity, evidence storage, retention และ backup/recovery | Proposed options/approval gate ใน docs/43; Engineering + Product + Privacy/Finance / REL-AG-01 ก่อนข้อมูลจริง |
| DEC-04 | Pilot models, provider/data policy, งบต่อ run/tenant, quality/latency thresholds | Proposed policy/approval gate ใน docs/43; Engineering + Product + การเงิน / ก่อน live-model eval และเปิด pilot |
| DEC-05 | Connector แรกเสนอ TikTok จากบริบทร้าน; ยืนยันจากงานจริงและสิทธิ์ API | Product + ร้าน / ก่อน CON-API-01; ไม่เพิ่ม Shopify ถ้าไม่มี use case |
| DEC-06 | Stock authority, inbound inventory, cost valuation และ oversell handling | Operations + การเงิน / ก่อนเปิด stock writes ใน C |
| DEC-07 | ผู้ขายตามธุรกรรม, payment provider, checkout destination, refund responsibility และ provider eligibility | Product + ผู้เชี่ยวชาญที่เกี่ยวข้อง / ก่อน E; ไม่อนุมานจากการมี public spec |
| DEC-08 | Role ผู้สร้าง/รับงาน: owner/finance; auditor อ่านอย่างเดียวใน slice แรก | Product + การเงิน / ตรวจรับ FIN-AI-04 ก่อนใช้จริง; ไม่ขยายสิทธิ์ marketing/operator |
| DEC-09 | เลือก Co-browsing vendor/hosting/region, ข้อมูลที่แชร์, recording/retention และ integration กับ support desk | Security + Support + Engineering + Product / หลัง SUPPORT-01 PoC และก่อน SUPPORT-02 pilot |

ระหว่างรอข้อมูลจริงพัฒนา FIN-AI-01–05 ด้วย synthetic fixtures ได้ แต่ห้ามเปลี่ยนสถานะ adapter เป็น verified หรือรายงานผลประโยชน์จริง ไม่มีการขอสิทธิ์เชื่อมต่อ ซื้อบริการ หรือติดต่อผู้อื่นอัตโนมัติจากแผนนี้

## 10. Protocol research ที่ใช้ประกอบแผน

- [OpenAI — Powering Product Discovery in ChatGPT, 24 มีนาคม 2026](https://openai.com/index/powering-product-discovery-in-chatgpt/): ประกาศเน้น product discovery และให้ร้านใช้ checkout ของตนเอง จึงไม่ผูก milestone กับ Instant Checkout แบบเดิมอย่างเดียว
- [AP2 — Implementation considerations](https://ap2-protocol.org/ap2/implementation_considerations/): แยก catalog/commerce endpoints, checkout/payment mandates และ payment processor; AP2 ไม่ใช่ระบบ OMS ทั้งชุด
- [MCP — Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization): ใช้เป็น reference เรื่อง delegated access ไม่แทนที่ business authorization/approval

References ตรวจระหว่างการวิเคราะห์วันที่ 2026-09-17; ก่อน implementation ต้องตรวจ version, eligibility, geography และ sandbox อีกครั้ง ไม่ถือว่าได้รับสิทธิ์ production แล้ว

## เอกสารทำงานต่อ

- [Requirements และ permission baseline](02-requirements.md)
- [ADR เดิมและส่วนขยาย](03-architecture.md)
- [Active backlog และงานเดิม](04-backlog.md)
- [เกณฑ์ตรวจรับ](05-verification.md)
- [Slice แรก: AI ช่วยตรวจเงินและงานติดตาม](30-financial-review-assistant-slice.md)
- [Support Experience: Co-browsing](37-cobrowsing-support-plan.md)

### SC-2026-09-24-01 — Co-browsing support direction

เพิ่ม Co-browsing เป็นสายงานรองรับลูกค้าโดยต่อยอด identity, tenancy และ audit เดิม ไม่สร้าง remote-desktop engine เองในช่วงแรก เป้าหมายแรกคือ view-only บนหน้าเว็บของแพลตฟอร์ม พร้อมการยินยอมและ field masking; remote control, full desktop, recording และการส่งข้อมูลหน้าจอให้ AI อยู่นอก pilot แรก งานนี้ไม่เปลี่ยนลำดับ DATA-AG-01 → REL-AG-01 และไม่ถือเป็นการอนุมัติซื้อบริการหรือเปิดข้อมูลจริงให้ vendor
