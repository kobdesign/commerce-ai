# Backlog และลำดับพัฒนา

สถานะ ณ 2026-09-17: มี **local foundation, generic order-line, raw source evidence, durable import worker, financial-event และ shop-expense vertical slice** แล้ว ดู [ผลส่งมอบ v1.2](25-async-import-worker.md) FND-01/02/03, CAT-01, AI-01, IMP-01/02/03/04 และ QA-01 เริ่มมีโค้ดและการทดสอบ รวม checksum/source storage, source line deduplication, background commit/retry, refund/fee rebate/unmatched/reversal และค่าใช้จ่ายระดับร้าน ส่วน production acceptance ยังขาด private object storage และ retention policy, marketplace adapters, settlement/payout, ad statement import, identity provider, backup/restore และ live model evaluation

## ลำดับ dependency

อัปเดต v1.2: generic CSV รองรับ raw source evidence, mapping/review และ commit แบบ background + idempotent, สถานะ/auto retry/replay, source line deduplication ข้ามไฟล์, snapshot ต้นทุน, refund/fee rebate และบัญชีค่าใช้จ่ายแบบ append-only, unmatched queue, summary/evidence และ RLS แล้ว ยังไม่ใช่ private object storage, marketplace adapter, settlement/payout reconciliation หรือ financial acceptance ครบชุด ดู [ผลส่งมอบ](25-async-import-worker.md)

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
| FIN-01 | Financial events และ settlement matching | P0 | IMP-03, IMP-04 | Engineering + การเงิน | one-to-many, unmatched, partial refund ผ่าน fixtures |
| FIN-02 | Metrics + evidence API | P0 | FIN-01, DISC-02 | Engineering | exact expected values; actual/allocated/incomplete ไม่ปน |
| UI-01 | Summary + evidence detail + review inbox | P0 | FIN-02 | Engineering + Product | ผู้ใช้ตามยอดถึงต้นทางและจัดการรายการได้ |
| AI-03 | Evidence-backed analyst tools | P0 | AI-01, FIN-02 | Engineering | citations resolve; unauthorized metric ถูกปฏิเสธ |
| AI-04 | Review summary + task drafts | P0 | AI-03, UI-01 | Engineering | อ้างอิงรายการจริง; external actions ไม่เปิด |
| QA-01 | Golden financial + isolation + E2E suite | P0 | FND-02 | Engineering/Reviewer | เพิ่ม tests ตลอดงาน; gate ครบก่อน pilot |
| QA-02 | AI evaluation dataset และ release report | P0 | AI-02, AI-03, AI-04 | Engineering + ผู้ตรวจธุรกิจ | thresholds ตั้งก่อน run; critical cases ไม่มี failure |
| REL-01 | Staging rehearsal + restore + kill switch | P0 | UI-01, QA-01, QA-02 | Engineering | ซ้อม import failure/model outage/restore ผ่าน |
| PILOT-01 | ใช้งานจริงร้านแฟนและวัด baseline เทียบผล | P0 | REL-01 | Product + เจ้าของร้าน | user sign-off; บันทึกผลจริงและปัญหาโดยไม่แต่งตัวเลข |
| PILOT-02 | 3–5 ร้านที่อนุญาตทดลอง | P1 | PILOT-01 | Product | onboarding ใช้ flow ร่วม; ตรวจ retention/support cost |
| CON-01 | Shopee/Lazada adapters หรือ API ที่ได้สิทธิ์ | P1 | PILOT-01 | Engineering | contract tests ด้วย schema จริงและ seller authorization |
| ENT-01 | Enterprise discovery + requirements mapping | P1 | PILOT-01 | Product + Tech lead | ข้อกำหนดและค่าใช้จ่ายจริงก่อนรับปากส่งมอบ |
| ENT-02 | SSO/SCIM/approval/SIEM/dedicated ตามสัญญา | P2 | ENT-01 | Engineering | UAT/security/DR ตามเกณฑ์ลูกค้า; ไม่เปิดด้วย mock |

## รอบแรก: Foundation + walking skeleton

เป้าหมาย: เปิดแอป → เข้าสู่องค์กร → เลือกร้าน → เห็นหน้าข้อมูลที่มีสิทธิ์ โดยใช้ synthetic fixtures และ tenant A/B

งาน: DISC-01/02/03, FND-01/02/03 และเริ่ม QA-01 ปริมาณงานต่อรอบให้ปรับตามกำลังทีม ห้ามสรุปว่าทั้งหมดเสร็จภายในสัปดาห์เดียวก่อนประเมิน

สิ่งที่ทำต่อได้โดยยังไม่มีไฟล์จริง: contracts, synthetic fixtures, tenancy tests, metric semantics draft, UI flow และ AI tool schemas

สิ่งที่ยังตรวจรับไม่ได้: adapter TikTok จริง การกระทบยอดจริง ความถูกต้องของกำไรจริง และการวัดเวลาที่ประหยัดให้ร้าน

## Definition of Ready

ทุกงานต้องมี actor, business outcome, input/evidence, permission scope, acceptance tests, dependencies และสิ่งที่ยังไม่ทราบ งาน financial/AI ต้องมี expected result หรือวิธีให้คนตรวจที่ตกลงไว้
