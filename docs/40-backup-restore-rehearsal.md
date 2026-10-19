# Product workflow v1.14 — PostgreSQL backup/restore rehearsal

วันที่: 27 กันยายน 2026 · งาน: REL-AG-01c

## ผลลัพธ์

เพิ่ม `npm run db:rehearse-restore` สำหรับซ้อมกู้คืนฐานข้อมูล local แบบครบวงจร:

1. บังคับ `APP_MODE=local-demo`, loopback PostgreSQL และปฏิเสธ system/restore database เป็น source
2. สร้าง PostgreSQL custom-format dump ด้วยเครื่องมือ PostgreSQL 17 ภายใน Docker database container
3. สร้าง database ชั่วคราวด้วยชื่อสุ่มและ restore แบบ `--exit-on-error`
4. เปรียบเทียบ migration checksums, จำนวนข้อมูลใน 17 ตารางหลัก, RLS flags และ evidence manifest
5. คำนวณ SHA-256 ของ evidence content หลัง restore ทุก object
6. เชื่อมด้วย `commerce_app`, `commerce_identity`, `commerce_queue` และตรวจว่าไม่ใช่ superuser/BYPASSRLS พร้อมสิทธิ์ขั้นต่ำที่ต้องใช้
7. เขียนรายงานที่ไม่มี credential/raw content แล้วลบ database ชั่วคราวกับ dump ใน `finally`

รายงานล่าสุด: [restore-rehearsal-latest.json](evidence/restore-rehearsal-latest.json)

## ผลการซ้อม local วันที่ 27 กันยายน 2026

| รายการ | ผล |
|---|---:|
| สถานะ | ผ่าน |
| Dump size | 661,498 bytes |
| Dump | 303 ms |
| Restore | 931 ms |
| Verify | 59 ms |
| Observed recovery (restore + verify) | 990 ms |
| Evidence objects | 142 → 142 |
| Corrupt evidence | 0 |
| Manifest / migrations / RLS | ตรงทั้งหมด |
| Runtime roles | 3/3 ผ่าน |
| Temporary restore databases หลังจบ | 0 |

ตัวเลขเวลาเป็นผล local dataset รอบเดียว ไม่ใช่ production RTO และไม่ได้วัด RPO

## สิ่งที่พบระหว่าง rehearsal

รอบแรกที่ใช้ `--no-owner` กู้ข้อมูลได้แต่ schema `jobs` เปลี่ยนเจ้าของเป็น `postgres` ทำให้ `commerce_queue` ไม่มีสิทธิ์ใช้งาน เครื่องมือจึงเปลี่ยนมารักษา ownership/ACL และตรวจ runtime roles หลัง restore ทุกครั้ง

ข้อกำหนดที่ตามมา: target cluster ต้อง provision roles ที่ระบบใช้ก่อน restore และ recovery runbook ต้องไม่ตัด ownership/ACL โดยไม่มีขั้นตอน grant ทดแทน การตรวจเพียงจำนวนแถวหรือ health ของ superuser ไม่เพียงพอ

## ขอบเขตความปลอดภัย

- เครื่องมือไม่รับ hostname นอก loopback และไม่รันเมื่อ APP_MODE ไม่ใช่ local-demo
- เรียก subprocess ด้วย argument array ไม่มี shell interpolation และไม่พิมพ์ connection strings/password
- Dump ใช้ไฟล์ชั่วคราว permission `0600`; report ใช้ `0600` และไม่มี raw file/customer values
- Cleanup ทำแม้ verification ล้มเหลว และตรวจยืนยันแล้วว่าไม่มี `commerce_restore_*` เหลืออยู่

## ข้อจำกัดและงานต่อไป

- ยังไม่ได้ทดสอบ Render managed backup, point-in-time recovery, region failure หรือ cluster ใหม่ที่ไม่มี roles
- ไม่มี production backup schedule, encryption/retention, offsite copy, owner, RPO/RTO หรือ alert ที่อนุมัติ
- ตารางอาจมีการเขียนระหว่าง dump ใน production; custom dump ให้ consistent database snapshot แต่ external object storage ในอนาคตต้องมี manifest/version ที่สัมพันธ์กับ database backup แยก
- ก่อน pilot จริงต้องซ้อมใน staging ตาม provider runbook และบันทึก incident owner/communication/rollback decision
- งานถัดไปที่ทำได้ใน repo คือ REL-AG-01d: production configuration gates และ incident runbook โดยยังไม่อ้างว่า production-ready
