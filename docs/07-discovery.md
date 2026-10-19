# Discovery และ decision log

## สถานะจากคำตอบล่าสุด

- ผู้ใช้ต้องการให้แนะนำ stack ยังไม่ได้ระบุ framework ที่ถนัดหรือขนาดทีม
- ยังไม่แน่ใจว่าร้านใช้ระบบหลังบ้านอะไรและมีรายงานส่งออกใดบ้าง
- จึงยังไม่มีหลักฐานว่าฟิลด์ที่ต้องใช้ใน adapter หาได้ครบ

## Checklist สำรวจร้าน — ทำก่อนตรวจรับ integration จริง

| เรื่อง | สิ่งที่เก็บ | ใช้ตัดสินใจ |
|---|---|---|
| งานจริงหนึ่งรอบ | ขั้นตอน ผู้ทำ เวลาที่ใช้ ปัญหาที่พบ | baseline และ UX |
| ระบบปัจจุบัน | Seller Center/Excel/ระบบอื่นที่ใช้จริง | build vs integrate |
| รายงานออเดอร์ | ชื่อไฟล์ คอลัมน์ ตัวอย่างและสถานะรายการ | orders/lines adapter |
| รายงานการเงิน | statement, transaction, payout, refunds ที่มี | reconciliation และ sign conventions |
| ค่าแอด | ระดับ campaign/product/date และวันที่รายงาน | allocation policy ไม่อ้าง exact attribution |
| ต้นทุน | ต่อ SKU/หน่วยขาย วันที่มีผล ค่าแพ็ก/ขนส่ง; pilot เสื้อผ้าแยกตามสี/ไซซ์ | contribution calculation |
| ประเภทสินค้า | สินค้ามี/ไม่มีตัวเลือก คุณสมบัติ หน่วยขาย และความต้องการเฉพาะหมวด | core catalog กับ extensions ที่ต้องทำเพิ่ม |
| สิทธิ์บุคลากร | ใครดู/แก้/ส่งออกอะไรได้ | permission matrix |
| ปริมาณ | orders/month, SKU count, file size, shops | capacity/quotas/cost |

ใช้สำเนาตัวอย่างที่ลบชื่อ เบอร์โทร ที่อยู่ และข้อมูลไม่จำเป็นออก การสำรวจนี้ไม่ต้องขอรหัสผ่านหรือ API token จากผู้ใช้ผ่านแชต

หากดาวน์โหลดรายงานบางชนิดไม่ได้ ให้บันทึก unavailable และปรับขอบเขต/สถานะความครบถ้วน ไม่สร้างคอลัมน์หรือยอดสมมติแทนข้อมูลจริง

## Decision log

| Decision | สถานะ | เหตุผล / งานต่อ |
|---|---|---|
| AI Native + Multi-Tenant + Enterprise path | ผู้ใช้ต้องการ | เป็นข้อกำหนดหลัก |
| เริ่ม workflow import → metrics → AI evidence | baseline ที่เสนอและเริ่มวางแผนแล้ว | ตรวจข้อมูลจริงก่อน implementation adapter |
| CSV/XLSX ก่อน API | ข้อเสนอ | ตรวจรูปแบบและสิทธิ์ export จริง |
| TypeScript/Next.js stack | ติดตั้งพร้อม PostgreSQL/worker แล้ว | ต่อจาก repo เดิม; ดู docs/08 และ docs/10–28 |
| Hosting/budget/region | มีแผน/คู่มือ Render staging ตาม docs/21 | ยืนยันสถานะ environment งบ และ production readiness ณ วันปล่อยจริง |
| Model/provider | ยังไม่เลือก production model | เลือกจาก eval ภาษาไทย/tool use/cost/data policy |
| เวลาและทีม | ยังไม่ทราบ | ไม่กำหนด deadline จากสมมติฐาน |

## Workshop แรกที่เสนอ

เดินงานจริงหนึ่งรอบ → ตรวจรายงานตัวอย่าง → ยืนยันหนึ่งออเดอร์และยอดหัก → ตรวจต้นทุน → เลือกคำถาม AI สามคำถามที่ต้องตอบให้ได้

Output: source inventory, canonical mapping draft, approved calculation example และ acceptance criteria ที่อ้างอิงข้อมูลร้านจริง

## ข้อมูลเพิ่มเติมสำหรับทิศทาง Agentic Commerce

อัปเดต 17 กันยายน 2026 ตาม [decision register DEC-01–08](29-agentic-commerce-project-plan.md) รายการด้านล่างเป็นสิ่งที่ต้องเก็บก่อน gate ที่เกี่ยวข้อง ไม่ใช่สิ่งที่ผู้ใช้ต้องตอบครบก่อนเริ่ม FIN-AI-01 ด้วยข้อมูลสมมติ

- เจ้าของร้าน/การเงิน: export ปกปิดข้อมูลจริงแยก platform/version, ตัวอย่าง adjustment/refund/หลายรอบโอน และยอดอ้างอิงสำหรับตรวจผล คงหัวคอลัมน์ ชีต ชนิดข้อมูล และ sign/date formats
- ผู้ใช้ทำงานจริง: เวลาตรวจรายการ วิธีมอบหมาย/ปิดงาน นิยาม “ตรวจเสร็จ” และผู้มีสิทธิ์ยืนยัน; ไม่ใช้ task resolved แทนหลักฐานยอดตรง
- Product/Engineering: กำลังทีม งบ hosting/model/support ขอบเขต pilot และข้อกำหนด identity/retention/restore
- Operations ก่อน Stage C: SKU identity, แหล่งความจริงของ stock, opening quantities, timing ตอนจ่าย/แพ็ก/ส่ง/คืน, handling ของไม่พอ และวิธีคิดต้นทุนที่ต้องการ
- Integration ก่อน C/D/E: ร้านและ API scopes ที่อนุญาต, data reuse/consent, provider capabilities, checkout destination และ payment/post-purchase responsibilities

ใช้ร่วมกับ checklist discovery เดิมด้านบน โดยข้อมูลที่รอของ stage ถัดไปไม่เป็นตัวกั้นงาน synthetic ใน Stage B
