'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FinancialReviewTaskStatus } from '@commerce/ai';
import { request } from '../lib/client';

const labels={open:'กลับเป็นรอเริ่ม',in_progress:'เริ่มติดตาม',resolved:'ปิดว่างานเสร็จ',cancelled:'ยกเลิกงาน'} as const;
export function FinancialReviewTaskActions({tenantId,shopId,taskId,status}:{tenantId:string;shopId:string;taskId:string;status:FinancialReviewTaskStatus}){
  const router=useRouter(),[nextStatus,setNextStatus]=useState<FinancialReviewTaskStatus>(status==='open'?'in_progress':'resolved'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(status==='resolved'||status==='cancelled')return <p className="review-task-terminal">งานนี้สิ้นสุดแล้ว ประวัติและหลักฐานยังเปิดดูได้</p>;
  const choices:FinancialReviewTaskStatus[]=status==='open'?['in_progress','resolved','cancelled']:['open','resolved','cancelled'];
  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');
    try{await request(`/api/tenants/${tenantId}/financial-review-tasks/${taskId}`,{shopId,status:nextStatus,reason:reason.trim()},'PATCH');router.refresh();setReason('');}
    catch(cause){setError(cause instanceof Error?cause.message:'เปลี่ยนสถานะไม่สำเร็จ');}finally{setBusy(false);}
  }
  return <form className="review-task-actions" onSubmit={submit}><h2>อัปเดตงาน</h2><div><label>สถานะถัดไป<select aria-label="สถานะงานถัดไป" value={nextStatus} disabled={busy} onChange={event=>setNextStatus(event.target.value as FinancialReviewTaskStatus)}>{choices.map(item=><option key={item} value={item}>{labels[item]}</option>)}</select></label><label>ผลการติดตามหรือเหตุผล<textarea aria-label="ผลการติดตามหรือเหตุผล" rows={3} maxLength={500} required={nextStatus==='resolved'||nextStatus==='cancelled'} value={reason} disabled={busy} placeholder={nextStatus==='resolved'?'สรุปสิ่งที่ตรวจพบและขั้นตอนที่ทำแล้ว':'เพิ่มรายละเอียดสำหรับประวัติงาน'} onChange={event=>setReason(event.target.value)}/></label></div>{error&&<p className="notice error" role="alert">{error}</p>}<button type="submit" className="button primary" disabled={busy||(['resolved','cancelled'].includes(nextStatus)&&reason.trim().length<3)}>{busy?'กำลังบันทึก…':labels[nextStatus]}</button><p className="field-help">การเปลี่ยนสถานะงานไม่แก้ยอดกระทบ ไม่ยืนยันเงินเข้า และไม่ซ่อนข้อยกเว้นเดิม</p></form>;
}
