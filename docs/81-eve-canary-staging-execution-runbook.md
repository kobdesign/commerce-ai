# Eve Canary Staging Execution Runbook

สถานะปัจจุบัน: **dry-run only — live execution blocked**

เอกสารนี้ใช้หลัง [decision pack](80-eve-canary-approval-decision-pack.md) และ machine-readable gate ผ่านเท่านั้น ช่วงนี้ใช้ตรวจรายการและซ้อม tabletop ได้ แต่ห้ามเปิด live AI

## 1. Scope

- environment: staging เท่านั้น
- tenant: synthetic/internal tenant เดียวที่อนุมัติ
- duration: ไม่เกิน 4 ชั่วโมง
- tools: Product/Sales/Inventory reads ที่อยู่ใน allowlist
- mutations: ปิดทั้งหมด
- production tenant/account: ห้ามใช้
- raw statement/customer identity: ห้ามส่งไป model

## 2. Stop conditions ก่อนเริ่ม

หยุดเตรียม canary ทันทีเมื่อข้อใดข้อหนึ่งยังไม่ครบ:

- `npm run agent:canary:readiness` ไม่ผ่าน
- `npm run agent:canary:plan` ไม่ผ่าน
- live-turn policy/security tests ของ revision ที่จะ deploy ไม่ผ่าน (baseline อยู่ที่ [docs/82](82-eve-live-turn-policy-security-harness.md))
- external probe, signed alert bridge หรือ on-call escalation ยังไม่ซ้อม
- ผู้รับผิดชอบตาม governance mode ยังไม่ acknowledge window; bootstrap mode ใช้ owner คนเดียวได้เฉพาะ synthetic/read-only
- ไม่มี approved model, retention mode, per-run limit และ window budget
- rollback rehearsal ไม่ผ่าน

readiness approvals และ provider-retention preflight ผ่านแล้ว แต่ staging plan ยังเข้าเงื่อนไขหยุดด้าน
secrets, external alert และ change window ใน CI จึงตรวจ readiness แบบปกติและตรวจ planด้วย
`--expect-blocked`

## 3. Preflight checklist

### T-7 ถึง T-1 วัน

1. บันทึก approval ทั้ง 6 gates ใน `config/eve-canary-readiness.json` พร้อม approvers, timestamp และ evidence
2. เลือก monitoring/SLO ใน `config/eve-canary-staging-plan.json`
3. ระบุ owners, synthetic tenant, window และ change ticket
4. ตรวจ signed alert bridge ด้วย payload metadata-only; บันทึก event ID, delivery time และ acknowledgement
5. ตรวจ external `/api/health`, `/api/ready` และ Eve `/eve/v1/health`
6. รัน rollback/kill-switch rehearsal และ live-turn negative security tests
7. ตรวจว่า secrets อยู่ใน provider secret store แยก environment และไม่อยู่ใน source/evidence
8. เติมเฉพาะ preflight section ใน [evidence template](evidence/eve-canary-staging-evidence-template.json)

### T-30 นาที

```sh
npm run agent:canary:readiness
npm run agent:canary:plan
npm run agent:test
npm run agent:eval:rollback
```

ต้องผ่านทั้งหมดด้วย commit/deployment revision เดียวกับที่จะทดสอบ และต้องยืนยันว่า Commerce mutations กับ production tenant data ยังปิด

## 4. Start procedure หลัง gate ผ่านในอนาคต

1. Primary เปิด incident room และ Communications owner บันทึกเวลา
2. บันทึก health/readiness baseline และ on-call schedule
3. Auditor อนุมัติ dynamic route ของ synthetic tenant ตาม change ticket
4. เปิด live-turn policy เฉพาะ approved staging deployment/tenant/window
5. เริ่ม workload ตาม sample plan โดยไม่เพิ่ม tenant ระหว่าง window
6. ตรวจ route/session/fallback/error/cost ทุก window และเทียบ SLO profile ที่เลือก
7. ตรวจ evidence references และ tenant scope เป็นราย sample

ไม่มีขั้นใดอนุญาต inventory, finance, ads, content publishing หรือ marketplace mutation

## 5. Abort procedure

เมื่อ hard criterion หรือ selected threshold ล้ม:

1. Primary เปิด global Eve kill switch ทันที
2. ยืนยัน request ใหม่ route ไป legacy และไม่มี Eve call ใหม่
3. revoke dynamic tenant route
4. revoke dynamic route ซึ่งยกเลิก active session grants ของ tenant ใน transaction เดียวกัน และตรวจ consumed/revoked audit
5. ปิด live-turn policy ของ deployment
6. ตรวจ Commerce mutation/audit/integration outbox ว่าไม่มี write จาก agent
7. ส่ง signed incident update และให้ Backup acknowledge
8. เก็บ metadata evidence เท่านั้น ห้ามคัดลอก prompt/customer data ลง ticket

หาก alert path เองล้ม ให้ถือเป็น abort แม้ model result จะดูถูกต้อง

## 6. Recovery procedure

1. คง legacy route จน root cause และ evidence ครบ
2. ตรวจ health/readiness สองรอบติดต่อกัน
3. ตรวจ recovered alert และ acknowledgement
4. ห้ามเปิด Eve ซ้ำใน window เดิมโดยไม่มี Auditor approval ใหม่
5. เติม incident timeline, rollback result และ residual risks

## 7. Completion decision

ผล window มีได้สามแบบ:

- `pass`: sample ครบ, selected SLO ผ่าน และ hard safety violations เป็นศูนย์
- `inconclusive`: sample ไม่ครบหรือ evidence ขาด โดยไม่มี safety violation
- `failed`: threshold/hard criterion/alert/acknowledgement ล้ม

`pass` ของ staging synthetic canary ไม่ใช่ production approval และไม่อนุญาต production tenant

## 8. Evidence handling

ใช้ [eve-canary-staging-evidence-template.json](evidence/eve-canary-staging-evidence-template.json) และเก็บ:

- deployment revision และ change ticket
- selected options และ approval record
- owner acknowledgement timestamps
- route/session/fallback/error/cost aggregates
- alert event IDs และ signature verification result โดยไม่เก็บ secret
- kill switch, legacy fallback และ recovery timestamps
- zero cross-tenant/mutation/marketplace-write verification

ห้ามเก็บ prompt, model response, tool input/output, customer identity, authorization header, secret หรือ raw marketplace evidence ในไฟล์นี้
