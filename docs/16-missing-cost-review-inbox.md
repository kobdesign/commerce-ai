# รายการที่ต้องตรวจและต้นทุนย้อนหลัง — v0.5

## Flow ที่ใช้งานได้

เมื่อรายการขายที่ยืนยันนำเข้าแล้วไม่พบต้นทุนซึ่งมีผลในวันที่ขาย ระบบจะส่งรายการนั้นไปที่ **รายการที่ต้องตรวจ** โดยไม่แทนต้นทุนด้วยศูนย์

1. owner, finance และ auditor เปิดรายการค้างตรวจของร้านที่ตนมีสิทธิ์ได้
2. ระบบแสดงคำสั่งซื้อ, SKU, วันที่ขาย, จำนวน, เงินรับสุทธิ และลิงก์กลับไปร่างต้นทาง
3. หากภายหลังแค็ตตาล็อกมีต้นทุน ระบบแสดงต้นทุนปัจจุบันเป็นค่าแนะนำ แต่ไม่ยืนยันให้อัตโนมัติ
4. owner หรือ finance ระบุต้นทุนต่อหน่วยและเหตุผล แล้วกด **ยืนยันต้นทุน**
5. ระบบสร้าง calculation version ใหม่ รายการหายจาก inbox และหน้าสรุปคำนวณต้นทุน/ส่วนต่างใหม่
6. auditor เปิดดู inbox ได้ แต่เปลี่ยนข้อมูลไม่ได้

## กติกาข้อมูล

- `sales_lines` ยังเป็นข้อมูลนำเข้าแบบ append-only ค่า `unit_cost_minor` เดิมไม่ถูกแก้ แม้ยืนยันต้นทุนย้อนหลังแล้ว
- `sales_line_calculations` เก็บ calculation version แยกต่อรายการขาย รุ่นแรกมาจาก import และรุ่นถัดมามาจากการยืนยันของผู้ใช้
- เหตุผลสำหรับการยืนยันย้อนหลังต้องมี 3–500 ตัวอักษร และบันทึกผู้ดำเนินการกับเวลา
- ต้นทุน 0 บาทเป็นค่าที่ทราบแล้วและคำนวณได้ ต่างจาก `null` ซึ่งหมายถึงข้อมูลยังขาด
- การยืนยันพร้อมกันใช้ transaction advisory lock และ expected version รายการเดียวจึงสร้าง manual version ได้เพียงครั้งเดียว คำขอที่มาช้ากว่าได้รับ `STALE_REVIEW`
- หน้าสรุปอ่าน calculation version ล่าสุด แต่ยังแสดงหลักฐานกลับไปยังร่างนำเข้าเดิม
- Audit event `sales_line.cost_resolved` เก็บ shop, order, version และ basis โดยไม่แก้ event ก่อนหน้า

## สิทธิ์และการแยกข้อมูล

Migration 0006 เพิ่ม composite foreign key, FORCE RLS และ index `(tenant_id, sales_line_id, version desc)` สำหรับ lookup รุ่นล่าสุด

- owner/finance อ่านและเพิ่ม calculation version ได้
- auditor อ่านได้อย่างเดียว
- marketing/operator มองไม่เห็นข้อมูลการเงินผ่าน domain function หรือ direct SQL runtime
- policy ตรวจ tenant, membership, shop grant, actor และ sales line ที่เกี่ยวข้องอีกครั้ง
- runtime role ไม่มี UPDATE/DELETE grant บน calculation history
- API ตรวจ session, tenant, Origin, JSON size และ Zod schema ทุกครั้ง

## ขอบเขต

รุ่นนี้แก้เฉพาะ imported line ที่ยังไม่มีต้นทุน การแก้ต้นทุนที่ยืนยันแล้ว, reversal, refund, settlement reconciliation และการจัดสรรค่าโฆษณายังต้องออกแบบ workflow แยกเพื่อรักษาประวัติทางบัญชี

## ผลตรวจ

- Typecheck, lint และ production build ผ่าน
- Integration 45 tests ผ่าน รวม manual resolution, original fact preservation, zero cost, concurrent resolution, stale version, known-cost rejection, RLS ข้าม tenant/role และ immutable history
- Browser 14 tests ผ่าน รวม flow มือถือ 390px จากนำเข้าแถวที่ไม่มีต้นทุน → เปิด inbox → ยืนยันต้นทุน 200 บาท → คำนวณส่วนต่าง 300 บาทจากเงินรับ 500 บาท
- Visual browser check ผ่าน: หน้าไม่ว่าง, ไม่มี Next.js error overlay, ไม่มี console error และไม่มี page-level horizontal overflow

ข้อมูลทดสอบทั้งหมดเป็น synthetic และยังไม่รับรองความหมายของรายงาน marketplace จริง
