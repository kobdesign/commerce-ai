import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { financialReviewAssignees,financialReviewTask } from '@commerce/ai';
import { uuid } from '@commerce/contracts';
import { workspace } from '../../../../../lib/server';
import { FinancialReviewTaskActions } from '../../../../../components/financial-review-task-actions';

const dateTime=(value:Date|string|null)=>value?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)):'—';
const statusLabel={open:'รอเริ่ม',in_progress:'กำลังติดตาม',resolved:'เสร็จแล้ว',cancelled:'ยกเลิก'} as const;
const kindLabel={unmatched_statement_line:'บรรทัด Statement ยังไม่พบคำสั่งซื้อ',order_difference:'ยอดคำสั่งซื้อยังต่างกัน',payout_difference:'ยอดรอบโอนยังต่างกัน',insufficient_payout_evidence:'หลักฐานยอดรวมยังไม่พอ'} as const;

export default async function FinancialReviewTaskPage({params}:{params:Promise<{taskId:string}>}){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูงานติดตามนี้</h1></div>;
  const taskId=uuid.parse((await params).taskId),[{task,events},assignees]=await Promise.all([financialReviewTask(w.ctx,w.shop.id,taskId),financialReviewAssignees(w.ctx,w.shop.id)]);
  const evidence=task.evidence_snapshot,memberName=(id:string)=>assignees.find(item=>item.user_id===id)?.name??'สมาชิกที่สิทธิ์ถูกเปลี่ยน',assignee=memberName(task.assignee_id);
  return <>
    <Link className="text-link back-link" href="/settlements"><ArrowLeft size={16}/>กลับไปกระทบยอดเงินโอน</Link>
    <div className="page-heading"><div><span className="eyebrow">งานติดตามการเงิน</span><h1>{task.title}</h1><p>{kindLabel[task.exception_kind]} · สร้าง {dateTime(task.created_at)}</p></div><span className={`pill ${task.status==='resolved'?'green':task.status==='cancelled'?'neutral':'amber'}`}>{statusLabel[task.status]}</span></div>
    <div className="review-task-detail-grid"><section className="panel review-task-detail"><h2>รายละเอียดที่ผู้ใช้ยืนยัน</h2><dl><div><dt>ผู้รับผิดชอบ</dt><dd>{assignee}</dd></div><div><dt>เหตุผล</dt><dd>{task.reason}</dd></div><div><dt>รหัสข้อยกเว้น</dt><dd><code>{task.exception_id}</code></dd></div><div><dt>ผู้เสนอ / ผู้อนุมัติ / ผู้ดำเนินการ</dt><dd>{memberName(task.proposed_by)} / {memberName(task.approved_by)} / {memberName(task.executed_by)}</dd></div>{task.proposed_by_run_id&&<div><dt>ประวัติการสรุปที่เสนอ</dt><dd><Link className="text-link" href={`/settlements/reviews/${task.proposed_by_run_id}`}>เปิดผลสรุป</Link></dd></div>}</dl>{task.outcome&&<p className="notice"><strong>ผลล่าสุด:</strong> {task.outcome}</p>}{w.ctx.role!=='auditor'&&<FinancialReviewTaskActions tenantId={w.org.id} shopId={w.shop.id} taskId={task.id} status={task.status}/>}</section>
      <section className="panel review-task-evidence"><div><span className="eyebrow">หลักฐานตอนสร้างงาน</span><h2>ข้อมูลที่ใช้ตัดสินใจ</h2></div><p className="review-task-impact">หลักฐานชุดนี้เป็น snapshot สำหรับตรวจสอบย้อนหลัง สถานะ “เสร็จแล้ว” ของงานไม่ทำให้ยอดด้านล่างตรงกันโดยอัตโนมัติ</p><dl><div><dt>ร้าน / ช่วงข้อมูล</dt><dd>{evidence.scope.shopName} · {evidence.scope.period.from} ถึง {evidence.scope.period.to}</dd></div><div><dt>ข้อมูลต้นทางล่าสุด</dt><dd>{dateTime(evidence.observedAt)}</dd></div><div><dt>นำเข้าล่าสุด</dt><dd>{dateTime(evidence.importedAt)}</dd></div><div><dt>รุ่นการคำนวณ</dt><dd>{evidence.metricVersion}</dd></div></dl><h3>รหัสหลักฐาน</h3><div className="review-task-evidence-refs">{evidence.exception.evidenceReferences.map(item=><code key={`${item.kind}:${item.ref}`}>{item.ref}</code>)}</div>{evidence.missingInputs.length>0&&<p><strong>ข้อมูลที่ยังขาด:</strong> {evidence.missingInputs.join(' · ')}</p>}<details><summary>ข้อจำกัดของหลักฐาน</summary>{evidence.limitations.map(item=><p key={item}>{item}</p>)}</details></section>
    </div>
    <section className="panel review-task-timeline"><h2>ประวัติงาน</h2><ol>{events.map(event=><li key={event.id}><span></span><div><strong>{statusLabel[event.to_status]}</strong><p>{event.reason||'เปลี่ยนสถานะงาน'}</p><small>{dateTime(event.created_at)} · {memberName(event.actor_id)}</small></div></li>)}</ol></section>
  </>;
}
