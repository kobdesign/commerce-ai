# TikTok Shop Seller Authorization — read-only foundation

สถานะ: **โค้ดพร้อม · ยังไม่ใส่ credential จริง · ยังไม่อ่าน Order API**

วันที่ปรับปรุง: 2026-10-22

## ผลลัพธ์รอบนี้

เพิ่มจุดเริ่มต้นสำหรับเชื่อม TikTok Shop จริงโดยไม่ผูก core commerce กับ schema ของผู้ให้บริการ:

- หน้า `เชื่อมช่องทางขาย` แยกตาม tenant และร้านที่เลือก
- Seller authorization เริ่มจาก URL ที่คัดลอกจาก TikTok Shop Partner Center และเพิ่ม OAuth `state` ที่ลงลายเซ็น อายุ 10 นาที
- callback แลก authorization code ที่ token endpoint ทางการและรับเฉพาะ seller token (`user_type=0`)
- access/refresh token เข้ารหัส AES-256-GCM ก่อนบันทึกใน `private.marketplace_connection_credentials`
- metadata ที่ผู้ใช้ดูได้อยู่ใน `app.marketplace_connections` ภายใต้ RLS; UI/API ไม่คืน ciphertext
- เฉพาะ Owner เชื่อม/ให้สิทธิ์ใหม่ได้ และเชื่อมได้เฉพาะ workspace ร้าน TikTok
- Staging จำกัดเป็น TikTok Development Shop; live merchant authorization ต้องใช้ production identity/runtime ที่ผ่าน readiness gate
- ยังเป็น read-only boundary ไม่มีการเปลี่ยน stock, ราคา, fulfillment หรือข้อมูลใน TikTok Shop

## ค่าที่ต้องตั้งใน Render Web Service

| Key | วิธีได้ค่า |
|---|---|
| `TIKTOK_SHOP_ENVIRONMENT=development` | ใช้กับ Staging และ Development Shop |
| `TIKTOK_SHOP_APP_KEY` | App & Service ใน Partner Center |
| `TIKTOK_SHOP_APP_SECRET` | App & Service; ใส่เป็น secret เท่านั้น |
| `TIKTOK_SHOP_SELLER_AUTH_URL` | คัดลอก Seller authorization link ทั้งเส้น ต้องมี `service_id` |
| `TIKTOK_SHOP_OAUTH_STATE_SECRET` | random secret อย่างน้อย 32 ตัวอักษร |
| `TIKTOK_SHOP_TOKEN_ENCRYPTION_KEY` | random 32 bytes แล้วเข้ารหัส base64 |

ตั้ง Redirect URL ใน Partner Center เป็น:

`https://commerce-ai-staging-web.onrender.com/api/connectors/tiktok/callback`

ห้ามส่ง App Secret, access token, refresh token หรือ encryption key ผ่านแชต/issue/commit ให้ใส่ตรง Render Secret Environment Variables เท่านั้น

## Scope รอบแรก

ขอ scope ต่ำสุดสำหรับตรวจร้านและอ่านออเดอร์:

- Shop Authorized Information (`seller.authorization.info`)
- Order Information (`seller.order.info`)

ชื่อ scope และสิทธิ์ที่บัญชีมองเห็นต้องยืนยันอีกครั้งใน Manage API ของแอปนั้น เพราะ TikTok อาจจำกัดตามประเภทแอป ตลาด และสถานะ review

## เกณฑ์ที่ผ่านแล้ว

- OAuth state ปฏิเสธการแก้ไขและหมดอายุอัตโนมัติ
- token exchange ปฏิเสธ token ที่ไม่ใช่ seller
- token ciphertext ใช้ authenticated encryption และไม่ปรากฏใน workspace response
- Owner/RLS/shop-channel boundary ผ่าน integration tests
- test ทั้งระบบ 31 ไฟล์ 210 cases และ production build ผ่าน

## งานถัดไปหลังมี TikTok Development Shop access

1. เรียก Get Authorized Shops ด้วย request signing ทางการ แล้วผูก `shop_cipher` กับร้านในระบบโดยให้ Owner ยืนยัน
2. ดึง Order List/Detail แบบ read-only เข้า shadow model และเทียบกับ Seller Center โดยไม่ reserve stock
3. รับ Order Status webhook ด้วย signature/replay contract ของ TikTok จริงและส่ง safe canonical event เข้า Integration Inbox
4. วัด freshness, duplicate, missing event, rate limit และ token refresh ก่อนเปิด reservation จาก event
5. พิจารณา inventory writeback หลัง DEC-06/UAT เท่านั้น

เอกสารอ้างอิงทางการ: [Create your app](https://partner.tiktokshop.com/docv2/page/64f198e74830a5028854bf8f), [Common parameters](https://partner.tiktokshop.com/docv2/page/common-parameters), [Order API overview](https://partner.tiktokshop.com/docv2/page/order-api-overview)
