# Business Logic Verification — 2026-09-16

## User story ที่ตรวจ

เจ้าของร้านนำเข้า CSV → จับคู่และตรวจข้อมูล → ยืนยันความหมายของเงินรับ → API ตรวจสิทธิ์ → PostgreSQL บันทึก batch/รายการแบบ append-only → เลือกต้นทุนตามวันที่ขาย → คำนวณส่วนต่าง → แสดงผลตาม SKU/คำสั่งซื้อพร้อมหลักฐานย้อนกลับ

## ผลตรวจตามขอบเขตระบบปัจจุบัน

| Business rule | ผล | หลักฐานที่ตรวจ |
|---|---|---|
| เงินใช้ integer minor units | ผ่าน | 319.00 บาทเก็บเป็น 31,900 สตางค์ ไม่มี floating-point rounding |
| ค่าธรรมเนียมไม่ถูกหักซ้ำ | ผ่าน | เงินรับ 319 − ต้นทุน 180 = ส่วนต่าง 139 แม้มี fee 80 เป็นหลักฐาน |
| ออเดอร์หลาย SKU รวมยอด | ผ่าน | 2 lines: เงินรับ 170, ต้นทุน 200, ส่วนต่าง -30 |
| ค่าธรรมเนียมมีข้อมูลบาง line | ผ่าน | fee total 10 พร้อม coverage 1/2 ไม่อ้างว่าครบ |
| ต้นทุน 0 ต่างจากต้นทุนหาย | ผ่าน | cost 0 คำนวณส่วนต่างได้; cost null ทำให้ contribution null |
| ส่วนต่างติดลบ | ผ่าน | แสดง -30 โดยไม่ clamp เป็นศูนย์ |
| Cost version ตามวันที่ขาย | ผ่าน | ขาย 5 ม.ค. ใช้ต้นทุน 100; ขาย 15 ม.ค. ใช้ต้นทุน 200 |
| แก้ต้นทุนภายหลังไม่เปลี่ยนอดีต | ผ่าน | snapshot 180 ยังอยู่หลัง current cost เปลี่ยนเป็น 200 |
| ร่างมีแถวผิด | ผ่าน | commit ถูกปฏิเสธและไม่สร้าง batch |
| แถวเหมือนกันทั้งแถว | ผ่าน | commit ถูกปฏิเสธจนกว่าจะนำแถวซ้ำออก |
| ยืนยันร่างเดิมพร้อมกัน | ผ่าน | ได้ batch เดียวและ audit event เดียว |
| สิทธิ์บทบาท | ผ่าน | owner/finance เขียน, auditor อ่านอย่างเดียว, marketing/operator ไม่เห็นข้อมูลการเงิน |
| Tenant/shop isolation | ผ่าน | ID ต่าง tenant/shop ถูกปฏิเสธและ RLS ไม่คืนแถว |
| ข้อมูลที่ยืนยันแล้ว immutable | ผ่าน | runtime UPDATE/DELETE sales lines ถูก PostgreSQL ปฏิเสธ |
| หลักฐานย้อนกลับ | ผ่าน | คำสั่งซื้อเปิดกลับไปยังร่างต้นทางที่ยืนยันแล้วได้ |

## หลักฐานทางเทคนิค

- Integration: 42 tests ผ่านใน PostgreSQL database ชั่วคราวแยกจากข้อมูลแอป
- Browser regression: ชุดเต็ม 13 tests ผ่าน; flow การเงินถูก rerun แยกอีก 1 test ผ่านบน viewport 390px
- Browser visual check: หน้าไม่ว่าง, ไม่มี Next.js error overlay, ไม่มี console/runtime error, ไม่มี page-level horizontal overflow และพบ evidence links
- Typecheck, lint และ production build ผ่านจาก build เดียวกับแอปที่ตรวจ

ภาพตรวจล่าสุด: `artifacts/business-logic-verification.png`

## Business logic ที่ยังยืนยันไม่ได้

- ชื่อและความหมายคอลัมน์จริงของ TikTok, Shopee และ Lazada เพราะยังไม่มีไฟล์ export จริงที่ผู้ใช้อนุญาต
- Refund/cancellation, fee rebate, affiliate, shipping adjustments, settlement/payout, bank receipt, ads และค่าใช้จ่ายบริษัท
- ป้องกัน business row ซ้ำข้ามไฟล์ที่ byte/mapping เปลี่ยนไป ต้องมี source event หรือ line ID จากแพลตฟอร์ม
- ลำดับต้นทุนภายในวันเดียว เพราะไฟล์กลางมีเพียงวันที่ ไม่มีเวลาขาย
- กำไรสุทธิและการบัญชี ตัวเลขปัจจุบันเป็นส่วนต่างเบื้องต้น `เงินรับสุทธิ − ต้นทุนสินค้า`

ดังนั้นผล “ผ่าน” หมายถึง logic ของ vertical slice v0.4 ทำงานตรงตามนิยามที่เขียนไว้ ไม่ใช่การรับรองสูตร marketplace หรือกำไรจริงของร้าน
