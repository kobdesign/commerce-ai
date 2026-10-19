# หลักฐานไฟล์ต้นฉบับของการนำเข้า — v1.1

วันที่ตรวจ: 17 กันยายน 2026

## ปัญหาที่แก้

ร่างนำเข้ารุ่นก่อนเก็บเฉพาะผลตรวจ การจับคู่คอลัมน์ และ SHA-256 ผู้ใช้จึงตามตัวเลขกลับไปยังเนื้อหาไฟล์ต้นฉบับในระบบไม่ได้ รุ่นนี้เก็บ CSV ต้นฉบับเมื่อบันทึกร่างและผูกหลักฐานนั้นกับ draft และ batch เดิม

## Flow ที่ใช้งานได้

1. Owner หรือ Finance เลือก CSV UTF-8 ขนาดไม่เกิน 1 MB
2. ระบบตรวจชนิด ขนาด encoding, schema, จำนวนแถว และ mapping เหมือนเดิม
3. เมื่อกด **บันทึกร่างเพื่อตรวจ** ระบบเก็บไฟล์ต้นฉบับพร้อม SHA-256, ขนาด, ตัวคั่น, adapter และ schema version
4. หน้าร่างแสดงสถานะ **เก็บไฟล์ต้นฉบับแล้ว**, checksum แบบย่อ และปุ่มดาวน์โหลด
5. ประวัติร่างแสดงว่ารายการใดมีไฟล์ต้นฉบับ รายการเก่าก่อน migration แสดง **ร่างเดิมไม่มีไฟล์**
6. Owner, Finance และ Auditor ที่มีสิทธิ์ร้านดาวน์โหลดไฟล์ได้ ทุกการดาวน์โหลดสร้าง audit event

## โครงสร้างและความปลอดภัย

- `app.import_sources` แยกหลักฐานตาม tenant และ shop ด้วย RLS
- runtime role มีเฉพาะ `SELECT` และ `INSERT`; ไม่มีสิทธิ์ `UPDATE` หรือ `DELETE`
- เนื้อหาและ `byte_size` ถูกตรวจด้วย constraint และจำกัดสูงสุด 1,048,576 bytes
- ไฟล์เนื้อหาเดียวกันในร้านเดียวกันใช้แถวหลักฐานร่วมกันตาม SHA-256 แต่สร้างร่างใหม่ได้เมื่อ mapping ต่างกัน
- download route ตรวจ session, tenant, shop grant และ role ใหม่ทุก request
- response บังคับดาวน์โหลด ตั้ง `no-store`, `nosniff`, `Content-Length`, `ETag` และ `X-Content-SHA256`
- ชื่อไฟล์ใน `Content-Disposition` ถูก sanitize และรองรับ UTF-8
- การอ่านไฟล์ไม่ส่งข้อมูลไปยังโมเดล AI

## UX

หน้าจอใช้ข้อความ **รูปแบบรายการขาย v1** แทนชื่อ schema ภายใน แสดง checksum เป็นหลักฐานรองโดยไม่แย่งความสำคัญจากจำนวนรายการและปัญหาที่ต้องแก้ ปุ่มดาวน์โหลดสูง 44 px บนเดสก์ท็อปและมือถือ

ตรวจที่ 390 × 844 px และเดสก์ท็อปแล้ว:

- ไม่พบ page-level horizontal overflow
- แถบหลักฐานเรียงหนึ่งคอลัมน์บนมือถือ
- ปุ่มดาวน์โหลดกว้างเต็มแถบและอยู่ก่อนผลตรวจรายการ
- ร่างเดิมไม่มีปุ่มดาวน์โหลดที่ใช้งานไม่ได้
- ไม่พบ browser error หรือ Next.js error overlay

## ผลตรวจ

- TypeScript, ESLint, migration และ production build ผ่าน
- Integration tests **60/60** ผ่าน รวม checksum, exact content, deduplication, tenant isolation, role access, audit และ append-only grants
- Browser tests **18/18** ผ่าน โดยดาวน์โหลดไฟล์ผ่าน UI และเทียบเนื้อหากับไฟล์ที่อัปโหลด
- production route `/api/tenants/[tenantId]/imports/[draftId]/source` อยู่ใน build output

## ขอบเขตที่ยังไม่รับรอง

- storage รุ่นนี้ใช้ PostgreSQL `bytea` สำหรับไฟล์ CSV ขนาดเล็กใน local/staging เพื่อให้ transaction และ RLS ตรวจรับได้ครบ
- ก่อนรับข้อมูลจริงหลายร้าน ต้องย้าย content ไป private S3-compatible object storage ผ่าน storage adapter โดยคง metadata, checksum และ permission check ในฐานข้อมูล
- ยังไม่มี retention/deletion policy, malware scanning, customer export, legal hold หรือ backup/restore rehearsal สำหรับไฟล์
- รองรับเฉพาะ CSV UTF-8 ขนาดไม่เกิน 1 MB ยังไม่ใช่ marketplace API หรือ statement adapter อย่างเป็นทางการ
- ไฟล์อาจมีข้อมูลส่วนบุคคล ห้ามนำข้อมูลลูกค้าจริงเข้า staging จนกว่าจะยืนยัน data lifecycle และสิทธิ์เข้าถึง
