# Production dependency decision pack — v1.17

วันที่ทบทวนข้อมูลผู้ให้บริการ: 27 กันยายน 2026
ขอบเขต: REL-AG-01f · DEC-03 / DEC-04 / Alert ownership
สถานะ: **ข้อเสนอเพื่ออนุมัติ — production ยัง NO-GO**

## ข้อเสนอสำหรับผู้บริหาร

| Decision | Recommendation | เหตุผลหลัก | ผู้อนุมัติที่ต้องมี |
|---|---|---|---|
| Production identity | WorkOS AuthKit; application DB เป็น authorization source | Organization/membership, MFA, SSO/SCIM และ staging/production แยกชัด โดยไม่ต้องสร้าง identity security เอง | Product, Engineering, Security/Privacy |
| Evidence storage | AWS S3 `ap-southeast-1`, Block Public Access, SSE-KMS, versioning; Object Lock หลังอนุมัติ retention | ระบุ region ได้ชัด, policy/IAM/KMS mature และต่อกับ storage adapter เดิมได้ | Engineering, Security/Privacy |
| Retention | Versioned policy ต่อ data class/tenant; pilot baseline ที่เสนอด้านล่าง พร้อม legal hold | ลบตามอายุได้โดยไม่ใช้กฎเดียวกับข้อมูลทุกชนิด และยังตรวจย้อนหลังได้ | Business, Finance, Privacy/Legal |
| Backup/recovery | Render paid PITR + logical backup รายวันไป S3 คนละ credential/account boundary | กู้เร็วจาก PITR และไม่พึ่งสำเนาของ provider เดียวทั้งหมด | Business, Engineering |
| Monitoring/on-call | Better Stack ตรวจจากภายนอก; Primary Engineering, Backup Business Operations | จับ Render outage จากภายนอก มี escalation/on-call และเริ่มเล็กได้ | Business, Engineering, Support |
| Live AI | OpenAI API ผ่าน project แยก, data-minimized typed tools, ZDR preferred; budget deny-by-default | เข้ากับ AI SDK เดิมและรักษา evidence boundary; เปิดเฉพาะ tenant/workflow ที่อนุมัติ | Product, Finance, Security/Privacy |

คำแนะนำนี้ไม่อนุมัติการซื้อบริการ ไม่สร้าง production resource และไม่เปลี่ยน preflight ให้ผ่าน การอนุมัติ provider เป็นเพียงเงื่อนไขก่อน implementation, security review และ staging rehearsal

## 1. Production identity — WorkOS AuthKit

### เหตุผลที่เลือก

- Organizations และ memberships ตรงกับ tenant/workspace model ปัจจุบัน ผู้ใช้หนึ่งคนอยู่ได้หลายองค์กร
- รองรับ hosted authentication, MFA, SAML/OIDC SSO, Directory Sync/SCIM, JIT provisioning, RBAC และ Admin Portal
- มี staging environment ฟรีสำหรับ integration test และ production redirect ต้องเป็น HTTPS
- ราคา ณ วันที่ทบทวน: AuthKit ฟรีถึง 1 ล้าน users ตามหน้า pricing; SSO และ Directory Sync คิดแยก connection ละ **USD 125/เดือน** ในช่วง 1–15 connections การเปิด production ต้องเพิ่ม billing information ราคาต้องตรวจใหม่ก่อนซื้อ

แหล่งข้อมูล: [WorkOS pricing](https://workos.com/pricing), [users and organizations](https://workos.com/docs/authkit/users-organizations), [roles and permissions](https://workos.com/docs/authkit/roles-and-permissions), [staging vs production](https://workos.com/docs/authkit/environments)

### ขอบเขตสถาปัตยกรรม

WorkOS พิสูจน์ตัวตนและ lifecycle ของ identity ส่วนระบบเรายังคงตัดสินสิทธิ์จาก `memberships`, shop grants, RLS และ server policy ห้ามเชื่อ provider role แล้วข้าม application authorization

เส้นทาง migration ที่เสนอ:

1. เพิ่ม identity adapter และ mapping `provider + external_subject → private.users.id`
2. เก็บ WorkOS organization external ID บน tenant โดยมี uniqueness และ audit
3. รองรับ session validation/refresh/revocation ผ่าน adapter; demo password adapter ใช้เฉพาะ local/staging synthetic
4. sync invitation/membership ด้วย signed idempotent webhooks และ reconciliation job
5. shadow-verify บัญชี pilot ก่อน cutover; membership เดิมและ RLS ไม่ถูกลบ
6. เปิด SSO/SCIM ต่อ enterprise tenant ผ่าน feature/capability policy และทดสอบ deprovisioning/revocation

Alternatives:

- Auth0 มี Organizations, enterprise connections และ SCIM แต่ pricing/feature tiers สำหรับ B2B มีหลายระดับและบางความสามารถอยู่ enterprise plan ดู [Auth0 pricing](https://auth0.com/pricing)
- Supabase Auth รองรับ multi-tenant SAML และคิด SSO MAU แต่โครงการนี้ต้องเพิ่ม provider/database stack ใหม่ และ Directory lifecycle ยังต้องออกแบบเพิ่ม ดู [Supabase SAML SSO](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml)
- Demo identity ปัจจุบันไม่ผ่าน production เพราะไม่มี invitation, MFA/SSO, provider audit และ lifecycle ที่ตรวจรับแล้ว

## 2. Private evidence storage — AWS S3 Singapore

### Configuration baseline

- Region `ap-southeast-1` ให้ใกล้ Render Singapore; tenant ที่มีข้อกำหนด residency อื่นต้องผ่าน routing/contract review ก่อน
- S3 Block Public Access ทั้ง account/bucket, Object Ownership แบบไม่ใช้ ACL และ least-privilege IAM
- SSE-KMS ด้วย customer-managed key แยก production/staging พร้อม rotation/access audit
- Versioning และ checksum metadata; application อ่านผ่าน server authorization ไม่มี public object URL
- Object key ไม่ใส่ filename/PII และคง tenant/shop scope ที่ registry ตรวจได้
- Object Lock governance/legal hold เปิดเมื่อ retention matrix ได้รับอนุมัติแล้ว เพราะ lock ที่ยาวเกิน policy ขัดกับการลบตามวัตถุประสงค์

AWS ระบุ Singapore endpoint `ap-southeast-1`; S3 security guidance แนะนำ Block Public Access และ SSE-KMS/SSE-S3 ส่วน Object Lock ใช้ WORM, retention และ legal hold และต้องทำงานกับ versioning ดู [AWS regions/endpoints](https://docs.aws.amazon.com/general/latest/gr/s3.html), [S3 security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html), [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

Cloudflare R2 เป็น alternative ที่ประหยัด egress แต่ APAC location hint เป็น best effort และ jurisdiction ที่รับประกันในเอกสารปัจจุบันไม่มี Thailand/APAC จึงยังไม่ใช่ค่าเริ่มต้นสำหรับสัญญาที่ระบุ region ดู [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/) และ [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

### Migration โดยไม่เขียนระบบใหม่

1. เพิ่ม `s3-v1` หลัง `@commerce/storage` interface ปัจจุบัน
2. dual-write PostgreSQL inline + S3 และเทียบ SHA-256/byte size
3. read S3 ก่อน พร้อม fallback legacy ที่วัดได้
4. backfill ทีละ batch และตรวจ manifest/checksum
5. ซ้อม app rollback และ restore metadata + objects
6. หยุด legacy write แล้ว contract bytea หลัง retention/restore evidence ผ่าน

## 3. Retention และ deletion policy

ข้อเสนอ pilot นี้ต้องให้ Finance และ Privacy/Legal ยืนยันก่อนใส่ `retain_until` หรือเปิด automatic deletion:

| Data class | Baseline ที่เสนอ | Disposal control |
|---|---:|---|
| Raw marketplace/bank evidence | 400 วัน | ลบ object + registry lifecycle event เมื่อไม่มี legal hold |
| Derived financial records/review tasks | อายุ tenant + 90 วัน | export ก่อน; delete/anonymize ตาม contract และข้อกำหนดบัญชีที่ยืนยัน |
| Security/business audit | 2 ปี | append-only ระหว่าง retention; tenant export แบบจำกัดสิทธิ์ |
| Detailed AI prompt/output | 30 วันสูงสุด; เก็บ evidence IDs/usage ต่อได้ | redact PII; ZDR ที่ provider หากอนุมัติ; deletion job มี audit |
| Application/monitor logs | 30 วัน | ห้าม raw statements/tokens; aggregate metrics อยู่ได้นานกว่าเมื่อไม่ระบุตัวบุคคล |
| Expired sessions/login attempts | 30 วันหลังหมดอายุ | hard delete ตาม schedule |
| Terminated tenant export window | 30 วัน; complete deletion เป้าหมาย 90 วัน | legal hold/contract exception ต้องมี owner และ expiry |
| Backup copies | 35 วันหลัง source deletion โดยเป้าหมาย | expire ตาม backup policy; restore ต้อง reapply deletion tombstones |

400 วันและ 2 ปีเป็น **business proposal** สำหรับแพลตฟอร์มวิเคราะห์ ไม่ใช่ข้อสรุปทางกฎหมายหรือการรับรองว่าเป็นระยะบัญชีที่เพียงพอ หากระบบกลายเป็นแหล่งเอกสารบัญชี/ภาษี Finance/Privacy ต้องกำหนดระยะใหม่ก่อนใช้งาน กรณีตัวอย่างของ PDPC ใช้หลักเก็บเท่าที่จำเป็นตามวัตถุประสงค์และลบ/ทำให้ไม่ระบุตัวเมื่อหมดความจำเป็น ดู [PDPC/GPPC privacy material](https://gppc.pdpc.or.th/privacy-policy/page/2/)

## 4. Backup, RPO และ RTO

Render ระบุว่า paid Postgres มี PITR; Hobby เก็บ recovery window 3 วัน และ Pro ขึ้นไป 7 วัน ส่วน logical export ที่สร้างไว้เก็บบน Render 7 วัน ดู [Render backup docs](https://render.com/docs/postgresql-backups) และ [Render pricing](https://render.com/pricing)

เป้าหมายที่เสนอให้ผู้บริหารอนุมัติ:

| Failure scope | RPO | RTO | กลไกและหลักฐานที่ต้องมี |
|---|---:|---:|---|
| Logical/operator error ใน DB | ≤ 1 ชั่วโมง | ≤ 4 ชั่วโมง | Render PITR ไป instance ใหม่ + connection cutover rehearsal |
| Provider/account/regional recovery | ≤ 24 ชั่วโมง | ≤ 8 ชั่วโมง | daily encrypted logical backup ไป S3 boundary แยก + restore automation |
| Evidence object overwrite/delete | 0 หลัง acknowledged write สำหรับ object version | ≤ 4 ชั่วโมง | versioning/Object Lock ตาม policy + checksum manifest |
| Identity provider outage | ไม่มี data-write loss | ≤ 4 ชั่วโมง | existing sessions ตาม policy; login fail closed; provider status/escalation |

ตัวเลขเหล่านี้เป็น objective ที่เสนอ ไม่ใช่ SLA จนกว่าจะทดสอบบน staging dataset, วัด backup lag/restore/cutover และยืนยันว่า provider plan รองรับจริง ซ้อม restore รายไตรมาสและหลัง schema/storage change สำคัญ

## 5. Monitoring และ incident ownership

Recommendation คือ Better Stack ตรวจ `/api/health` และ `/api/ready` จากภายนอก Render พร้อม Primary on-call = Engineering และ Backup = Business Operations/Support หน้า pricing ปัจจุบันมี free tier 10 monitors พร้อม Slack/e-mail; responder สำหรับ on-call/phone/SMS แสดง USD 34 ต่อ license/เดือนแบบรายเดือนหรือ USD 29 แบบรายปี ตรวจราคาอีกครั้งก่อนซื้อ ดู [Better Stack pricing](https://betterstack.com/pricing), [external monitoring](https://betterstack.com/docs/uptime/monitoring-start/) และ [on-call escalation](https://betterstack.com/docs/uptime/getting-started-with-oncall-v2/)

ก่อน staging rehearsal ต้องกรอกชื่อจริงและช่องทาง:

- Primary incident owner: **ยังไม่ระบุ**
- Backup incident owner: **ยังไม่ระบุ**
- Business/customer communication owner: **ยังไม่ระบุ**
- Acknowledgement target: เสนอ 15 นาทีสำหรับ production pilot
- Escalation target: เสนอ 30 นาทีถ้า Primary ไม่รับ
- Notification: เสนอ e-mail + Slack ใน staging; production critical เพิ่ม phone/SMS เมื่ออนุมัติงบ

## 6. AI provider, data policy และ budget

Recommendation ใช้ OpenAI API project แยกต่อ environment ผ่าน gateway เดิม โดยส่งเฉพาะ structured tool results ที่ลดรูปแล้ว ไม่ส่ง raw CSV/XLSX, ชื่อ/อีเมล/ที่อยู่, notes อิสระ, cookies/tokens หรือข้อมูล tenant อื่น OpenAI ระบุว่า business/API data ไม่ถูกใช้ฝึกโมเดลโดย default และ ZDR/Modified Abuse Monitoring ต้องได้รับอนุมัติและมีข้อจำกัด endpoint/feature ดู [OpenAI business data privacy](https://openai.com/business-data/), [API data controls](https://developers.openai.com/api/docs/guides/your-data) และ [ZDR with Private Safety Processing](https://developers.openai.com/api/docs/guides/private-safety-processing)

Policy gate ก่อน live evaluation:

- `AI_ENABLED=false` เป็นค่าเริ่มต้น; เปิดต่อ tenant + workflow เท่านั้น
- provider project, retention mode และ allowed model list ต้องถูกบันทึกและตรวจตอน runtime
- ตั้ง `store:false` เมื่อ endpoint รองรับ แต่ไม่ถือว่าเท่ากับ ZDR
- กำหนด max input/output tokens, tool steps, timeout และ retry ต่อ run
- monthly tenant budget เริ่มที่ 0 จน Product/Finance ใส่วงเงินจริง; ถึง budget แล้ว fallback เป็น deterministic report
- usage/cost/model/prompt/tool versions เก็บต่อ run โดยไม่เก็บข้อความเกิน policy
- FIN-AI-05 ต้องกำหนด usefulness, latency และ cost thresholds จาก workload จริงก่อนเปิด tenant

## 7. Cost approval snapshot

| รายการ | ข้อมูลราคา ณ วันที่ทบทวน | สิ่งที่ต้องอนุมัติ |
|---|---|---|
| WorkOS | AuthKit base ตาม limit; SSO USD 125/connection/month; Directory Sync USD 125/connection/month | จำนวน enterprise connections, billing owner, SSO/SCIM ที่ขายจริง |
| Render | Pro workspace แสดง USD 25/month + compute; DB/service/storage แยกตามขนาด | production plan, HA, DB size, backup window |
| Better Stack | free 10 monitors; paid responder USD 34 monthly / 29 annual ต่อ license | จำนวน on-call responders และ notification channels |
| AWS S3/KMS | usage-based ตาม region, storage, requests, retrieval/transfer/KMS | region, forecast GB/requests, cross-account/replication |
| OpenAI API | usage-based ตาม model/tokens และ contract/data control | monthly cap ต่อ tenant/รวม, eligible retention mode |

ราคาทั้งหมดเป็น snapshot เพื่อเปรียบเทียบ ไม่รวมภาษี, FX, support/add-ons หรือข้อเสนอ contract และต้องตรวจหน้า official/ใบเสนอราคาก่อนซื้อ

## 8. Machine-readable approval gate

ข้อเสนอถูกบันทึกใน [`config/production-dependencies.json`](../config/production-dependencies.json) และตรวจด้วย:

```sh
npm run release:decisions
```

สถานะปัจจุบันต้องออก `blocked` เพราะทั้ง 6 decisions ยังเป็น `proposed` การเปลี่ยนเป็น `approved` ต้องมี selected option, ผู้อนุมัติอย่างน้อย 2 ราย, timestamp และ evidence link อย่างน้อย 1 รายการ การแก้ manifest ไม่ทำให้ production preflight ผ่านเอง; identity/storage implementation และ acceptance tests ยังต้องเสร็จ

## 9. ลำดับ implementation หลังอนุมัติ

1. Identity adapter + external subject mapping + invitation/session/webhook tests
2. S3 storage backend แบบ dual-write/backfill/verify โดยยังไม่ contract legacy
3. Retention/legal hold/delete jobs แบบ dry-run ก่อน พร้อม approval/audit
4. Paid Render DB/PITR + offsite logical backup + staging restore/cutover rehearsal
5. Better Stack monitors/on-call + signed alert destination + incident rehearsal
6. AI project/policy/budget enforcement + live model eval/UAT
7. เปิด pilot tenant เดียวด้วย feature flags และ rollback gates

ทุกขั้นเพิ่มเข้า modular monolith/adapters เดิม ไม่สร้างระบบใหม่ทั้งหมด และไม่รับข้อมูลจริงก่อน identity, storage, retention, restore และ monitoring ของ environment นั้นผ่าน
