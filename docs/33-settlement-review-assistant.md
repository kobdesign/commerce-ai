# ผลส่งมอบ v1.8 — ผู้ช่วยสรุปการกระทบยอด

สถานะ: FIN-AI-03 implement และผ่าน synthetic integration/E2E ใน local · 17 กันยายน 2026

## พฤติกรรมที่ส่งมอบ

- หน้า “กระทบยอดเงินโอน” เลือกช่วงเวลาและจำนวนรายการ แล้วสรุปจาก finance evidence contract เดิมได้โดยไม่ต้องใช้โมเดล
- เมื่อเปิด live AI โมเดลอ่านหลักฐานที่ server กรองสิทธิ์ไว้แล้วและเลือกได้เฉพาะ `exceptionId` ที่มีจริงไม่เกิน 5 รายการ ตัวเลข ข้อเท็จจริง และข้อความแนะนำที่แสดงสร้างจากโค้ด ไม่รับตัวเลขหรือข้อความอิสระจากโมเดล
- ผลลัพธ์แยกข้อเท็จจริง ขั้นตอนตรวจต่อ ที่มา/เวลา ข้อมูลที่ขาด และข้อจำกัด รวมถึงบอกชัดว่า Statement ไม่ใช่หลักฐานเงินเข้าธนาคาร
- โมเดลไม่ตั้งค่า ล่ม timeout หรืออ้างหลักฐานที่ไม่มีจริง จะไม่ถูกบันทึกเป็น AI success ผู้ใช้ยังใช้ “สรุปจากข้อมูล” และหน้ากระทบยอดเดิมได้
- ประวัติแต่ละ run เปิดด้วย URL ของตัวเอง และลิงก์จากผลล่าสุดผูก run ID โดยตรงเพื่อไม่เปิดผลก่อนหน้าระหว่าง refresh

## Boundary และการบันทึก

Migration `0020-financial-ai-runs.sql` เพิ่ม `workflow_version`, `tool_version`, `policy_version` และ bounded request ลง `app.ai_runs` โดยเก็บ immutable ตั้งแต่จอง run ก่อนเรียกโมเดล และ `0021-financial-ai-run-boundary.sql` บังคับ finance role, เวอร์ชันที่รองรับ และโครงสร้าง period/limit ที่ฐานข้อมูล ใช้ quota/concurrency เดิมและไม่เก็บ raw statement, note, PII หรือ credential

Run บันทึก mode, model, prompt/workflow/tool/policy versions, period/limit, status, result, token usage, cost estimate และ error code RLS ยังจำกัดตาม tenant/shop/actor และ package ตรวจ role Owner/Finance/Auditor ซ้ำทุกครั้งที่อ่านประวัติ การเปลี่ยน role หรือ revoke membership จึงไม่อาศัย context เก่า

ไม่มี AI tool สำหรับเขียน ledger, mapping, cost, task หรือการส่งข้อมูลออก งานสร้าง task พร้อม human confirmation อยู่ใน FIN-AI-04

## หลักฐานตรวจ

- Integration: 12 files, 89 tests ผ่าน ครอบคลุม system fallback, valid mocked model, unsupported evidence, role/tenant isolation, empty/missing inputs และ regression เดิม
- E2E: flow มือถือ 390 px ผ่าน ตั้งแต่สรุปจากข้อมูล → อ่านข้อจำกัด → เปิดประวัติฉบับเดียวกัน; touch target 48 px และไม่มี document overflow
- Browser verification: desktop/mobile โหลดได้ ไม่มี framework error overlay ผลสรุปแสดง source label และ evidence limitations
- `lint`, `typecheck` และ production `build` ผ่าน

Mocked model test ยืนยัน orchestration และ policy boundary แต่ยังไม่ใช่ live-provider quality evaluation การเปิด pilot ยังต้องกำหนด DEC-04, ใช้ไฟล์จริงที่ปกปิดข้อมูล, ตรวจ retention/budget และทำ FIN-AI-05 human UAT

งานถัดไปคือ **FIN-AI-04**: draft/confirmation/task lifecycle โดยให้ manual และ AI ใช้ command เดียวกัน และห้ามโมเดลยืนยันงานแทนผู้ใช้
