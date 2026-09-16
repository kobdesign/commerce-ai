# Product model สำหรับสินค้าหลายประเภท

สถานะ: ข้อกำหนดและแบบที่จะพัฒนา ไม่ใช่ความสามารถของแอปที่เปิดใช้แล้ว

## ขอบเขต

กางเกงใช้เป็น pilot เพื่อให้เข้าถึงงานจริง แกนผลิตภัณฑ์เป็น commerce operations สำหรับหลายหมวด ภายใน tenant เดียวมีสินค้าหลายหมวดได้ โดยไม่ต้องสร้าง tenant ต่อหมวดสินค้า

แยก business core (orders, costs, fees, settlement, evidence, AI tools) จาก category capabilities เช่น size advice, expiry หรือ warranty การเพิ่มหมวดที่ใช้พฤติกรรมเดิมควรเป็นการตั้งค่าข้อมูลและ attributes; การเพิ่มพฤติกรรมใหม่ต้องมี implementation และ acceptance tests

## โมเดลกลาง

| ส่วน | หน้าที่ | ตัวอย่าง |
|---|---|---|
| Product | สินค้าหรือรุ่นหลัก | กางเกงรุ่น A, เซรั่มรุ่น B, แก้วรุ่น C |
| ProductVariant | SKU/หน่วยขายที่อ้างต้นทุนได้ | เอว 32 สีดำ, เซรั่ม 30 ml, default SKU ของแก้ว |
| AttributeDefinition/Value | คุณสมบัติที่กำหนดชนิดข้อมูลและหน่วย | สี ไซซ์ กลิ่น สูตร ความจุ วัสดุ |
| Sales unit | หน่วยของจำนวนที่สั่ง | ตัว ชิ้น ขวด แพ็ก |
| Channel listing/SKU mapping | รหัสภายนอกและตัวเลือกของแต่ละร้าน | SKU เดียวกันมีรหัสต่างกันในแต่ละช่องทาง |
| CategoryMapping | หมวดภายในกับหมวดของช่องทาง | internal category ไม่ใช้แทน marketplace fee category โดยอัตโนมัติ |
| CostVersion | ต้นทุนต่อหน่วยขายพร้อมวันที่มีผล | บาทต่อขวด/ต่อ SKU แพ็ก; ไม่ปะปนกับความจุ |

สินค้าไม่มีตัวเลือกมี default variant เพื่อให้ order lines และต้นทุนใช้โครงสร้างเดียว สี/ไซซ์ไม่เป็น required field ของทุกสินค้า

Attributes ต้องมี schema และ validation ไม่ใช่ JSON อิสระทั้งหมด จำนวนเงิน สกุลเงิน จำนวนซื้อ หน่วย ต้นทุน ตัวระบุ tenant และสิทธิ์เป็นข้อมูลโครงสร้างที่ตรวจเข้มงวด

Core schema เผื่อความแม่นยำของ quantity และหน่วย แต่ MVP เปิดเฉพาะจำนวนเต็มบวกสำหรับสินค้าขายเป็นหน่วยนับ การเปิดขายตามน้ำหนัก/ปริมาตรต้องเพิ่ม conversion, decimal rules และ rounding tests ก่อน ห้ามรับแล้วคำนวณด้วยหน่วยผิด

แพ็กหรือชุดที่มี SKU และต้นทุนรวมชัดเจนคำนวณเป็นหน่วยขายหนึ่งรายการได้ใน MVP แต่ยังไม่แตกส่วนประกอบเพื่อจัดสต็อกหรือจัดสรรกำไร/คืนสินค้ารายชิ้น

## ระดับการรองรับตามแผน

| กลุ่ม | MVP core ที่ตั้งใจรองรับ | ความสามารถเพิ่มเติมที่ยังต้องพัฒนา |
|---|---|---|
| เสื้อผ้า/รองเท้า | SKU และ attributes, รายได้/ต้นทุน/เงินรับ | fit recommendation, size-based replenishment |
| ของใช้/ของตกแต่ง/เครื่องเขียน | มีและไม่มี variants, หน่วยนับ, กำไร | assembly หรือ warehouse processes เฉพาะ |
| สกินแคร์/เครื่องสำอาง | ขวด/ชิ้น, สูตร/ความจุเป็น attributes, กำไรจากต้นทุนที่มี | lot/expiry, traceability |
| อาหารบรรจุแพ็ก | SKU/แพ็กและต้นทุนรวม, กำไร | expiry, spoilage, cold-chain, recipe costing |
| อิเล็กทรอนิกส์ | รุ่น/ความจุ/สีและกำไร | serial tracking, warranty/RMA |
| สินค้าชั่งตวง | ยังไม่รับรอง workflow ใน MVP | fractional quantity, unit conversion, actual weight costing |
| ชุดสินค้าที่แตกส่วนประกอบ | รับแบบ opaque SKU เมื่อต้นทุนรวมมีหลักฐาน | component allocation, stock deduction, partial bundle return |
| ดิจิทัล/บริการ/สมาชิก | extension point เท่านั้น | delivery/entitlement, booking, recurring billing และ revenue rules |

การคำนวณเงินเหลือจากรายงานได้ ไม่เท่ากับมีระบบปฏิบัติการเฉพาะหมวดครบ เช่น นำยอดขายอาหารมาคำนวณได้ยังไม่แปลว่าติดตามวันหมดอายุได้

## ค่าธรรมเนียมและ AI

- ใช้ค่าธรรมเนียมที่หักจริงและ lineage เป็นหลัก การจำลองใช้ rule ที่มี shop/channel/category/effective date และแสดงว่าเป็นประมาณการ
- ถ้าไม่รู้หมวดค่าธรรมเนียมหรือ rule ต้องให้ตรวจ ไม่ใช้เรตเสื้อผ้าเป็นค่าเริ่มต้นที่ซ่อนอยู่
- Prompt/เครื่องมือหลักไม่ hardcode ว่าสินค้าคือกางเกง อ่าน metadata ที่ได้รับอนุญาตและ capabilities ที่ระบบเปิดจริง
- category profile ใช้ข้อมูล/กฎที่ตรวจสอบ ไม่ให้นำ instructions จากไฟล์สินค้ามาเพิ่ม tool permissions
- AI ไม่เดาวันหมดอายุ สรรพคุณ หรือการรับประกันจากชื่อหมวด

## Acceptance และ backlog

เพิ่ม CAT-01 ใน backlog เป็น dependency ของ SKU/cost mapping และ CAT-T01 ถึง CAT-T06 ใน verification พร้อม FIN-T05 ที่เป็นสินค้านอกหมวดเสื้อผ้า

ก่อนกล่าวว่าใช้ได้กับหมวดใหม่ใน production ต้องทดสอบข้อมูลจริงของหมวดนั้นและ adapter ที่ใช้ ไม่ถือว่า synthetic fixtures เพียงอย่างเดียวยืนยัน compatibility กับทุกแพลตฟอร์ม
