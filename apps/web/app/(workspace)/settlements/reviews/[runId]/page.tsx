import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { settlementReviewRun } from '@commerce/ai';
import { uuid } from '@commerce/contracts';
import { workspace } from '../../../../../lib/server';

const dateTime=(value:Date|string|null)=>value?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)):'ยังไม่มีข้อมูล';

export default async function SettlementReviewRunPage({params}:{params:Promise<{runId:string}>}){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูประวัติการสรุปนี้</h1></div>;
  const runId=uuid.parse((await params).runId),run=await settlementReviewRun(w.ctx,w.shop.id,runId);
  return <>
    <Link className="text-link back-link" href="/settlements"><ArrowLeft size={16}/>กลับไปกระทบยอดเงินโอน</Link>
    <div className="page-heading"><div><h1>ประวัติการสรุป</h1><p>{run.mode==='live'?'AI ช่วยจัดลำดับ':'สรุปจากข้อมูล'} · {dateTime(run.created_at)}</p></div><span className={`pill ${run.status==='succeeded'?'green':run.status==='failed'?'amber':'neutral'}`}>{run.status==='succeeded'?'สำเร็จ':run.status==='failed'?'ไม่สำเร็จ':'กำลังทำงาน'}</span></div>
    <section className="panel settlement-review-detail">
      <dl><div><dt>ช่วงข้อมูล</dt><dd>{run.request.period.from} ถึง {run.request.period.to}</dd></div><div><dt>โมเดล</dt><dd>{run.model??'ไม่ได้เรียกโมเดล AI'}</dd></div><div><dt>Token ขาเข้า / ขาออก</dt><dd>{run.input_tokens??'—'} / {run.output_tokens??'—'}</dd></div><div><dt>สถานะบันทึก</dt><dd>{run.completed_at?dateTime(run.completed_at):'ยังไม่เสร็จ'}</dd></div></dl>
      {run.result?<><h2>{run.result.headline}</h2><ol>{run.result.facts.map(item=><li key={item.exceptionId}><strong>{item.title}</strong><p>{item.detail}</p><small>{item.evidenceReferences.join(' · ')}</small></li>)}</ol><h3>ขั้นตอนตรวจต่อ</h3><ul>{run.result.suggestions.map(item=><li key={item}>{item}</li>)}</ul><p className="review-footnote">{run.result.evidence.limitations.join(' · ')}</p></>:<p className="notice error">การสรุปนี้ไม่สำเร็จ ({run.error_code??'ไม่ทราบสาเหตุ'}) ไม่มีผลลัพธ์ AI ถูกบันทึกเป็นผลสำเร็จ</p>}
      <details className="settlement-review-metadata"><summary>เวอร์ชันที่ใช้</summary><p>Workflow {run.workflow_version} · Prompt {run.prompt_version} · Tool {run.tool_version} · Policy {run.policy_version}</p></details>
    </section>
  </>;
}
