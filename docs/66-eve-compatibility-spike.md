# EVE-POC-01 — eve Compatibility Spike

วันที่ทดสอบ: 13 พฤศจิกายน 2026
สถานะ: **Conditional pass**
ขอบเขต: isolated non-production spike; ไม่มีการแก้ application source, package lock, database, deployment หรือ live AI

## ข้อสรุป

`eve@1.0.0-rc.10` สามารถ build ร่วมกับ Next.js 16, React 19 และ TypeScript 6 ได้ แต่ **นำมาติดตั้งทับ dependency ชุดปัจจุบันตรง ๆ ไม่ได้** เพราะ eve ต้องการ Node.js `>=24` และ peer dependency `ai ^7.0.137` ขณะที่ repository ปัจจุบันใช้ Node 22 และ `ai 7.0.102`

แนวทางที่ผ่านการทดสอบคือแยก `apps/agent-runtime` ให้ใช้ Node 24 และประกาศ `ai 7.0.137` ของตนเอง โดยคง Commerce Web/Worker บน Node 22 ในช่วง POC ได้ npm workspace จำลองสามารถ resolve `ai 7.0.102` ที่ root และ `ai 7.0.137` ใน agent workspace แยกกันได้

Baseline ที่ผ่าน build และไม่มี npm advisory ณ เวลาทดสอบ:

- `eve 1.0.0-rc.10` แบบ pin exact
- Node.js `24.22.3`
- `ai 7.0.137`
- Next.js `16.4.6`
- React / React DOM `19.3.0`
- TypeScript `6.0.3`
- Zod `4.6.7`

ผลนี้อนุมัติเฉพาะการเดินหน้าสู่ EVE-POC-02 ในสภาพแวดล้อม non-production ยังไม่ใช่ production approval และยังไม่พิสูจน์ durability, session resume, sandbox execution, tenant isolation หรือ live model behavior

## วิธีทดสอบ

สร้าง sandbox ชั่วคราวที่ `/tmp/eve-compat-spike-20261113` และไม่คัดลอกผล build เข้าสู่ repository:

1. ทดลองติดตั้ง dependency ชุดปัจจุบันพร้อม eve
2. ทดลองชุดขั้นต่ำที่ยก Node และ AI SDK ตามข้อกำหนดของ eve
3. สร้าง Next.js App Router ขนาดเล็กพร้อม `withEve()` และ agent ที่ปิด default tools
4. รัน TypeScript typecheck, Next production build และ `eve build`
5. จำลอง npm workspaces ที่ root และ agent runtime ใช้ AI SDK คนละ patch version
6. ตรวจ dependency security advisories และ license metadata

ไม่มี API key, Commerce credential, production data, model invocation หรือ external deployment ในการทดสอบนี้

Repository evidence ที่ใช้กำหนด current baseline:

- [`package.json`](../package.json) — exact versions ของ Node engine, AI SDK, Next, React และ TypeScript
- [`apps/web/next.config.ts`](../apps/web/next.config.ts) — TypeScript 6 build mitigation ของ Commerce Web
- [`render.yaml`](../render.yaml) — Node 22 และ service boundary ของ Render deployment ปัจจุบัน
- [`packages/ai/src/index.ts`](../packages/ai/src/index.ts) — legacy AI SDK runtime ที่ต้องคงไว้ระหว่าง POC และ rollback

## Compatibility matrix

| หัวข้อ | ชุดปัจจุบัน | ผลทดสอบ | ข้อสรุป |
|---|---:|---|---|
| eve | ไม่มี → `1.0.0-rc.10` | Pass เมื่อ pin exact | ยังเป็น release candidate; ห้ามใช้ floating version |
| Node.js | 22.x | Fail constraint | eve ระบุ `>=24`; agent runtime ต้องมี Node 24 ของตนเอง |
| AI SDK | `7.0.102` | Fail install | eve ต้องการ `^7.0.137` |
| Next.js | `16.3.5` | Compatible แต่มี security advisories | ใช้ patched baseline `16.4.6` ใน POC |
| React | `19.3.0` | Pass | ใช้ต่อได้ |
| TypeScript | `6.0.3` | Pass | ต้องคง `experimental.useTypeScriptCli: false` และ worker threads เช่น Commerce Web ปัจจุบัน |
| Zod | `4.6.5` | Compatible แต่มี security advisory | ใช้ `4.6.7` ใน POC |
| npm workspace แยก AI SDK | root `7.0.102`; agent `7.0.137` | Pass resolution | npm lock วาง AI SDK ของ agent ไว้ใต้ workspace โดยไม่แทน root version |
| `tsc --noEmit` | baseline patched | Pass | ไม่มี type error ใน minimal integration |
| `next build` | baseline patched | Pass | compile, typecheck และ static generation ผ่าน |
| `eve build` | baseline patched | Pass | Nitro node-server output สำเร็จ ขนาดประมาณ 10.1 MB |
| Local sandbox provider | ไม่มี Docker/Vercel runtime | Not verified | build แจ้งว่า `DefaultSandbox` ไม่มี provider; ต้องพิสูจน์บน Vercel ใน EVE-POC-02 |

## Failure evidence และสาเหตุ

การติดตั้ง eve ร่วมกับ dependency ชุดปัจจุบันหยุดด้วย `ERESOLVE` เพราะ:

```text
found: ai@7.0.102
peer ai@^7.0.137 from eve@1.0.0-rc.10
```

การเพิ่ม eve ใน root package เดิมจึงไม่ใช่เส้นทางที่ยอมรับได้ นอกจากทำ regression test และอัปเกรด AI SDK ของระบบเดิมพร้อมกัน ซึ่งเพิ่ม blast radius โดยไม่จำเป็นสำหรับ POC

การ build Next ครั้งแรกด้วย TypeScript CLI path หยุดที่การอ่าน `tsc --showConfig` ปัญหานี้ไม่ใช่ incompatibility ของ eve โปรเจกต์ปัจจุบันมี mitigation อยู่แล้วใน `apps/web/next.config.ts` คือปิด `experimental.useTypeScriptCli` และเปิด worker threads เมื่อนำค่าดังกล่าวมาใช้ build ผ่าน

## Security baseline

ชุดเริ่มต้น Next `16.3.5` และ Zod `4.6.5` มี advisories ที่ npm audit รายงาน จึงไม่ควรใช้เป็น POC baseline หลังเปลี่ยนเป็น Next `16.4.6` และ Zod `4.6.7` แล้ว `npm audit` รายงาน 0 vulnerabilities ณ เวลาทดสอบ

ข้อกำหนดสำหรับ EVE-POC-02:

- lockfile ต้อง pin exact eve และบันทึก patched Next/Zod versions
- CI ต้องรัน audit หรือ dependency review และ fail ตาม severity policy
- agent runtime ไม่มี Commerce database credential
- POC ยังใช้ synthetic data และ read-only tools เท่านั้น

## License inventory

metadata ของ package หลัก:

| Package | License |
|---|---|
| eve | Apache-2.0 |
| AI SDK | Apache-2.0 |
| Next.js | MIT |
| React / React DOM | MIT |
| Zod | MIT |
| Nitro / Rolldown / Undici | MIT |

การสแกน package manifests ใน sandbox พบ 53 package/version entries: Apache-2.0 13, MIT 32, ISC 3, BSD-3-Clause 1, 0BSD 1, `(AFL-2.1 OR BSD-3-Clause)` 1, CC-BY-4.0 1 และ LGPL-3.0-or-later 1 โดยไม่มี package ที่ไม่ประกาศ license รายการ LGPL คือ binary dependency `@img/sharp-libvips-linux-x64`; ต้องให้ legal/compliance ตรวจ distribution obligations ก่อน production release การตรวจนี้เป็น engineering inventory ไม่ใช่ legal opinion

## การเปลี่ยนแปลงขั้นต่ำใน EVE-POC-02

1. สร้าง `apps/agent-runtime` เป็น Vercel project แยก และกำหนด Node 24
2. ให้ workspace นี้ประกาศ `eve`, `ai`, Next, React และ Zod versions ของตนเอง
3. ใช้ Next TypeScript configuration แบบเดียวกับ Commerce Web สำหรับ TypeScript 6
4. เริ่มด้วย agent เปล่า, health endpoint และ synthetic workflow โดยยังไม่มี Commerce tools
5. ยืนยัน Vercel Sandbox/Workflow provider, session resume และ environment separation
6. ไม่ส่ง Render database URL, marketplace token หรือ production secret เข้า Vercel project

## Gate result

EVE-POC-01 ผ่านแบบมีเงื่อนไข:

- ผ่าน: exact-version install ใน isolated workspace, typecheck, Next build, eve build, workspace dependency coexistence และ initial license/security inventory
- ต้องแก้ก่อนเริ่ม: Node 24 boundary, agent-local AI SDK และ patched Next/Zod baseline
- ยังไม่ผ่าน/ยังไม่ทดสอบ: Vercel deployment, sandbox provider, Workflow durability, retries, session resume, tracing, cost attribution, tenant isolation และ Core API authentication

งานถัดไปคือ **EVE-POC-02 — Vercel non-production runtime foundation** ตามข้อจำกัดใน [architecture decision](65-eve-vercel-agent-runtime-decision.md)
