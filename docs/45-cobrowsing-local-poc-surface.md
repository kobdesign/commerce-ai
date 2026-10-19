# SUPPORT-01b — Local Co-browsing PoC surface v1.19

วันที่ส่งมอบ: 27 กันยายน 2026
สถานะ: **หน้าทดสอบ local พร้อม · ใช้ข้อมูลสมมติเท่านั้น · ยังไม่เชื่อม vendor SDK**

## ผลลัพธ์

เพิ่มหน้า `/support/poc` สำหรับให้ Product, Support, Security และผู้ใช้ทดลอง flow ก่อนนำ SDK ของผู้ให้บริการเข้าระบบจริง หน้าเปิดได้เฉพาะบทบาท `owner` และแสดงสถานะว่าเป็น synthetic PoC ชัดเจน

Flow ที่ทดลองได้:

1. ลูกค้ากดขอความช่วยเหลือและอ่านขอบเขตการแชร์
2. ระบบสร้างรหัสตัวเลข 6 หลักหลังผู้ใช้ยินยอม
3. Agent Console จำลองปฏิเสธรหัสผิด และเชื่อมต่อเมื่อรหัสตรง
4. Agent เห็นเฉพาะหัวข้อ/รายละเอียดปัญหาและพื้นที่ catalog ที่อนุญาต
5. ข้อมูล PII, การเงิน, หลักฐาน, API key และ OTP ไม่ปรากฏใน agent preview
6. Dynamic modal, ข้อความภาษาไทย และตารางเลื่อนยาวใช้ทดสอบ UI ที่เปลี่ยนหลัง session เริ่ม
7. ผู้ใช้หยุดแชร์ได้ทันที รหัสเดิมถูกล้าง และ session ไม่กลับมาเอง

หน้าแสดงเวลาหมดอายุ 10 นาที, ขอบเขต view-only, policy ที่กำลังจำลอง และ sticky sharing banner ทั้ง desktop/mobile

## Data-classification contract ในหน้า PoC

| Attribute | ความหมาย | Agent preview |
|---|---|---|
| `data-support-share` | พื้นที่ที่ตั้งใจอนุญาตให้แชร์ | แสดงเฉพาะข้อมูลที่หน้า agent สร้างอย่างชัดเจน |
| `data-support-pii` | ข้อมูลระบุตัวบุคคล | ปกปิด |
| `data-support-financial` | บัญชีและมูลค่าทางการเงิน | ปกปิด |
| `data-support-evidence` | ไฟล์/หลักฐานต้นฉบับ | ปกปิด |
| `data-support-secret` | token, API key, OTP และรหัส session | ปกปิด |

การติด attribute นี้เป็น contract สำหรับทดสอบและเตรียม integration เท่านั้น ยังไม่ใช่หลักฐานว่า vendor SDK ปกปิด DOM, network payload, log หรือ export ได้จริง

## ขอบเขตทางเทคนิค

- หน้า server ตรวจ role ก่อน render; local PoC อนุญาตเฉพาะ owner
- session/code/agent console อยู่ใน browser memory และหายเมื่อ reload
- สร้างรหัสด้วย Web Crypto เพื่อจำลอง UX แต่ยังไม่มี server-side hash, rate limit, case assignment หรือ durable audit
- ไม่มี remote desktop, screen capture, recording, agent control, WebSocket หรือข้อมูลที่ส่งออกนอก browser
- ยังไม่ import `@commerce/support` ใน client; control-plane package จะเชื่อมผ่าน server API ใน SUPPORT-02 หลังเลือก vendor และผ่าน production gates

## Verification รอบ v1.19

- Integration tests: **136/136 ผ่าน** รวม 11 application control-plane cases
- Browser E2E: **28/28 ผ่าน** รวม flow desktop และ mobile ของหน้า PoC 2 cases
- E2E ตรวจ consent, รหัสผิด/ถูก, view-only preview, sensitive-value canaries, Thai text, dynamic modal, stop และ horizontal overflow ที่ viewport 390×844
- TypeScript typecheck, ESLint, production build และ whitespace check ผ่าน
- ตรวจภาพและ accessibility snapshot ผ่าน local browser โดยไม่พบ Next.js error overlay

## ขั้นถัดไป

ขอ sandbox/terms ของ Cobrowse.io และ Unblu แล้วเชื่อม candidate ทีละรายบน route นี้ด้วยข้อมูลสมมติ จากนั้นรัน SUP-T01–10 พร้อม network canary, vendor log/export, reconnect, Safari iOS, Chrome Android และ Thai IME จริง ก่อนเสนอ DEC-09 และเริ่ม SUPPORT-02
