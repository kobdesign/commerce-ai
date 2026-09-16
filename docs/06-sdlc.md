# SDLC และ delivery process

## Workflow

Discovery → Requirements/acceptance → Architecture/data contracts → Small implementation slices → Automated checks + review → Staging/UAT → Controlled release → Measure/learn → Backlog

รอบ 1–2 สัปดาห์เป็น cadence ที่เสนอ ไม่ใช่ deadline แต่ละรอบส่งสิ่งที่ผู้ใช้ลองทำงานได้จริง เทียบผลกับ baseline และปรับ backlog

## บทบาท

| บทบาท | รับผิดชอบ |
|---|---|
| Product owner | เป้าหมายธุรกิจ scope priority และ UAT |
| Domain reviewer | นิยามรายได้ ต้นทุน ค่าธรรมเนียมและข้อยกเว้น |
| Engineering owner | implementation, architecture, tests, observability และ release |
| Reviewer | ตรวจความถูกต้อง สิทธิ์ ผลกระทบ migrations และ AI eval |

คนเดียวรับหลายบทบาทได้เมื่อทีมเล็ก แต่การตรวจตัวเลขจริงควรมีผู้เข้าใจข้อมูลธุรกิจร่วมยืนยัน ไม่มีการตั้งหรือเรียก subagents จากแผนนี้

## Definition of Done

- Workflow ใช้งานได้และ acceptance criteria ผ่าน
- tenant/shop grants บังคับที่ server และผ่าน tests ตามเส้นทางที่เปลี่ยน
- สูตรมี expected values, lineage และสถานะ actual/estimated/incomplete
- AI เปลี่ยนแล้ว eval ที่เกี่ยวข้องผ่าน พร้อม evidence/model/prompt/tool versions
- อัปเดต audit/usage/monitoring และคู่มือกรณีล้มเหลว
- migrations มีแผน forward/rollback ที่ไม่ทำข้อมูลหาย และแยก deployment กับ destructive cleanup
- ไม่มี secrets ใน repo/log และไม่มี unresolved critical security failures
- reviewer/UAT ตามความเสี่ยงเสร็จ; ระบุข้อจำกัดที่ยังมี

## CI / review

ทุก PR: lint, typecheck, relevant unit/integration tests, secret/dependency scan และ build

งาน DB/auth: เพิ่ม migration rehearsal, DB-role/RLS integration, cross-tenant tests

งาน financial: เพิ่ม golden cases และ regression cases ที่พบจริง

งาน AI: schema/tool authorization tests และ bounded evaluation suite; ใช้ mocked model ใน deterministic tests และมี provider evaluation แยกที่ควบคุมข้อมูล/งบ

งาน release: critical E2E, backup/restore evidence, smoke test และ rollout plan

ควรใช้ PR ขนาดเล็กและแยก feature ด้วย flags โดยการปิด flag ไม่ใช่การแทน authorization

## Environments และ deployment

- Local: synthetic fixtures ไม่มี production credentials
- Staging: บัญชี/ไฟล์ทดสอบหรือข้อมูลที่อนุญาตและลดข้อมูลส่วนบุคคลแล้ว
- Production: แยก secrets, buckets, DB access, provider credentials และ budget
- Preview environments ไม่เชื่อม production data โดยอัตโนมัติ
- release แบบ backward-compatible migrations (expand → deploy/backfill → verify → contract ภายหลัง)
- app rollback อาจไม่ rollback DB; มี forward-fix และ restore plan แยก
- เปิด pilot ตาม tenant ผ่าน feature flags ตรวจ errors/latency/data freshness/AI cost แล้วจึงขยาย

## Incident และ learning

กำหนดผู้รับผิดชอบ การหยุด workflow/AI การเพิกถอน credentials วิธีประเมินผลกระทบ tenant และช่องทางแจ้งลูกค้าก่อน production บันทึก root cause และเพิ่ม regression test หลัง incident

ผู้ดูแลตรวจ usage/error budget ตาม cadence ที่กำหนด ไม่ส่ง notification ที่ไม่ actionable ทุก run

## การเปลี่ยน scope

คำขอใหม่ต้องระบุปัญหา ประโยชน์ ข้อมูลที่ต้องเพิ่ม ผลต่อ tenancy/AI/cost และ acceptance criteria ปรับ ADR/backlog ให้ตรง final scope ก่อนเริ่ม implementation ไม่เพิ่ม ERP/automation เพียงเพราะโครงสร้างรองรับได้
