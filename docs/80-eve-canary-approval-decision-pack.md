# EVE-CANARY-04 — Canary Approval Decision Pack

สถานะ: **Decision pack complete / execution BLOCKED** วันที่ 15 พฤศจิกายน 2026

## Executive decision

ข้อเสนอสำหรับ staging canary คือใช้ monitoring แบบผสม:

1. **Better Stack** เป็น external probe และ incident/on-call หลัก
2. **signed alert verification bridge** ที่แยกจาก Commerce Web ตรวจ HMAC ก่อนสร้าง incident จาก custom canary metrics
3. **Vercel Agent Runs** ใช้ดู Eve session, tool, usage และ error trace
4. **Render health/deploy notifications** เป็นสัญญาณรองของ Commerce Core

BootstrapOwner อนุมัติ Option A, Strict internal, model, budget และ provider retention แล้ว แต่ยังไม่ได้
provision secrets หรือ operational evidence แผนจึงยังเป็น `draft` และ `executionEnabled: false`

## ข้อเท็จจริงจากระบบปัจจุบัน

| ประเด็น | สิ่งที่ตรวจพบ | ผลต่อ canary |
|---|---|---|
| Commerce hosting | Web/worker/PostgreSQL อยู่ Render staging | ต้องมี probe จากภายนอก Render |
| Eve hosting | Agent runtime ออกแบบสำหรับ Vercel Preview | Agent Runs เหมาะกับ execution trace แต่ไม่ครอบ Render availability ทั้งหมด |
| Live model turn | staging policy adapter, negative security harness, one-time/revocable grant registry, lifecycle reconciliation, cleanup controls และ request-level ZDR/no-training พร้อม แต่ `COMMERCE_AGENT_LIVE_AI=false` เป็นค่าเริ่มต้น | execution ยัง blocked จาก secrets, external monitoring และ change window |
| Business mutations | Eve มีเฉพาะ read-only Core tools | ต้องคง mutation count เป็นศูนย์ตลอด canary |
| Custom alert | Commerce มี exact-body HMAC contract | ปลายทางต้องตรวจ HMAC ก่อนส่งต่อ incident provider |
| Readiness | technical evidence 11/11, bootstrap approvals 6/6 | Policy พร้อม; operational preflight ยัง BLOCKED และ production ยัง NO-GO |

## Monitoring options

### Option A — Hybrid external-primary (แนะนำ)

- Better Stack ตรวจ `/api/health` และ `/api/ready` จากภายนอก
- verification bridge ตรวจ `X-Commerce-Signature`, timestamp และ event ID ก่อนส่ง incident
- Vercel Agent Runs ใช้ trace Eve execution และ usage/cost
- Render notifications แจ้ง deploy failure และ unhealthy service เป็นสัญญาณเสริม

เหตุผล: Render เองแนะนำ external monitoring probe เพื่อมองระบบจากภายนอก platform ส่วน Better Stack รองรับ HTTP monitor, incoming webhook, on-call schedule และ escalation policy [Render uptime guidance](https://render.com/docs/uptime-best-practices), [Better Stack monitoring](https://betterstack.com/docs/uptime/monitoring-start/), [incoming webhooks](https://betterstack.com/docs/uptime/incoming-webhooks/), [escalation policies](https://betterstack.com/docs/uptime/escalation-policies/)

ข้อจำกัด: Better Stack incoming webhook ใช้ unique URL และ mapping rules แต่เอกสารไม่ได้ยืนยันว่าจะตรวจ HMAC contract ของเราโดยตรง จึงต้องมี verification bridge หรือปลายทางที่ตรวจลายเซ็นได้ก่อนส่ง incident ห้ามถือว่าการส่งตรงเข้า provider เป็น signed-delivery evidence

### Option B — Vercel Observability primary

เหมาะกับ Eve runtime เพราะ Agent Runs แสดง session, duration, token usage และ errors ส่วน Vercel Alerts ส่ง email, Slack หรือ webhook ได้ แต่ Alerts เป็นความสามารถบนแผนที่รองรับ Observability Plus และเน้น anomaly ของ Vercel project [Eve Agent Runs](https://vercel.com/changelog/eve-agent-observability), [Vercel Alerts](https://vercel.com/docs/alerts)

ข้อจำกัด: ไม่ใช่ external end-to-end probe ของ Commerce Core บน Render และยังต้องมี incident escalation แยก

### Option C — Platform-native signals only

ใช้ Render health checks/notifications กับ Vercel Agent Runs โดยไม่เพิ่ม provider

ข้อจำกัด: ไม่มี independent probe ครอบทั้งสอง hosting providers และไม่มี cross-provider on-call path จึงไม่เพียงพอเป็นตัวเลือกเดี่ยวสำหรับ canary [Render health checks](https://render.com/docs/health-checks), [Render notifications](https://render.com/docs/notifications)

รายละเอียด machine-readable อยู่ที่ [config/eve-canary-staging-plan.json](../config/eve-canary-staging-plan.json)
โดย BootstrapOwner อนุมัติ Option A และ Strict internal แล้ว แต่ operational evidence ยังไม่ครบ

## Proposed SLO profiles

BootstrapOwner เลือก Strict internal สำหรับ synthetic canary แล้ว ตารางเก็บ Observation-first ไว้เป็นทางเลือกในอนาคต:

| Metric | Strict internal | Observation-first |
|---|---:|---:|
| Minimum sample | 20 | 10 |
| Application availability | 99% | 95% |
| Agent completion | 95% | 90% |
| Maximum fallback rate | 5% | 10% |
| Maximum error rate | 2% | 5% |
| Acknowledge target | 15 นาที | 30 นาที |
| Escalate target | 30 นาที | 60 นาที |

เลือก **Strict internal** เพราะ canary มี tenant เดียว, read-only และ time-bounded หาก sample ไม่ครบให้ผลเป็น inconclusive ไม่ใช่ pass

Hard safety criteria ไม่ขึ้นกับ profile และต้องเท่ากับศูนย์เสมอ:

- cross-tenant read
- unauthorized tool call
- evidence integrity failure
- financial/inventory/marketplace/external mutation attempt
- production tenant data use

## Incident ownership decision

สำหรับ production หรือ real-tenant pilot ต้องกรอกบุคคลจริงสามบทบาทและต้องเป็นคนละคน:

| Role | หน้าที่ | สถานะ |
|---|---|---|
| Primary incident owner | รับ alert, ตรวจสถานะ, สั่ง kill switch | ยังไม่ระบุ |
| Backup incident owner | รับช่วงเมื่อ Primary ไม่ acknowledge ตาม target | ยังไม่ระบุ |
| Communications owner | แจ้งผู้บริหาร/ผู้ทดสอบและบันทึก timeline | ยังไม่ระบุ |

การระบุเพียงชื่อทีม เช่น “Engineering” ไม่เพียงพอสำหรับ canary window ต้องมี subject ที่ตรวจสอบได้, ช่องทางติดต่อ และ acknowledgement evidence

ช่วง bootstrap synthetic/read-only ใช้ข้อยกเว้นที่จำกัดขอบเขต: `github:kobdesign` เป็น
BootstrapOwner, Primary และ Communications ได้, human backup เป็น optional และ automatic kill
switch ต้องพร้อม ข้อยกเว้นนี้ไม่อนุญาตข้อมูลร้านจริง, Commerce mutation หรือ production

## Mandatory abort criteria

ทุกข้อสั่ง `kill-switch-and-fallback` ทันที:

1. tenant isolation mismatch
2. tool นอก read-only allowlist
3. evidence missing/hash mismatch
4. mutation attempt ทุกชนิด
5. signed alert หรือ incident route ตรวจไม่ได้
6. ถึง budget ที่อนุมัติ
7. ไม่มี acknowledgement ตาม governance mode และ target

Rate/cost threshold จาก SLO profile ที่เลือกเป็น abort criteria เพิ่มเติมระหว่าง window

## Machine-readable execution gate

ตรวจสถานะด้วย:

```sh
npm run agent:canary:plan -- --expect-blocked
```

Gate ต้อง blocked จนมีครบทั้งหมด:

- plan status approved และ `executionEnabled=true`
- monitoring stack และ SLO profile ที่มีอยู่ใน decision pack
- ใน separated-role mode: Primary, Backup และ Communications owner คนละคน
- ใน bootstrap-single-owner mode: BootstrapOwner ทำ Primary/Communications ได้และ human backup เป็น optional เฉพาะ synthetic/read-only canary
- synthetic tenant ID และ window ไม่เกิน 4 ชั่วโมง
- preflight evidence: approvals, signed alert dry-run, owner acknowledgement, rollback rehearsal, live-turn policy test และ change ticket
- readiness approvals 6/6 ตาม governance mode ที่ manifest ระบุ
- live-turn policy ถูก implement และมี evidence โดยยังคง Commerce mutations/production tenant data ปิด

การแก้ JSON ให้เป็น `approved` โดยไม่มี code/evidence ไม่ใช่การอนุมัติให้รัน

## Current decision

- Decision pack: **COMPLETE**
- Dry-run planning: **READY**
- Live staging canary: **BLOCKED**
- Production: **NO-GO**
- Live AI/model keys/deployment changes ในงานนี้: **0**

## งานถัดไปที่แนะนำ

**EVE-CANARY-12 — Approval closure and first staging synthetic canary**

Engineering preflight และ Bootstrap approval อยู่ใน [docs/89](89-eve-canary-approval-closure-preflight.md) ขั้นต่อไปต้องยืนยัน provider retention, provision staging secrets, ส่ง external alert evidence และกำหนด change window ก่อนเปิด live AI
