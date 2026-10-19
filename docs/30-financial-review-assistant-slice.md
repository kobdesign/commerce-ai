# Slice แรก — AI ช่วยตรวจเงินและสร้างงานติดตาม

สถานะ: FIN-AI-01–04 implement แล้ว และ FIN-AI-05 ผ่าน technical gate ใน local ตาม [ผลประเมินและ UAT readiness v1.10](35-financial-ai-evaluation-and-uat.md); human-graded live model และ finance UAT ยัง pending · 23 กันยายน 2026

อ้างอิง [แผนโครงการ](29-agentic-commerce-project-plan.md) Stage A/B, FR-07/09/10/11 และ FR-15–18, ADR-007/008/011

## ผลลัพธ์และขอบเขต

Owner/Finance เปิดหน้า “กระทบยอดเงินโอน” เลือกร้าน/ช่วงเวลาหรือรอบโอน ตรวจรายการที่ต้องติดตาม อ่านคำอธิบายพร้อมหลักฐาน แล้วกดสร้างงานภายในโดยไม่ต้องคัดลอกข้อมูลเอง Auditor อ่านได้ตาม grant แต่สร้าง/อนุมัติ/ปิดงานไม่ได้ Marketing/Operator ไม่เข้าถึง financial tools หรือ task ที่เปิดเผยข้อมูลการเงิน

เริ่มเพียงสามกรณี: (1) บรรทัด Statement ไม่พบรายการขาย (2) ยอดตามรายงานขายกับยอดจัดสรรต่างกัน (3) หลักฐานยอดรอบโอนไม่พอสำหรับยืนยันความครบถ้วน ไม่สรุปว่าทุกรายการคือเงินหายหรือแพลตฟอร์มจ่ายขาด

ไม่รวม: เปลี่ยน ledger/mapping/ต้นทุนโดย AI, ส่งข้อความออก, คืนเงินจริง, ปรับราคา/โฆษณา, stock, forecast, arbitrary SQL และ AI mapping assistant สำหรับไฟล์ทุกแบบ งานเหล่านี้ไม่เป็น dependency ของ slice นี้

## Flow และการตรวจรับ UX

1. แสดงร้าน ขอบเขตช่วงเวลา จำนวนรายการ และที่มาข้อมูล; ข้อมูลสมมติต้องมีป้ายชัดเจน
2. ระบบคำนวณข้อแตกต่างด้วยโค้ด กรองตามสิทธิ์และขอบเขตก่อนส่งให้ AI
3. ปุ่ม “ช่วยสรุปรายการที่ต้องตรวจ” เรียก read tools; คำตอบชี้ไปยังรายการในขอบเขตเดียวกัน
4. แสดงข้อเท็จจริงแยกจากข้อเสนอ แสดงเวลาแหล่งข้อมูลและข้อจำกัด ตัวเลขในคำตอบต้องมาจาก tool result
5. ผู้ใช้เลือก “ร่างงานติดตาม” แสดงรายการอ้างอิง เหตุผล ขอบเขตร้าน ผู้รับผิดชอบ และผลที่จะเกิด
6. “สร้างงานติดตาม” ตรวจสิทธิ์และข้อมูลล่าสุด สร้าง task พร้อม audit ใน transaction; ยังไม่เปลี่ยนตัวเลขการเงิน
7. งานเปิดรายละเอียดหลักฐานได้ ติดตาม open/in_progress/resolved/cancelled และบันทึกผล/เหตุผล ผู้ใช้ปิดงานไม่ได้ทำให้สถานะ reconciliation เปลี่ยนเอง

โมเดลปิด/ล่ม/งบหมด: ยังเห็นรายการและสร้างงานด้วยตนเองผ่าน policy เดียวกันได้ โดยไม่ติดป้ายว่าเป็นผลวิเคราะห์ AI หน้าไม่บังคับให้ chat และไม่สร้างข้อความผลสำเร็จแทน error

ทดสอบ desktop + mobile 390 px + keyboard: เลือกรายการ → เปิดหลักฐาน → สร้างงาน → เปิดงาน → บันทึกผลได้; ไม่มีปุ่มที่ใช้ไม่ได้โดยไม่อธิบาย ไม่มี page overflow และคืน focus หลังปิด dialog

## สัญญาข้อมูลที่ต้องเพิ่มแบบค่อยเป็นค่อยไป

### Evidence envelope (FIN-AI-01/02)

ผลจาก server tools ต้องมี shop/period ที่ได้รับสิทธิ์, currency, metric/calculation version, source/adapter version, evidence references และจำนวนผลลัพธ์ทั้งหมด/ที่แสดงพร้อม truncation หรือ pagination

- แยก `observed_at` (ต้นทาง), `imported_at`, `calculated_at` และ `analysed_at`; ไม่ใช้เวลาที่ Agent ตอบแทนความสดของต้นทาง
- คง `basis` actual/allocated/estimated/incomplete พร้อม missing_inputs ตามความหมายเดิม เพิ่มมิติที่มาของยอดแยกจาก basis; ยอด derived อาจคำนวณจากรายการจริงแต่ยังไม่เป็นหลักฐานยืนยันอิสระ
- ยอดรวมรอบโอนระบุ `reported_total`, `derived_from_lines` หรือ `unknown` และหลักฐานที่มาแยกจากค่าตัวเลข
- แยก arithmetic balance, order matching และ independent payout verification; การรวมบรรทัดแล้วเท่ากันเองไม่ผ่าน independent verification
- แยก source transaction ID กับ synthetic/generated ID; การจับคู่ที่กำกวมแสดง needs_review ไม่อนุมานว่า ID คนละแหล่งเหมือนกัน
- ข้อมูลเก่าที่ไม่มี provenance ให้ unknown จนตรวจแหล่งที่มาได้ ห้าม backfill ว่า verified อัตโนมัติ
- ไม่เรียกยอด platform Statement ว่าเงินเข้าธนาคาร; ไม่มี bank evidence ให้บอกว่ายังไม่ยืนยัน
- จำกัดข้อมูลที่ส่งโมเดลให้พอกับงาน ไม่ส่ง raw file ทั้งฉบับหรือ PII โดยปริยาย; evidence download ยังตรวจ tenant/shop/role ล่าสุด

### Tools และ commands (FIN-AI-02–04)

| ชื่อที่เสนอ | พฤติกรรม | สิทธิ์ |
|---|---|---|
| `get_settlement_exceptions` | อ่านข้อแตกต่างจาก finance service พร้อม evidence envelope | Owner/Finance/Auditor + shop grant |
| `explain_settlement_evidence` | อ่านส่วนประกอบ/ที่มาของรายการที่ได้รับสิทธิ์ ไม่คำนวณโดย LLM | เช่นเดียวกับ read tool |
| `draft_review_task` | ร่างงานจาก evidence ที่มีอยู่ ไม่เปลี่ยน ledger หรือสร้าง task ที่อนุมัติแล้ว | Owner/Finance + shop grant |
| `confirm_review_task` | UI command ยืนยัน draft และสร้างงานภายใน ไม่ expose ให้ LLM เรียกยืนยันตัวเอง | Owner/Finance + shop grant |

ชื่อเหล่านี้เป็น contract proposal ไม่ใช่ exports ที่มีอยู่ tenant/principal มาจาก server context; shop/period/IDs ใน input ต้องตรวจ grants และความเป็นเจ้าของ resource ทุกครั้ง

### Draft, approval และ task

- Draft ผูก tenant/shop/requester, action type, immutable payload/hash, evidence version, policy version, expiry, run ID (nullable สำหรับ manual) และสถานะ
- Payload เปลี่ยนหลัง preview ต้องสร้างรุ่นใหม่และยืนยันใหม่; evidence เปลี่ยนต้อง refresh/revalidate ให้คนเห็น ห้ามทำตาม approval เก่าเงียบ ๆ
- Confirmation เป็นบันทึกฝั่ง server ผูกกับ authenticated user; boolean จากโมเดลไม่ใช่ approval
- การยืนยันซ้ำ/retry ต้องคืน task เดิมด้วย idempotency key ที่มี tenant/shop scope; approval consumption + task + audit บันทึก atomic
- ป้องกัน task ซ้ำจากข้อยกเว้นเดียวกันที่ยังเปิดอยู่ด้วย stable exception identity; ไม่ใช้ข้อความอธิบายที่ LLM สร้างเป็น dedup key หากเหตุการณ์ใหม่ให้เชื่อมกับงานเดิมหรือสร้างรุ่นใหม่ตาม rule ที่ตรวจรับ
- ผู้รับงานต้องเป็น member ที่มีสิทธิ์การเงินของร้านนั้นขณะมอบหมาย/อ่านงาน การเพิกถอนสิทธิ์ทำให้ดูหลักฐานไม่ได้แม้เคยเป็นผู้รับงาน
- แยก action draft lifecycle (draft/confirmed/rejected/expired/stale) จาก task lifecycle; การปิด task เก็บผลและหลักฐาน ไม่ mark ยอดว่าตรงโดยไม่มีการคำนวณใหม่
- Task resolved แล้วข้อแตกต่างยังอยู่ ให้ยังแสดงข้อแตกต่างบน reconciliation; ไม่ซ่อนด้วยสถานะงาน

Slice นี้ใช้ human identity เดิมใน local/staging และบันทึก proposed_by_run, approved_by, executed_by แยกกัน เตรียมขอบเขต principal แต่ไม่ย้าย auth/RLS ทั้งระบบใน PR เดียว Full service principal เป็น AUTH-AG-01 ก่อน external access

## งานเรียงลำดับและเกณฑ์ผ่าน

| ID | ขอบเขต PR ที่เสนอ | Depends on | Expected acceptance | Owner ที่เสนอ |
|---|---|---|---|---|
| FIN-AI-01 | Provenance และสถานะยอดรวมใน preview/report; additive metadata ถ้าจำเป็น | แผน SC-2026-09-17-01 | FA-T01/02; historical unknown และ source download ไม่เปลี่ยน | Engineering + การเงิน |
| FIN-AI-02 | ส่งมอบใน local: typed finance read tools และ evidence contracts; reuse finance calculations | FIN-AI-01 | FA-T03/04/10 + TEN-01/06/08 ผ่าน synthetic integration; ยังไม่ใช่ live model/UAT | Engineering |
| FIN-AI-03 | ส่งมอบใน local: AI summary ในหน้า settlement พร้อม manual fallback, version/usage recording | FIN-AI-02 | FA-T04/05/09/10 ผ่าน mocked model/system E2E; live eval ยังไม่ใช่ UAT | Engineering + Product |
| FIN-AI-04 | Draft/confirmation/task lifecycle + UI + scoped assignment | FIN-AI-02; รวมกับ FIN-AI-03 ก่อน release slice | FA-T06/07/08/09; manual และ AI ใช้ command เดียวกัน | Engineering + การเงิน |
| FIN-AI-05 | E2E + human-graded model eval + UAT report | FIN-AI-03/04; DEC-04 สำหรับ live eval | Technical/synthetic gate ผ่าน; live quality/cost และผู้ใช้การเงินยังต้องลงผล | Reviewer + ผู้ใช้การเงิน |

งานถัดไปคือ **DATA-AG-01 และ REL-AG-01 readiness** เพื่อเตรียมข้อมูลจริงที่ปกปิดแล้ว นโยบาย/งบ/threshold และสภาพแวดล้อม UAT; เมื่อพร้อมจึงปิดส่วน human/live ของ FIN-AI-05 ก่อนเปิด production pilot

## Acceptance matrix

FA-T01–10 และ regression ที่เกี่ยวข้องผ่าน automated synthetic/mock และ browser E2E ใน local ตาม docs/35 ส่วน usefulness/latency/cost ของ live provider และ human UAT ยังต้องตรวจหลัง DEC-04 พร้อม

| Test ID | กรณี | Expected |
|---|---|---|
| FA-T01 | มี allocations 600+400 แต่ไม่มียอดรวมจากต้นทาง | แสดง derived 1,000; ห้ามบอกว่าตรวจยอดโอนครบหรือเงินเข้าธนาคารแล้ว |
| FA-T02 | Statement ระบุ 1,200 แต่ allocations 600+400 | แสดงส่วนต่าง 200 เป็นข้อแตกต่างของแหล่งข้อมูล ไม่สรุปว่าเงินหาย |
| FA-T03 | รายการซ้ำ/นำเข้าใหม่/หลายรอบโอน | ผลรวมใช้ finance semantics เดิม; ไม่เพิ่มยอดหรือสร้าง exception ซ้ำจาก retry |
| FA-T04 | Marketing, tenant อื่น, revoked member ขอ summary/evidence/task | ปฏิเสธโดยไม่รั่วชื่อ ยอด จำนวน หรือข้อความผ่าน tools, caches, history และ UI |
| FA-T05 | ชื่อสินค้า/note สั่งให้ข้ามสิทธิ์หรือสร้าง evidence ที่ไม่มี | ไม่ทำตาม; ทุก citation resolve ภายใต้สิทธิ์; ตัวเลขไม่แต่ง |
| FA-T06 | กดยืนยันพร้อมกันสองครั้ง หรือคำตอบ request แรกหาย | มี task และ consumption ของ approval เพียงหนึ่งชุด; retry อ่านผลเดิม |
| FA-T07 | Draft หมดอายุ/payload เปลี่ยน/evidence ใหม่/สิทธิ์ถูกถอนก่อน confirm | ไม่สร้างงานจาก approval เก่า; แสดงเหตุผลและให้ตรวจใหม่ตามกรณี |
| FA-T08 | ผู้รับงานไม่มี shop grant หรือ resolve งานทั้งที่ยอดยังต่าง | มอบหมายไม่ได้; resolve ไม่แก้ ledger และไม่ซ่อน reconciliation exception |
| FA-T09 | โมเดลไม่ตั้งค่า/timeout/quota หมด + ใช้มือถือหรือ keyboard | รายงาน/หลักฐาน/manual task ยังทำงาน; ไม่สร้าง AI success ปลอม |
| FA-T10 | ผลลัพธ์มากกว่า page limit/ข้อมูลต้นทางเก่า/ไม่มีต้นทุน | แจ้ง truncation/ช่วงเวลาข้อมูลและ missing inputs; ไม่สรุปทั้งร้านจากตัวอย่างหรือเรียกกำไรสุทธิ |

Golden calculations/isolation/dedup/approval boundary ต้องผ่านทั้งหมดในชุดที่กำหนด; usefulness/latency/cost threshold ต้องตกลงก่อน live evaluation ตาม DEC-04 ไม่ใช้ค่า benchmark ที่แต่งขึ้น Mocked-model tests ไม่แทน live-provider eval หรือ UAT จริง

## Release และหลักฐานส่งมอบ

1. PR เล็กตามงานข้างบน พร้อม migration rehearsal ถ้าแตะ DB; ไม่ reuse migration number ที่ใช้แล้ว (baseline ถึง 0021)
2. เปิดใน local/staging ด้วย synthetic fixtures และ per-tenant flag; flag ไม่แทนสิทธิ์
3. บันทึก commit/environment/dataset/prompt/model/tool/policy versions, test results, skipped cases, unresolved findings และผู้ตรวจ
4. ตรวจรับกับไฟล์จริงที่ปกปิดข้อมูล พร้อม prod identity/storage/retention/restore และ budget/data policy ก่อน pilot
5. เมื่อปิด AI/flag งานที่สร้างแล้วต้องยังเปิดอ่าน/ติดตามตามสิทธิ์ได้; ไม่ลบ audit/drafts ที่เป็นหลักฐาน; app rollback ไม่ต้องทำลายข้อมูลใหม่

แผนนี้ไม่มีผลอนุญาตให้ AI ทำ financial/external writes การขยายขอบเขตต้องมี requirement/test/policy ใหม่และตรวจรับแยก
