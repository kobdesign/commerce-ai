# FIN-AI-01 — ที่มาของยอดรวมกระทบยอด (v1.6)

วันที่ตรวจ: 17 กันยายน 2026 · สถานะ: implementation และ synthetic verification ใน local ผ่าน; ยังไม่รับรอง export จริงหรือ production

## ปัญหาและพฤติกรรมใหม่

เดิม adapter ใช้ผลรวม allocations แทนยอดรวมเมื่อไฟล์ไม่มีค่า แล้วแสดงผลว่ากระทบครบหากตัวเลขเท่ากันและพบออเดอร์ครบ รุ่นนี้แยกที่มาของยอดตั้งแต่ parser, preview, ledger จนถึงหน้ารายงาน

| ที่มา | การแสดงผล | ใช้ยืนยันการเทียบยอดต้นทางได้หรือไม่ |
|---|---|---|
| `reported_total` | ยอดตาม Statement; เป็นค่าจากคอลัมน์ที่เลือกหรือผู้ใช้ระบุที่มา | เทียบได้เมื่อยอดตรง มีบรรทัดที่ยังมีผล และจับคู่ออเดอร์ครบ; ไม่ใช่ bank verification |
| `derived_from_lines` | ยอดที่ระบบรวมเอง | ไม่ได้ แม้ผลต่างทางคณิตศาสตร์เป็นศูนย์ |
| `unknown` | ยังไม่ทราบที่มาของยอดรวม / ข้อมูลยังไม่พอ | ไม่ได้ รวมข้อมูลเก่าและรอบที่มีที่มาปะปน |

FA-T01: allocations 600+400 ไม่มี total → แสดง derived 1,000 และยังไม่ยืนยันยอดโอน

FA-T02: reported 1,200 เทียบ allocations 1,000 → แสดงยอดต่าง -200 โดยไม่สรุปว่าเงินหาย

## Data contract และความเข้ากันได้

- Migration 0019 เพิ่ม `settlement_lines.payout_total_basis` แบบ additive มี default `unknown`; ไม่เขียนทับ raw bytes, checksum, preview, จำนวนเงิน หรือประวัติเดิม
- Generic mapped CSV ใช้ยอดจากคอลัมน์ที่ผู้ใช้เลือก; marketplace adapter จำแนกต่อแถว ถ้ามีคอลัมน์ total แต่ cell ว่างแล้ว fallback รวมรายการ ยังต้องเป็น derived
- ต้นทางไม่เปลี่ยน schema version เพราะกฎอ่านยอดเดิมยังอยู่; preview/parser เปลี่ยน v1 → v2 เพื่อระบุ semantics ของ metadata/สถานะใหม่
- Parser v2 ตรวจ fingerprint v1 ด้วยเพื่อคืน batch เดิมเมื่อ replay; ไม่ re-import หรืออัปเกรด provenance ของหลักฐานเก่าเงียบ ๆ
- ยอดรวมของ payout ที่มี origins ต่างกันเป็น unknown แบบ conservative แม้ตัวเลขเท่ากัน; รวม provenance ของประวัติรอบนั้นรวมถึงบรรทัดแก้กลับ ไม่ใช้การแก้กลับล้างความไม่แน่ชัดอัตโนมัติ
- Manual API ไม่ส่ง basis → unknown; UI เริ่ม unknown และให้เลือก “ระบุยอดรวมไว้ใน Statement” เมื่อมีหลักฐาน พร้อม confirmation เดิม ข้อมูลนี้เป็นคำระบุของผู้ใช้ ไม่ใช่การตรวจธนาคาร
- Reversal คัดลอก basis จากต้นฉบับ และ trigger ปฏิเสธการเปลี่ยน provenance; การ replay source เดิมด้วย basis ต่างกันเป็น conflict
- `differenceMinor` ยังเป็น allocated − reference total; เพิ่ม `arithmeticBalanced` และ `reconciliationComplete` ให้ API แยกตัวเลขตรงกันจากการตรวจตามต้นทาง ห้าม consumer/AI ใช้ difference=0 เป็นข้อสรุปเพียงอย่างเดียว
- `summary.reportedPayoutMinor` นับเฉพาะรอบที่เป็น reported; เพิ่ม derived/unknown counts และนับรายการเหล่านี้ใน unresolved สรุปครอบคลุมทั้งร้านแม้ตารางแสดงล่าสุด 100 รอบ
- RLS/role checks/source downloads และ append-only grants เดิมคงอยู่ ข้อมูล provenance จาก client ไม่สามารถ override การ parse ไฟล์ผ่าน import API ได้

## UX

Preview แสดงที่มาของยอดต่อแถวและสรุปต่อรอบ การยืนยันนำเข้าระบุให้รับทราบยอดที่คำนวณเองได้โดยไม่บังคับกล่าวว่า total ทุกค่ามาจากไฟล์

หน้ากระทบยอดใช้ “ตรงกับยอดต้นทาง” สำหรับรอบที่ผ่านเงื่อนไข ส่วน derived/unknown ใช้ “ข้อมูลยังไม่พอ” และไม่แสดง +0 เป็นหลักฐานว่าเทียบยอดต้นทางแล้ว แสดง — พร้อมคำอธิบายแทน ยังแสดง allocations และ reference total ให้ตรวจด้วยตนเองได้

ยอดตามรายงานขายกับ allocations ในตารางคำสั่งซื้อยังเป็นการเทียบอีกมิติหนึ่ง สถานะตรงกันในตารางนั้นไม่ยืนยันยอดรอบโอนหรือยอดเข้าธนาคาร

## ผลตรวจ

- Integration tests 81/81 ผ่าน รวม FA-T01/02, blank total cell, mixed origins, legacy unknown, reversal provenance, raw download, replay v1/v2 และ role/isolation regressions
- Browser tests ที่เกี่ยวข้อง 5/5 ผ่าน: manual reported total บนมือถือ, generic CSV + download, Shopee adapter, derived preview/commit/reload บน 390 px และ unknown/reported difference บน desktop
- TypeScript ผ่านใน production build; lint ผ่าน
- ซ้อม migration 0018 → 0019 ในฐานข้อมูลชั่วคราวที่มี legacy settlement + raw batch: จำนวนเงิน/IDs/timestamps/raw bytes/checksum/preview คงเดิม และ basis เป็น unknown ฐานข้อมูลซ้อมถูกลบหลังจบ
- ตรวจ browser จริงด้วย agent-browser: login/หน้ากระทบยอดโหลดได้; เห็น default unknown ของ manual form และสถานะทั้งสาม; ตรวจความยาวข้อความในตารางและปรับให้ wrap

ผลนี้ใช้ข้อมูลสมมติ ไม่ใช่ human UAT ของร้านหรือผลประเมินโมเดล AI; FIN-AI-02–05 ยังไม่ได้ implement

## Release / recovery

ใช้ migration ก่อนเปิด app รุ่นใหม่ ไม่แก้ไฟล์ migration 0013–0018 และไม่ลบหลักฐานเมื่อหยุดฟีเจอร์ งานนี้ยังไม่ merge/deploy production

หากมีปัญหาให้ forward-fix หรือหยุดเส้นทางกระทบยอดชั่วคราว การย้อนใช้ app เก่าที่ไม่รู้จัก provenance จะกลับไปแสดงสถานะมั่นใจเกินหลักฐาน และ reversal รุ่นเก่าอาจถูก trigger ปฏิเสธเมื่อเจอ reported/derived rows ใหม่ จึงต้องตรวจ compatibility หรือใช้รุ่นแก้ไขที่รักษากฎใหม่นี้ก่อนเปิดให้ผู้ใช้ ไม่ drop คอลัมน์/trigger เพื่อให้การย้อนรุ่นผ่าน

ข้อจำกัด: ยังไม่มีขั้นตอนอัปเกรดหลักฐานเก่าเป็น reported และยังไม่รวม negative adjustments หรือแก้ semantics เฉพาะ marketplace ที่ต้องใช้ไฟล์จริง ข้อมูลเดิมที่ unknown ต้องรอ workflow ตรวจหลักฐานแยก ไม่อนุมานจากจำนวนเงินเท่ากัน

งานถัดไป: FIN-AI-02 — financial read tools และ evidence contract ตาม [slice ตรวจเงิน](30-financial-review-assistant-slice.md)
