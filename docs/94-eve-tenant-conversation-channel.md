# Eve tenant-scoped conversation channel

ช่องสนทนาในหน้า **วิเคราะห์ข้อมูล** เชื่อม Commerce Web บน Render กับ Eve runtime ผ่าน server-side adapter เท่านั้น เบราว์เซอร์ไม่เห็น Eve URL, session signing key หรือ one-time grant

## เส้นทางการทำงาน

1. ผู้ใช้เลือกบริษัทและร้านจาก workspace เดิม
2. `POST /api/tenants/:tenantId/agent-conversations` ขอ create grant จาก Commerce Core สร้าง Eve session และ bind session กลับเข้า Core
3. การส่งคำถามขอ continuation grant ใบแรกสำหรับ message และใบที่สองสำหรับ NDJSON stream เพราะ grant ทุกใบใช้ได้ครั้งเดียว
4. ตัวอ่าน stream รับเฉพาะ reply ที่ผูกกับ `deliveryId` ของคำถามนั้น สรุปชื่อ subagent, เครื่องมืออ่านข้อมูล และ usage โดยไม่ส่ง reasoning ออกไปที่ UI
5. การจบการสนทนาใช้ end intent, Eve receipt และ Core reconciliation เดิม

Cookie สำหรับ login ถูก forward เฉพาะคำขอ same-origin กลับเข้า Commerce Core และไม่ถูกส่งไป Eve

## Safety gate

ช่องสนทนาจะแสดงเมื่อเงื่อนไขทั้งหมดเป็นจริงเท่านั้น:

- `COMMERCE_AGENT_EVE_ENABLED=true`
- `COMMERCE_AGENT_EVE_KILL_SWITCH=false`
- tenant มี dynamic route policy ที่ active, environment ตรงกันและยังไม่หมดอายุ
- มี Eve URL และ Commerce session signing configuration
- `COMMERCE_AGENT_CONVERSATION_ENABLED=true`

Tenant policy จัดการผ่าน [Platform AI Control Center](95-platform-ai-control-center.md) โดยไม่แก้ Environment Variable ราย tenant ค่าเริ่มต้นใน Render Blueprint ยังคงปิด Eve, เปิด kill switch และปิด conversation adapter งานนี้จึงไม่เปิด Live AI หรือเปลี่ยน traffic จริง

## ขอบเขตรอบนี้

- เริ่ม ส่งคำถามต่อเนื่อง รับคำตอบสุดท้าย และจบ session
- จำกัด stream ที่ 55 วินาที, 512 KiB, 1,000 records และ 64 KiB ต่อ record
- แสดงเฉพาะคำตอบ ชื่อ agent/tool และ token/cost summary ที่ provider รายงาน
- ยังไม่เปิด UI สำหรับตอบ approval หรือคำถามแบบ structured interaction; หาก turn รอ input หน้าจอจะแจ้งว่าต้องยืนยันเพิ่มเติม
