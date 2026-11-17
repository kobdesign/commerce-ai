# EVE-POC-10 — Legacy/eve Shadow Comparison

สถานะ: **ผ่าน technical gate ในขอบเขต synthetic deterministic shadow** วันที่ 15 พฤศจิกายน 2026

## ข้อสรุป

ระบบมี evaluation harness รุ่น `eve-shadow-eval-v1` ที่ส่งกรณี promotion/stockout ชุดเดียวกันให้ legacy baseline และ eve path แล้ว ผู้ใช้ยังเห็นผลจาก legacy เท่านั้น ส่วนผล eve อยู่ใน shadow report และไม่มี mutation

ผล synthetic 3 กรณี:

| ตัววัด | Legacy baseline | eve shadow |
|---|---:|---:|
| Correct action/risk/capacity | 0/3 | 3/3 |
| Grounded Product/Sales/Inventory evidence | 0/3 | 3/3 |
| Stockout safety critical failures | 0 | 0 |
| Mutation attempts | 0 | 0 |
| User-visible | ใช่ | ไม่ใช่ |
| Token / provider cost | ไม่ได้วัด | ไม่ได้วัด |

Legacy ได้ 0/3 ด้าน decision และ grounding เพราะระบบเดิมอ่านเฉพาะ catalog และจงใจไม่ให้คำแนะนำ promotion เมื่อไม่มี Sales/Inventory evidence ผลนี้แสดง capability gap ของระบบ ไม่ใช่หลักฐานว่าโมเดล legacy ด้อยกว่า eve

ผลรอบนี้อนุญาตให้ทำ **EVE-POC-11 rollback rehearsal** ซึ่งส่งมอบแล้วใน [docs/76](76-eve-rollback-rehearsal.md) สถานะ production ยังคง **NO-GO**

## Evaluation cases

Dataset ใช้ข้อมูลสมมติและมี version:

1. SKU มียอดขายและ distributable stock เพียงพอ — คาด `promote`
2. SKU มียอดขายแต่ distributable stock เป็นศูนย์ — ต้อง `hold`
3. SKU มี stock สูงแต่ Inventory specialist ระบุ high risk/ineligible — ใช้กฎอนุรักษ์นิยมและ `hold`

ทุกกรณีตรวจ:

- contract และ dataset version
- action, deterministic stock risk และ promotion capacity
- Core Product/Sales/Inventory request IDs
- evidence references ของ product, variant, sales aggregate, inventory balance และ policy
- zero-capacity stockout guard
- mutation count เป็นศูนย์
- legacy visible / eve shadow-only

## Metrics policy

Harness วัดเวลา execute ภายในเครื่องและติดป้าย `productionComparable: false` จึงห้ามใช้ตัวเลขนี้คาด SLA บน Render, Vercel หรือ model provider

รอบนี้ไม่เรียก live model ค่า `inputTokens`, `outputTokens` และ `costUsd` จึงเป็น `null` ไม่ใช่ศูนย์ และไม่สร้าง rate card หรือตัวเลขค่าใช้จ่ายสมมติ การเทียบ model quality, latency และ cost จริงต้องรอ approved provider/data policy/budget/threshold แล้วจึงรัน shadow บน workload ที่ปกปิดข้อมูลและมีผู้ตรวจ

## Code references

- `fixtures/eve-shadow-evaluation.json` — versioned synthetic cases และ expected outcomes
- `apps/agent-runtime/agent/lib/shadow-evaluation.ts` — shared schemas, normalization, checks และ comparison report
- `apps/agent-runtime/evals/synthetic-shadow.ts` — รัน legacy catalog-only baseline และ deterministic eve consolidation บน fixture เดียวกัน
- `apps/agent-runtime/scripts/run-shadow-evaluation.ts` — reproducible CLI; exit code ไม่เป็นศูนย์เมื่อ eve critical gate fail
- `apps/agent-runtime/tests/shadow-evaluation.test.ts` — visibility, correctness, grounding, stockout safety และ null usage/cost assertions
- `.github/workflows/checks.yml` — รัน shadow evaluation ใน Node 24 agent-runtime job

รันซ้ำด้วย:

```sh
npm run agent:eval:shadow
```

## ข้อจำกัด

- เป็น system capability comparison เพราะ tool access ของสองระบบไม่เท่ากัน ไม่ใช่ controlled model A/B test
- Specialist outputs เป็น synthetic fixtures; ยังไม่ได้ทดสอบความผันผวนของ model output
- Core reads ใช้ response fixtures ผ่าน evidence verifier ไม่ใช่ HTTP/Vercel/Render latency จริง
- ยังไม่มี human grade ด้าน usefulness, clarity หรือ actionability
- ยังไม่เปิด feature flag routing จริงและยังไม่ได้ซ้อม rollback ระหว่าง in-flight workflow

## งานต่อเนื่อง

**EVE-POC-11 — Rollback rehearsal** ส่งมอบแล้วใน [docs/76](76-eve-rollback-rehearsal.md): tenant-scoped route/kill switch ใช้ default legacy และ fallback ระหว่าง Eve unavailable/in-flight โดยไม่เปลี่ยน Commerce data ขั้นต่อไปเป็น read-only canary readiness review ซึ่งยังไม่อนุมัติ live model หรือ production tenant
