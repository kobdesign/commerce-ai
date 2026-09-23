# Backlog และลำดับพัฒนา

สถานะ ณ 2026-09-17: มี **local foundation, generic order-line, raw source evidence, durable import worker, financial-event, settlement CSV/XLSX adapters/reconciliation และ shop-expense vertical slice** แล้ว ดู [ผลส่งมอบ v1.5](28-marketplace-settlement-adapters.md) FND-01/02/03, CAT-01, AI-01, IMP-01/02/03/04 และ QA-01 เริ่มมีโค้ดและการทดสอบ รวม checksum/source storage, source line deduplication, background commit/retry, refund/fee rebate/unmatched/reversal, adapter detection/preview/atomic commit และค่าใช้จ่ายระดับร้าน ส่วน production acceptance ยังขาดไฟล์จริงเพื่อตรวจรับ adapter, private object storage และ retention policy, bank feed, ad statement import, identity provider, backup/restore และ live model evaluation

## Active backlog — SC-2026-09-17-01

ใช้ [แผน Stage A–E](29-agentic-commerce-project-plan.md) เป็นลำดับปัจจุบัน และ [slice แรก](30-financial-review-assistant-slice.md) เป็นเกณฑ์พร้อมเริ่ม งานเดิมด้านล่างเก็บเพื่อ traceability ไม่ใช่ข้อบังคับให้ทำ AI mapping หรือทุก integration ก่อนเริ่ม financial review assistant

สถานะ `Ready (synthetic)` = มีขอบเขตพัฒนา/ทดสอบได้ด้วยข้อมูลสมมติ ไม่ใช่ production-ready; `Pending input` = ขาดข้อมูลเฉพาะงานนั้น; `Planned` = ยังต้องทำ dependency ให้ผ่าน ไม่มีงาน implementation ใหม่ในตารางนี้ถูกทำเสร็จเพียงเพราะเอกสารอัปเดต

| ID | Stage / งาน | Priority / สถานะ | Depends on | Owner ที่เสนอ | เกณฑ์ตรวจรับ |
|---|---|---|---|---|---|
| PLAN-AG-01 | ปรับ vision/ADR/requirements/backlog | P0 / จัดทำแผนแล้ว | คำขอผู้ใช้ | Product + Engineering | docs/01–06,29–30 สอดคล้อง; runtime ไม่เปลี่ยน |
| DATA-AG-01 | ตรวจ Statement จริงและ golden cases ต่อ platform/version | P0 / Pending input | DEC-02; ต่อ DISC-01/02, CON-01 | ร้าน + การเงิน + Engineering | ยืนยันยอด/semantics/sign/date/identity; fixture ปกปิดข้อมูล; sign-off ช่องทางที่จะ pilot |
| FIN-AI-01 | แยก reported/derived/unknown และข้อจำกัดการกระทบยอด | P0 / เสร็จและตรวจ synthetic ใน local | PLAN-AG-01; ต่อ FIN-01/02 | Engineering + การเงิน | FA-T01/02 ผ่าน; migration rehearsal และ raw evidence ตาม docs/31; ยังไม่ production-verified |
| FIN-AI-02 | Financial read tools + evidence contract | P0 / Complete (local synthetic) | FIN-AI-01; ต่อ AI-03 | Engineering | 84 integration tests; ผลส่งมอบ docs/32; ยังไม่ใช่ live model/UAT |
| FIN-AI-03 | Summary ตามบริบท + manual fallback + run metadata | P0 / Done (local) | FIN-AI-02; ต่อ AI-01/03 | Engineering + Product | FA-T04/05/09/10 ผ่าน mocked-model + system E2E; live eval อยู่ FIN-AI-05 |
| FIN-AI-04 | Draft → confirmation → task lifecycle | P0 / Done (local synthetic) | FIN-AI-02; ต่อ AI-04/UI-01 | Engineering + การเงิน | FA-T06/07/08/09 ผ่าน; ผลส่งมอบ docs/34; รอ finance UAT ใน FIN-AI-05 |
| FIN-AI-05 | E2E, AI eval และ UAT slice | P0 / Technical gate ผ่านใน local; รอ human/live | FIN-AI-03/04; DEC-04 สำหรับ live model | Reviewer + การเงิน | 97 automated + 26 browser E2E ผ่าน; evidence report docs/35; live model และ finance sign-off ยัง pending |
| REL-AG-01 | Production pilot readiness | P0 / Planned | DATA-AG-01, FIN-AI-05, DEC-03/04; ต่อ FND-02/04, REL-01 | Engineering + Product | Identity, storage/lifecycle, restore, monitoring, data policy/budget และ user UAT ผ่าน |
| PILOT-AG-01 | Pilot ร้านแรกและวัดผลจริง | P0 / Planned | REL-AG-01; ต่อ PILOT-01 | Product + ร้าน | เวลาตรวจ/ผลปิดงาน/ต้นทุนพร้อม baseline; ไม่ใช้ synthetic เป็นผลธุรกิจ |
| AUTH-AG-01 | Service principals + delegated grants/revocation | P1 / Planned | ADR-007, DEC-03 | Engineering | Role matrix เดิมไม่ถอย; AG-T01/02; ก่อน external/service access |
| CAT-AG-01 | เพิ่ม variant/archive และ listing mapping | P1 / Planned | FR-19; ต่อ CAT-01 | Engineering + Product | ประวัติเดิมไม่เสีย, SKU ไม่สับสน/ใช้ซ้ำ, cross-shop mapping ตรวจสิทธิ์ |
| OPS-AG-01 | Inventory/reservation และ order states | P1 / Planned | CAT-AG-01, DEC-06 | Engineering + Operations | AG-T04/05/06; valuation label ชัดเจน |
| INT-AG-01 | Outbox/inbox, idempotent delivery และ telemetry | P1 / Planned | ADR-010; integration event contracts | Engineering | AG-T07; recover จาก worker crash/duplicate และตรวจสถานะปลายทาง |
| CON-API-01 | Connector แรก read-only/shadow → controlled writes | P1 / Pending input | AUTH-AG-01, OPS-AG-01, INT-AG-01, DEC-05 + API access | Engineering + ร้าน | Contract/sandbox tests; webhook/replay/rate limit; seller authorization; ไม่เท่ากับ file adapter verified |
| PUB-AG-01 | Published catalog + consent + scoped API/MCP | P1 / Planned | AUTH-AG-01, CAT-AG-01; inventory tools เพิ่มหลัง OPS-AG-01 | Engineering + Product | AG-T08; public projection ไม่มี finance/PII; เริ่ม schema/prototype คู่ B/C ได้ |
| PAY-AG-01 | Checkout/payment/post-purchase | P2 / Pending input | CON-API-01, PUB-AG-01, DEC-07 | Engineering + payment/domain reviewer | AG-T09; provider eligibility และ payment failure/reconcile ผ่าน |
| AUTO-AG-01 | Listing/operations/external writes แบบจำกัดขอบเขต | P2 / Planned | AUTH-AG-01, CON-API-01, ADR-008 + use-case UAT | Engineering + Product | AG-T03/10/11; approval/current state/kill switch; วัดผลจริงก่อนเพิ่ม autonomy |
| ENT-AG-01 | Enterprise gap assessment และ readiness ตามลูกค้า | P1 / Planned | DEC-01/03; ต่อ ENT-01/02 | Product + Engineering | Requirement-cost matrix, separation of duties, SSO/SCIM/DR ก่อนขายฟีเจอร์นั้น |

งาน implementation ถัดไป: **DATA-AG-01 / REL-AG-01 readiness** หลัง [FIN-AI-05 ผ่าน technical gate ใน local](35-financial-ai-evaluation-and-uat.md) โดยเก็บ Statement ที่ปกปิดข้อมูล กำหนด data/model policy, usefulness/latency/cost thresholds และนัดผู้ใช้การเงินทำ UAT ก่อน production pilot

## Baseline backlog เดิม — เก็บเพื่ออ้างอิง

อัปเดต v1.5: CSV/XLSX รองรับ generic mapping และตัวอ่านแบบมีเวอร์ชันสำหรับ TikTok Shop/Shopee/Lazada, raw source evidence, atomic/idempotent commit, source line deduplication ข้ามไฟล์, snapshot ต้นทุน, refund/fee rebate, payout reconciliation และบัญชีค่าใช้จ่ายแบบ append-only, unmatched queue, summary/evidence และ RLS แล้ว Marketplace adapters ยังอยู่สถานะ synthetic contract จนกว่าจะตรวจรับกับไฟล์จริง และยังไม่ใช่ private object storage, bank reconciliation หรือ financial acceptance ครบชุด ดู [ผลส่งมอบ](28-marketplace-settlement-adapters.md)

Discovery → Foundations → Import → Reconciliation & Metrics → AI Analysis → Pilot

AI เริ่มอยู่ใน import workflow และต้องพร้อมก่อนเปิด pilot แรก ไม่ใช่เพิ่มหลังเปิดขาย ส่วน tests/security/observability ทำคู่กับแต่ละงาน

| ID | งาน / ผลส่งมอบ | Priority | Depends on | Owner ที่เสนอ | เกณฑ์ตรวจรับ |
|---|---|---|---|---|---|
| DISC-01 | สังเกตงานจริงและรายการรายงานที่มี | P0 | — | Product + เจ้าของร้าน | มี source inventory และ baseline เวลา; ระบุข้อมูลที่ขาด |
| DISC-02 | ยืนยันสูตรเงินเหลือและคำศัพท์ | P0 | DISC-01 | Product + การเงิน | สูตรพร้อมตัวอย่าง seller discount, fees, refund, ads และ rounding |
| DISC-03 | บันทึก stack / hosting / constraints | P0 | — | Tech lead | มีเหตุผล tradeoffs และข้อจำกัดงบ/region ที่ยังไม่ยืนยัน |
| FND-01 | Repo, environments และ CI | P0 | DISC-03 | Engineering | lint/typecheck/tests/build ผ่าน; secrets ไม่อยู่ repo |
| FND-02 | Identity, tenants, grants, shop scope | P0 | FND-01 | Engineering | tenant A/B fixtures; ปฏิเสธไม่มีสิทธิ์ทั้ง UI/API |
| FND-03 | DB policies, file access และ job context | P0 | FND-02 | Engineering | cross-tenant suite และ pool context reuse ผ่าน |
| FND-04 | Trace/audit/usage และ backup baseline | P0 | FND-03 | Engineering | trace หนึ่ง workflow ถึงต้นทางได้; มี restore plan |
| CAT-01 | Category-neutral catalog และ attribute contracts | P0 | FND-03 | Engineering + Product | สินค้าเสื้อผ้า/แก้วน้ำ/สกินแคร์และ default variant ใช้แกนเดียว; metadata ไม่ข้าม tenant |
| IMP-01 | Raw file upload + validation | P0 | FND-03, DISC-01 | Engineering | rejected rows ชัดเจน; schema/version/checksum; จำกัดไฟล์ |
| IMP-02 | Canonical data + mapping review | P0 | IMP-01, DISC-02 | Engineering + การเงิน | preview เทียบต้นทาง; commit หลัง validated mapping |
| AI-01 | Gateway, run state, schemas, budgets | P0 | FND-03, FND-04 | Engineering | bounded tool loop; ไม่มี key ใน client; failure state อ่านได้ |
| AI-02 | AI mapping assistant | P0 | IMP-02, AI-01 | Engineering | เสนอ mapping ได้; ไม่เขียนจำนวนเงินเอง; ambiguous ต้องตรวจ |
| IMP-03 | SKU mapping + effective cost history | P0 | IMP-02, CAT-01 | Engineering + การเงิน | missing cost flagged; cost version มีวันที่และ audit; attributes ไม่เป็น hardcoded key |
| IMP-04 | Import worker + replay/duplicate handling | P0 | IMP-02, FND-04 | Engineering | duplicate ไม่เพิ่มยอด; correction version รองรับ |
| FIN-01 | Financial events และ settlement matching — canonical vertical slice เสร็จ; รอ schema/statement จริงตรวจรับ | P0 | IMP-03, IMP-04 | Engineering + การเงิน | one-to-many, unmatched, partial refund ผ่าน fixtures |
| FIN-02 | Metrics + evidence API | P0 | FIN-01, DISC-02 | Engineering | exact expected values; actual/allocated/incomplete ไม่ปน |
| UI-01 | Summary + evidence detail + review inbox | P0 | FIN-02 | Engineering + Product | ผู้ใช้ตามยอดถึงต้นทางและจัดการรายการได้ |
| AI-03 | Evidence-backed analyst tools | P0 | AI-01, FIN-02 | Engineering | citations resolve; unauthorized metric ถูกปฏิเสธ |
| AI-04 | Review summary + task drafts | P0 | AI-03, UI-01 | Engineering | อ้างอิงรายการจริง; external actions ไม่เปิด |
| QA-01 | Golden financial + isolation + E2E suite | P0 | FND-02 | Engineering/Reviewer | เพิ่ม tests ตลอดงาน; gate ครบก่อน pilot |
| QA-02 | AI evaluation dataset และ release report | P0 | AI-02, AI-03, AI-04 | Engineering + ผู้ตรวจธุรกิจ | thresholds ตั้งก่อน run; critical cases ไม่มี failure |
| REL-01 | Staging rehearsal + restore + kill switch | P0 | UI-01, QA-01, QA-02 | Engineering | ซ้อม import failure/model outage/restore ผ่าน |
| PILOT-01 | ใช้งานจริงร้านแฟนและวัด baseline เทียบผล | P0 | REL-01 | Product + เจ้าของร้าน | user sign-off; บันทึกผลจริงและปัญหาโดยไม่แต่งตัวเลข |
| PILOT-02 | 3–5 ร้านที่อนุญาตทดลอง | P1 | PILOT-01 | Product | onboarding ใช้ flow ร่วม; ตรวจ retention/support cost |
| CON-01 | TikTok/Shopee/Lazada adapters หรือ API ที่ได้สิทธิ์ — synthetic contracts เสร็จ; รอไฟล์จริงตรวจรับ | P1 | PILOT-01 | Engineering | contract tests ด้วย schema จริงและ seller authorization |
| ENT-01 | Enterprise discovery + requirements mapping | P1 | PILOT-01 | Product + Tech lead | ข้อกำหนดและค่าใช้จ่ายจริงก่อนรับปากส่งมอบ |
| ENT-02 | SSO/SCIM/approval/SIEM/dedicated ตามสัญญา | P2 | ENT-01 | Engineering | UAT/security/DR ตามเกณฑ์ลูกค้า; ไม่เปิดด้วย mock |

## รอบแรกในประวัติโครงการ: Foundation + walking skeleton

เป้าหมาย: เปิดแอป → เข้าสู่องค์กร → เลือกร้าน → เห็นหน้าข้อมูลที่มีสิทธิ์ โดยใช้ synthetic fixtures และ tenant A/B

งาน: DISC-01/02/03, FND-01/02/03 และเริ่ม QA-01 ปริมาณงานต่อรอบให้ปรับตามกำลังทีม ห้ามสรุปว่าทั้งหมดเสร็จภายในสัปดาห์เดียวก่อนประเมิน

สิ่งที่ทำต่อได้โดยยังไม่มีไฟล์จริง: contracts, synthetic fixtures, tenancy tests, metric semantics draft, UI flow และ AI tool schemas

สิ่งที่ยังตรวจรับไม่ได้: adapter TikTok จริง การกระทบยอดจริง ความถูกต้องของกำไรจริง และการวัดเวลาที่ประหยัดให้ร้าน

## Definition of Ready

ทุกงานต้องมี actor, business outcome, input/evidence, permission scope, acceptance tests, dependencies และสิ่งที่ยังไม่ทราบ งาน financial/AI ต้องมี expected result หรือวิธีให้คนตรวจที่ตกลงไว้

งานใน active backlog ต้องระบุ stage, implementation/prototype/production status, data/provider dependency และ migration/recovery impact ด้วย Owner ในแผนเป็นบทบาทที่เสนอ ยังไม่ใช่การจัดสรรคนหรือประมาณเวลาที่ได้รับการยืนยัน
