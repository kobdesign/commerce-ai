# SUPPORT-01 — Co-browsing vendor discovery และ synthetic PoC v1.18

วันที่ทบทวนข้อมูล: 27 กันยายน 2026
สถานะ: **Synthetic control-plane PoC พร้อม · Vendor sandbox PoC ยังรอ account/terms · DEC-09 ยังไม่อนุมัติ**

งานนี้ไม่ซื้อบริการ ไม่ฝัง vendor SDK ในเว็บ ไม่ส่งข้อมูลจริง และไม่เลือก vendor เป็น production โดยอัตโนมัติ

## ข้อสรุปที่เสนอ

ทดลอง **Cobrowse.io เป็น candidate A** และ **Unblu Embedded Co-browsing เป็น candidate B** ด้วย tenant/ข้อมูลสมมติชุดเดียวกัน

- Cobrowse.io เหมาะกับ PoC แรกเพราะ Web SDK, consent UI, 6-digit code, private-by-default redaction, custom agent integration และ free technical PoC มีเอกสารตรงกับ flow ของเรา
- Unblu เหมาะเป็นตัวเทียบ Enterprise เพราะมี embedded DOM capture, page-level integration, masking/edit blocking, security guidance สำหรับ DOM injection และ deployment แบบ managed/dedicated/on-premises
- Surfly เก็บเป็น comparison candidate เมื่อ use case ต้องข้ามเว็บภายนอก การทำงานผ่าน interaction middleware/proxy ขยาย data path เกิน own-origin pilot แรก
- Genesys Co-browse พิจารณาเมื่อบริษัทเลือก Genesys Cloud CX เป็น contact center หลักแล้ว เพราะ Co-browse อยู่ใน licensing/interaction stack ของ Genesys

ยังไม่มี winner จนกว่าจะผ่าน vendor sandbox, commercial/DPA review และ SUP-T01–10 การมี feature ในเอกสารไม่พิสูจน์ว่าทำงานกับ Next.js, ภาษาไทย, mobile และ masking ของเราได้ครบ

## Vendor matrix จากหลักฐานสาธารณะ

| เกณฑ์ | Cobrowse.io | Unblu Embedded | Surfly | Genesys Cloud |
|---|---|---|---|---|
| Architecture fit กับ own-origin | ดี: Web SDK และ agent SDK/iframe | ดี: snippet + DOM capture บนหน้าที่เลือก | มีความสามารถมากกว่า scope ผ่าน proxy/universal browsing | ดีเมื่อใช้ Genesys Messenger อยู่แล้ว |
| Privacy default | เด่น: redact ทั้ง `body` แล้ว unredact เฉพาะส่วนได้; vendor ระบุว่าค่าที่ redact ไม่ออกจาก device | Mask input/skip element และ block editing ได้; ต้องพิสูจน์ allowlist/private-by-default ใน PoC | Field/element masking, allow/block list และ no-disk session claim; ต้องตรวจ proxy data path | Configurable masking/read-only/auto-pause; ต้องตรวจกับ Messenger deployment |
| Consent/session | มี consent dialog, 6-digit code และ SDK lifecycle; application ยังต้องผูก tenant/case/agent เอง | มี visitor approval/conversation flow; configuration กว้างและต้องล็อก template | Session API/roles; ต้องออกแบบ consent ใน application | ผูกกับ messaging/voice interaction และ customer starts sharing |
| Agent identity | JWT policies, SAML และ SCIM มีเอกสาร | SSO/deployment controls มีทางเลือก Enterprise; ต้องตรวจ license/config | SSO/API มี แต่ต้องตรวจ package | ใช้ Genesys roles/permissions |
| Hosting/enterprise | Hosted global/EU/US และ self-host AWS/Azure/GCP/on-prem; APAC/Thailand guarantee ยังไม่พบใน public evidence | Cloud shared/dedicated หรือ on-prem Kubernetes/OpenShift; data location ตาม deployment | Public/private cloud และ on-prem; vendor ระบุเลือก region ได้ | Genesys Cloud regions/contract ตาม suite; co-browse เป็น add-on/plan feature |
| Protected resources | iframe/cross-domain ต้องเพิ่ม SDK ตามข้อจำกัด | Protected/session resources อาจต้อง SecureFlow Manager | Proxy approach รองรับ third-party journey แต่เพิ่ม review surface | อยู่ใน Messenger integration constraints |
| Commercial visibility | มี free PoC; ราคา production/enterprise ต้องตรวจ billing/quotation | ติดต่อ vendor/licensing; staging ใช้ license แยกใน on-prem docs | ติดต่อ vendor | CX plans + co-browse add-on/feature; ต้นทุนสูงหากไม่ได้ใช้ Genesys อยู่แล้ว |
| ตำแหน่งใน PoC | **Candidate A** | **Candidate B** | Comparison/reserve | Conditional on contact-center decision |

หลักฐานหลัก: [Cobrowse.io redaction/private-by-default](https://docs.cobrowse.io/sdk-features/redact-sensitive-data/web), [consent และ integration index](https://docs.cobrowse.io/llms.txt), [hosting options](https://support.cobrowse.io/hosting-options), [Unblu embedded architecture](https://docs.unblu.com/latest/knowledge-base/configuration/collaboration-layers/embedded-co-browsing/intro-embedded-co-browsing.html), [Unblu masking/edit blocking](https://docs.unblu.com/latest/knowledge-base/configuration/collaboration-layers/embedded-co-browsing/configuring-embedded-co-browsing.html), [Unblu deployment models](https://docs.unblu.com/latest/knowledge-base/introduction/deployment-models.html), [Surfly security/deployment](https://www.surfly.com/security-and-compliance), [Genesys co-browse overview](https://help.mypurecloud.com/articles/co-browse-for-web-messaging-overview/) และ [Genesys pricing](https://www.genesys.com/pricing)

ข้อมูล certification, no-storage, security หรือ compliance เป็นคำอธิบายของ vendor ที่ยังต้องตรวจ certificate scope, DPA, subprocessor, pen-test summary, incident terms และ contract จริงก่อนใช้

## Synthetic control-plane PoC ที่สร้างแล้ว

เพิ่ม package [`@commerce/support`](../packages/support/src/index.ts) เป็น in-memory policy harness ซึ่งไม่เรียก vendor:

- request ภายในเกิดก่อน แต่ vendor session สร้างหลัง explicit consent เท่านั้น
- code เป็นตัวเลข 6 หลัก อายุไม่เกิน 15 นาที เก็บเฉพาะ SHA-256 ที่ใส่ environment pepper และใช้ได้ครั้งเดียว
- claim ต้องตรง tenant, case และ assigned agent พร้อมกัน
- vendor contract บังคับ `view_only`, `privateByDefault`, `recording=false`, `remoteControl=false`, `fullDeviceSharing=false`
- allowlist เป็น exact HTTPS origin + page class; เปลี่ยน tenant/origin/page จบ session
- membership revoke, expiry, customer stop และ kill switch จบ session แบบ idempotent
- sensitive-selector baseline ครอบ password, secrets, PII, financial values และ evidence
- synthetic webhook ใช้ HMAC, ตรวจ vendor session และ deduplicate event ID

Policy/decision state อยู่ใน [`config/cobrowsing-poc.json`](../config/cobrowsing-poc.json) และ automated cases อยู่ใน [`tests/support-cobrowsing.test.ts`](../tests/support-cobrowsing.test.ts)

สิ่งนี้พิสูจน์ application contract และ state transition เท่านั้น ไม่พิสูจน์ว่า vendor SDK mask DOM/network จริงได้ ต้องตรวจต่อใน sandbox ด้วย browser/network evidence

หน้า browser สำหรับทดลอง contract นี้เพิ่มแล้วใน [SUPPORT-01b local PoC surface v1.19](45-cobrowsing-local-poc-surface.md) โดยยังเป็น local simulation และไม่เปลี่ยนสถานะ vendor sandbox/DEC-09

## Threat review

| Threat | Control ใน target/PoC | สิ่งที่ vendor trial ต้องพิสูจน์ |
|---|---|---|
| ผู้ใช้ไม่ยินยอมแต่ SDK ส่ง DOM | ไม่สร้าง vendor session ก่อน consent; lazy-load SDK หลัง policy check | ไม่มี request/DOM payload ก่อนกดยินยอม |
| selector หลุดเมื่อ UI เปลี่ยน/dynamic field | private-by-default + required data classifications; masking regression ทุก release | Mutation, modal, virtualized row และ reconnect ไม่เกิด unmasked frame |
| short code ถูกเดาหรือส่งต่อ | short TTL, hash+pepper, one-time, rate limit ใน SUPPORT-02; code ไม่ใช่ authorization | vendor claim ผูก agent/case และ revoke ได้ทันที |
| agent ข้าม tenant/เคส | application authorization เป็น source; vendor reference ใช้ opaque internal session | agent portal/vendor policy ไม่ค้นพบ metadata tenant อื่น |
| remote control ทำธุรกรรมแทนลูกค้า | capability contract ปิด click/type/submit/control | agent UI ไม่มี control escalation และ API mutation ไม่เกิด |
| navigation ไปหน้าเสี่ยง/tenant ใหม่ | exact origin/page/tenant revalidation และ stop/reconsent | SPA route, redirect, iframe และ tab behavior ตรง policy |
| DOM injection ไป agent browser | own-origin allowlist, CSP, ไม่แชร์ user-uploaded/raw file | vendor sanitization/sandbox, links/resources และ canvas/data URL |
| webhook ปลอม/ซ้ำ/สลับลำดับ | signature verification, event dedup และ monotonic state | signature scheme, key rotation, timestamp/replay window |
| recording/log เก็บค่าลับ | recording off; application audit เก็บ metadata; retention แยก | vendor dashboard/log/export ไม่มี masked value/DOM snapshot |
| vendor admin/support เข้าถึง session | least privilege, named support access, environment separation | vendor access audit, break-glass, DPA/subprocessor/incident process |
| SDK supply-chain/CSP failure | pin version/SRI หรือ self-host path เมื่อรองรับ, CSP allowlist, kill switch | release channel, rollback, integrity, outage behavior |
| session ค้างหลัง revoke/logout/network reconnect | reauthorize + timeout + end API; no silent resume | reconnect/logout/mobile browser background behavior |

## Vendor sandbox PoC protocol

### Environment และ dataset

1. สร้าง staging hostname แยกและ synthetic tenants A/B เท่านั้น
2. สร้างหน้า test surface: catalog form, dynamic modal, Thai IME input, virtualized table, blocked financial/evidence panel, iframe placeholder และ mobile viewport
3. ใช้ support agent identities แยก customer identity; ห้ามใช้ production account หรือ Statement จริง
4. โหลด SDK เฉพาะ route ของ PoC หลัง consent; CSP ระบุ host ที่จำเป็นจาก network trace จริง
5. บันทึก build, SDK/config version, browser/device, policy version และ test evidence โดยไม่บันทึกค่าที่ต้อง mask

### Test passes ต่อ candidate

| Pass | ตรวจอะไร | Exit evidence |
|---|---|---|
| Functional | Next.js navigation, modal/table, scroll/cursor/highlight, Thai IME, Chrome/Safari/mobile | video/screenshot ที่ใช้ synthetic values และ test log |
| Privacy | private-by-default, dynamic fields, hidden DOM, password/OTP/PII/finance/evidence, iframe/canvas | browser network capture + agent view ยืนยันค่าทดสอบต้องห้ามไม่ปรากฏ |
| Authorization | consent, code expiry/replay, tenant/case/agent mismatch, revoke/logout | API/audit assertions และ vendor session state |
| Safety | view-only, route/origin change, kill switch, vendor outage/reconnect | ไม่มี click/type/business mutation; session จบ/ไม่ resume |
| Operations | signed webhook, duplicate/out-of-order, SDK outage, dashboard access, export/delete | idempotency log, runbook และ deletion/export evidence |
| Enterprise/commercial | SSO/MFA/SCIM, SIEM, residency, self-host, SLA, DPA, subprocessor, price metric, exit | written vendor response/contract artifact ที่ reviewer เปิดดูได้ |

ต้องรัน SUP-T01–10 กับ candidate ทั้งสอง SUP-T04 ผ่านเมื่อค่าทดสอบ canary ไม่ปรากฏใน agent view, network payload ที่อ่านได้, vendor log/export หรือ recording; SUP-T10 ต้องทดสอบอุปกรณ์จริงอย่างน้อย Safari iOS และ Chrome Android พร้อม Thai IME และ network reconnect

## Evaluation rule

เกณฑ์บังคับซึ่งตกข้อใดข้อหนึ่งแล้วไม่เลือก: consent ก่อน capture, private-by-default/allowlist ที่พิสูจน์ได้, strict view-only, tenant/case/agent binding, stop/revoke, signed/replay-safe events, recording off, deletion/export, acceptable DPA/residency และ kill switch

เมื่อ candidates ผ่านเกณฑ์บังคับ ให้เปรียบเทียบตามน้ำหนักที่ผู้บริหารอนุมัติ: privacy/security 30%, integration/UX 20%, enterprise controls 15%, reliability/operations 15%, commercial/TCO 15%, vendor exit 5% คะแนนต้องอ้าง evidence ID ไม่ให้คะแนนจาก marketing page อย่างเดียว

## สิ่งที่ต้องได้รับก่อน DEC-09

- sandbox/account และ terms ที่อนุญาต synthetic PoC ของ Cobrowse.io กับ Unblu
- ราคา metric เดียวกัน: named/concurrent agent, session/usage, staging, support, SSO/SCIM, region และ self-host add-on
- DPA/subprocessor/data-flow/retention/deletion/security evidence
- ชื่อ Security, Support, Engineering และ Product approvers
- ผล SUP-T01–10 และ comparison sheet พร้อมข้อจำกัดที่ยังเหลือ

จนกว่าจะครบ ให้ DEC-09 เป็น `pending-vendor-sandbox-and-owner-review` และไม่เริ่ม SUPPORT-02 กับข้อมูลลูกค้าจริง

## Verification รอบ v1.18

- Integration tests: **136/136 ผ่าน** รวม 11 Co-browsing policy/state cases
- TypeScript typecheck และ ESLint ผ่าน
- Production build ผ่าน
- SUP-T01–09 ที่ระบุว่า synthetic ครอบเฉพาะ application control plane; vendor/browser assertions และ SUP-T10 ยัง pending ตามข้อจำกัดด้านบน
