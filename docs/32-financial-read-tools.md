# FIN-AI-02 — เครื่องมืออ่านการเงินพร้อมหลักฐาน (v1.7)

วันที่ตรวจ: 17 กันยายน 2026 · สถานะ: implementation และ synthetic verification ใน local ผ่าน; ยังไม่เชื่อมเข้าคำตอบจากโมเดลหรือ production

## ผลลัพธ์

เพิ่ม read tools ฝั่ง server สองตัวโดยไม่มีสิทธิ์เขียน ledger หรือสร้างงาน:

- `get_settlement_exceptions` อ่านรายการที่ต้องตรวจจากสูตรใน finance service ได้แก่ บรรทัด Statement ที่ไม่พบรายการขาย ยอดจัดสรรต่อคำสั่งซื้อแตกต่าง ยอดรวมรอบโอนแตกต่าง และหลักฐานยอดรวมไม่พอ
- `explain_settlement_evidence` อธิบายรอบโอนหนึ่งรอบจากผลคำนวณเดียวกับหน้ากระทบยอด พร้อมบรรทัดหลักฐานและที่มาของยอดรวม

ทั้งสองเครื่องมือผูกกับร้านที่ผู้ใช้เลือกก่อนส่งให้ Agent และตรวจสิทธิ์ Owner/Finance/Auditor, tenant, shop grant และ membership ล่าสุดซ้ำใน finance/RLS ทุกครั้ง Marketing, tenant อื่น และสมาชิกที่ถูกถอนสิทธิ์อ่านไม่ได้

## Evidence contract

ผลลัพธ์ใช้ `finance-evidence-v1` และระบุ:

- ร้าน ช่องทาง และช่วงวันที่ที่อ่านจริง โดยจำกัดช่วงไม่เกิน 366 วัน
- THB, `settlement-reconciliation-v2`, เวลา observed/imported/calculated/analysed แยกกัน
- adapter, schema และ parser version จาก import batch; รายการกรอกเองใช้เวอร์ชัน `manual-settlement-v1`
- จำนวนข้อแตกต่างทั้งหมด จำนวนที่แสดง และ `truncated` เมื่อเกิน limit
- `actual/allocated/estimated/incomplete` เป็น calculation basis แยกจาก `reported_total/derived_from_lines/unknown`
- arithmetic balance, order matching และ `independentPayoutVerification` เป็นคนละสถานะ โดยปัจจุบันค่า independent verification เป็น false เสมอเพราะยังไม่มีหลักฐานธนาคาร
- stable internal evidence references แยกจาก source transaction ID และระบุ ID ที่ระบบสร้างเอง; ไม่ส่ง raw file, หมายเหตุ หรือชื่อสินค้าไปใน tool result
- `missingInputs` เช่น `reported_payout_total`, `payout_total_provenance`, `matching_sales_orders` และ `settlement_data`

ตัวเลขทั้งหมดมาจาก `@commerce/finance` ซึ่งรองรับ period/payout scope เพิ่มเติม AI layer เพียงจัดรูป evidence และจำแนกสถานะจากผลคำนวณ ไม่คำนวณเงินซ้ำ ไม่เรียกยอด Statement ว่าเงินเข้าธนาคาร และไม่สรุปสาเหตุหรือกำไรสุทธิ

## ผลตรวจ

- Integration tests 84/84 ผ่าน รวม stable retry, คำสั่งซื้อที่รับเงินข้ามหลายรอบโอน, limit/truncation, missing inputs, source versions, ข้อความแฝงใน note, tenant/role/shop isolation และ revoked membership
- TypeScript, lint และ production build ผ่าน
- ไม่มี migration ใหม่ในงานนี้; schema เดิมและข้อมูล FIN-AI-01 ไม่ถูกเปลี่ยน
- ใช้ข้อมูลสมมติและไม่เรียก external model; ยังไม่ใช่ model evaluation, UAT ด้วย Statement จริง หรือการรับรอง production

## ขอบเขตถัดไป

FIN-AI-03 จะนำ read tools นี้ไปใช้ในหน้า “กระทบยอดเงินโอน” เพื่อสร้างสรุปภาษาไทยพร้อมหลักฐาน มีผลจากระบบเป็น fallback เมื่อโมเดลปิดหรือล้มเหลว และบันทึกรุ่น prompt/model/tool/policy/usage โดยไม่เพิ่ม write tool
