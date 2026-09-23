'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useRef,useState } from 'react';
import { ArrowRight,Bot,CheckCircle2,ClipboardCheck,Clock3,Sparkles,X } from 'lucide-react';
import type { FinancialReviewAssignee,FinancialReviewDraft,FinancialReviewTask,SettlementReviewFact,SettlementReviewResult,SettlementReviewRunSummary } from '@commerce/ai';
import { request } from '../lib/client';

type SerializedRun=Omit<SettlementReviewRunSummary,'created_at'>&{created_at:string};
type SerializedTask=Omit<FinancialReviewTask,'created_at'|'updated_at'|'resolved_at'>&{created_at:string;updated_at:string;resolved_at:string|null};
type SerializedDraft=Omit<FinancialReviewDraft,'created_at'|'expires_at'|'confirmed_at'>&{created_at:string;expires_at:string;confirmed_at:string|null};
type Selection={fact:SettlementReviewFact;run:SettlementReviewResult};
const dateTime=(value:string|null)=>value?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)):'ยังไม่มีข้อมูล';
function minusDays(value:string,days:number){const result=new Date(`${value}T00:00:00Z`);result.setUTCDate(result.getUTCDate()-days);return result.toISOString().slice(0,10);}
const kindLabel={unmatched_statement_line:'ไม่พบคำสั่งซื้อ',order_difference:'ยอดคำสั่งซื้อต่าง',payout_difference:'ยอดรอบโอนต่าง',insufficient_payout_evidence:'หลักฐานไม่พอ'} as const;
const reasonByKind={
  unmatched_statement_line:'ตรวจเลขคำสั่งซื้อและจับคู่กับรายงานขายต้นทาง',
  order_difference:'ตรวจรายการหัก คืนเงิน และการแบ่งรับเงินของคำสั่งซื้อ',
  payout_difference:'ตรวจยอดรวมและรายการจัดสรรใน Statement รอบเดียวกัน',
  insufficient_payout_evidence:'ขอหลักฐานยอดรวมจาก Statement ต้นทางให้ครบ',
} as const;
const taskStatusLabel={open:'รอเริ่ม',in_progress:'กำลังติดตาม',resolved:'เสร็จแล้ว',cancelled:'ยกเลิก'} as const;

export function SettlementReviewAssistant({tenantId,shopId,today,liveEnabled,initialRuns,canManageTasks,assignees,initialTasks}:{
  tenantId:string;shopId:string;today:string;liveEnabled:boolean;initialRuns:SerializedRun[];canManageTasks:boolean;
  assignees:FinancialReviewAssignee[];initialTasks:SerializedTask[];
}){
  const router=useRouter(),draftHeadingRef=useRef<HTMLHeadingElement>(null),triggerRef=useRef<HTMLButtonElement|null>(null);
  const [from,setFrom]=useState(minusDays(today,30)),[to,setTo]=useState(today),[limit,setLimit]=useState('10');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<SettlementReviewResult|null>(null);
  const [selection,setSelection]=useState<Selection|null>(null),[assigneeId,setAssigneeId]=useState(assignees[0]?.user_id??''),[reason,setReason]=useState('');
  const [draft,setDraft]=useState<SerializedDraft|null>(null),[draftBusy,setDraftBusy]=useState(false),[draftError,setDraftError]=useState(''),[humanConfirmed,setHumanConfirmed]=useState(false),[confirmationKey,setConfirmationKey]=useState('');
  const [tasks,setTasks]=useState(initialTasks),[savedTask,setSavedTask]=useState<SerializedTask|null>(null);
  const displayedRuns:SerializedRun[]=result?[{id:result.id,mode:result.mode,status:'succeeded' as const,request:result.request,created_at:result.evidence.analysedAt},...initialRuns.filter(run=>run.id!==result.id)].slice(0,10):initialRuns;
  useEffect(()=>{if(selection)draftHeadingRef.current?.focus();},[selection]);

  async function run(mode:'tool-preview'|'live'){
    setBusy(true);setError('');closeDraft(false);
    try{
      const output=await request<SettlementReviewResult>(`/api/tenants/${tenantId}/settlement-review`,{shopId,period:{from,to},limit:Number(limit),mode});
      setResult(output);router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'สรุปรายการไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  function selectFact(fact:SettlementReviewFact,runResult:SettlementReviewResult,event:React.MouseEvent<HTMLButtonElement>){
    triggerRef.current=event.currentTarget;setSelection({fact,run:runResult});setReason(reasonByKind[fact.kind]);setAssigneeId(assignees[0]?.user_id??'');
    setDraft(null);setDraftError('');setHumanConfirmed(false);setSavedTask(null);setConfirmationKey('');
  }
  function closeDraft(returnFocus=true){setSelection(null);setDraft(null);setDraftError('');setHumanConfirmed(false);setConfirmationKey('');if(returnFocus)requestAnimationFrame(()=>triggerRef.current?.focus());}
  function changeDraftInput(update:()=>void){update();setDraft(null);setHumanConfirmed(false);setConfirmationKey('');setDraftError('');}
  async function createDraft(){
    if(!selection)return;setDraftBusy(true);setDraftError('');setSavedTask(null);
    try{
      const created=await request<SerializedDraft>(`/api/tenants/${tenantId}/financial-review-drafts`,{
        shopId,period:selection.run.request.period,exceptionId:selection.fact.exceptionId,assigneeId,reason:reason.trim(),proposedByRunId:selection.run.id,
      });
      setDraft(created);setConfirmationKey(crypto.randomUUID());setHumanConfirmed(false);
    }catch(cause){setDraftError(cause instanceof Error?cause.message:'สร้างร่างไม่สำเร็จ');}
    finally{setDraftBusy(false);}
  }
  async function confirmDraft(){
    if(!draft)return;setDraftBusy(true);setDraftError('');
    try{
      const output=await request<{outcome:'created'|'existing';task:SerializedTask}>(`/api/tenants/${tenantId}/financial-review-drafts/${draft.id}/confirm`,{
        shopId,payloadHash:draft.payload_hash,confirmationKey,humanConfirmed:true,
      });
      setSavedTask(output.task);setTasks(current=>[output.task,...current.filter(task=>task.id!==output.task.id)]);setSelection(null);setDraft(null);setHumanConfirmed(false);
    }catch(cause){setDraftError(cause instanceof Error?cause.message:'ยืนยันร่างไม่สำเร็จ');}
    finally{setDraftBusy(false);}
  }
  const assigneeName=(id:string)=>assignees.find(item=>item.user_id===id)?.name??'ผู้รับผิดชอบเดิม';

  return <section className="panel settlement-review-assistant" aria-labelledby="settlement-review-heading">
    <div className="settlement-review-header"><div><span className="eyebrow">ผู้ช่วยตรวจเงิน</span><h2 id="settlement-review-heading">สรุปรายการที่ควรตรวจ</h2><p>ระบบคำนวณยอดและหลักฐานก่อนเสมอ AI ช่วยจัดลำดับเท่านั้น การสร้างงานต้องให้ผู้ใช้ตรวจและยืนยัน</p></div><span className="review-readonly-badge"><CheckCircle2 size={15}/>AI อ่านอย่างเดียว</span></div>
    <div className="settlement-review-controls">
      <label>ตั้งแต่วันที่<input aria-label="วันเริ่มต้นสำหรับสรุป" type="date" value={from} max={to} disabled={busy} onChange={event=>setFrom(event.target.value)}/></label>
      <label>ถึงวันที่<input aria-label="วันสิ้นสุดสำหรับสรุป" type="date" value={to} min={from} max="2100-12-31" disabled={busy} onChange={event=>setTo(event.target.value)}/></label>
      <label>จำนวนที่แสดง<select aria-label="จำนวนรายการสำหรับสรุป" value={limit} disabled={busy} onChange={event=>setLimit(event.target.value)}><option value="5">5 รายการ</option><option value="10">10 รายการ</option><option value="20">20 รายการ</option><option value="50">50 รายการ</option></select></label>
      <div className="settlement-review-actions"><button type="button" className="button secondary" disabled={busy||!from||!to||from>to} onClick={()=>run('tool-preview')}><Clock3 size={16}/>{busy?'กำลังสรุป…':'สรุปจากข้อมูล'}</button>{liveEnabled&&<button type="button" className="button primary" disabled={busy||!from||!to||from>to} onClick={()=>run('live')}><Sparkles size={16}/>ช่วยจัดลำดับด้วย AI</button>}</div>
    </div>
    {!liveEnabled&&<p className="settlement-review-model-note"><Bot size={16}/>ยังไม่ได้เชื่อมโมเดล AI คุณยังสรุปจากข้อมูลและสร้างงานติดตามด้วยกติกาเดียวกันได้</p>}
    {error&&<p className="notice error" role="alert">{error} — รายการกระทบยอดและสรุปจากข้อมูลยังใช้งานได้</p>}
    {result&&<div className="settlement-review-result" role="status" aria-live="polite">
      <div className="settlement-review-result-heading"><div><span className={`pill ${result.source==='ai'?'neutral':'green'}`}>{result.source==='ai'?'AI ช่วยจัดลำดับ':'ผลจากระบบ ไม่ได้เรียก AI'}</span><h3>{result.headline}</h3></div><div className="settlement-review-result-links"><small>วิเคราะห์ {dateTime(result.evidence.analysedAt)}</small><Link className="text-link" href={`/settlements/reviews/${result.id}`}>เปิดประวัติฉบับนี้</Link></div></div>
      {result.facts.length?<div className="settlement-review-facts" aria-label="ข้อเท็จจริงจากระบบ">{result.facts.map((item,index)=><article key={item.exceptionId}><header><span>{index+1}</span><div><strong>{item.title}</strong><small>{kindLabel[item.kind]}{result.priorityExceptionIds.includes(item.exceptionId)?' · AI จัดเป็นรายการสำคัญ':''}</small></div></header><p>{item.detail}</p><details><summary>ดูรหัสหลักฐาน {item.evidenceReferences.length} รายการ</summary>{item.evidenceReferences.map(reference=><code key={reference}>{reference}</code>)}</details>{canManageTasks&&<button type="button" className="button secondary review-task-trigger" onClick={event=>selectFact(item,result,event)}><ClipboardCheck size={16}/>ร่างงานติดตาม</button>}</article>)}</div>:<div className="settlement-review-clear"><CheckCircle2 size={25}/><p>ช่วงเวลานี้ไม่มีข้อแตกต่างที่เครื่องมือระบุว่าต้องติดตาม ผลนี้ยังไม่ใช่การยืนยันว่าเงินเข้าธนาคารแล้ว</p></div>}
      {!!result.suggestions.length&&<div className="settlement-review-suggestions"><h3>ขั้นตอนตรวจต่อ</h3><ul>{result.suggestions.map(item=><li key={item}>{item}</li>)}</ul></div>}
      <details className="settlement-review-metadata"><summary>ที่มา เวลา และข้อจำกัด</summary><dl><div><dt>ข้อมูลล่าสุดจากต้นทาง</dt><dd>{dateTime(result.evidence.observedAt)}</dd></div><div><dt>นำเข้าล่าสุด</dt><dd>{dateTime(result.evidence.importedAt)}</dd></div><div><dt>ช่วงข้อมูล</dt><dd>{result.evidence.scope.period.from} ถึง {result.evidence.scope.period.to}</dd></div><div><dt>ผลลัพธ์</dt><dd>ทั้งหมด {result.evidence.results.total} · แสดง {result.evidence.results.shown}{result.evidence.results.truncated?' · ถูกจำกัดจำนวน':''}</dd></div></dl>{result.evidence.missingInputs.length>0&&<p><strong>ข้อมูลที่ยังขาด:</strong> {result.evidence.missingInputs.join(' · ')}</p>}{result.evidence.limitations.map(item=><p key={item}>{item}</p>)}<small>Workflow {result.versions.workflow} · Prompt {result.versions.prompt} · Tool {result.versions.tool} · Policy {result.versions.policy}</small></details>
    </div>}

    {selection&&<section className="review-task-composer" aria-labelledby="review-task-draft-heading">
      <div className="review-task-composer-heading"><div><span className="eyebrow">ผู้ใช้เป็นผู้ตัดสินใจ</span><h3 id="review-task-draft-heading" ref={draftHeadingRef} tabIndex={-1}>ร่างงานติดตาม</h3><p>{selection.fact.title}</p></div><button type="button" className="icon-button" aria-label="ปิดร่างงานติดตาม" disabled={draftBusy} onClick={()=>closeDraft()}><X size={18}/></button></div>
      <div className="review-task-source"><strong>หลักฐานที่อ้างอิง</strong><code>{selection.fact.exceptionId}</code><small>{selection.fact.detail}</small><span>{selection.fact.evidenceReferences.length} รายการอ้างอิง · ช่วง {selection.run.request.period.from} ถึง {selection.run.request.period.to}</span></div>
      <div className="review-task-fields"><label>ผู้รับผิดชอบ<select aria-label="ผู้รับผิดชอบงานติดตาม" value={assigneeId} disabled={draftBusy||!!draft} onChange={event=>changeDraftInput(()=>setAssigneeId(event.target.value))}>{assignees.map(item=><option key={item.user_id} value={item.user_id}>{item.name} · {item.role==='owner'?'เจ้าของ':'การเงิน'}</option>)}</select></label><label>เหตุผลและสิ่งที่ต้องตรวจ<textarea aria-label="เหตุผลของงานติดตาม" value={reason} minLength={3} maxLength={500} rows={3} disabled={draftBusy||!!draft} onChange={event=>changeDraftInput(()=>setReason(event.target.value))}/></label></div>
      <p className="review-task-impact"><strong>ผลของการยืนยัน:</strong> สร้างงานภายในและบันทึกผู้อนุมัติเท่านั้น ไม่แก้ยอด ไม่ซ่อนข้อแตกต่าง และไม่ยืนยันว่าเงินเข้าบัญชี</p>
      {draft&&<div className="review-task-preview"><span className="pill amber">รอผู้ใช้ยืนยัน</span><dl><div><dt>งาน</dt><dd>{draft.title}</dd></div><div><dt>ผู้รับผิดชอบ</dt><dd>{assigneeName(draft.assignee_id)}</dd></div><div><dt>หมดอายุ</dt><dd>{dateTime(draft.expires_at)}</dd></div><div><dt>รหัสร่าง</dt><dd><code>{draft.id}</code></dd></div></dl><label className="checkbox-label"><input type="checkbox" checked={humanConfirmed} disabled={draftBusy} onChange={event=>setHumanConfirmed(event.target.checked)}/>ฉันตรวจผู้รับผิดชอบ เหตุผล และหลักฐานแล้ว และยืนยันให้สร้างงานติดตามนี้</label></div>}
      {draftError&&<p className="notice error" role="alert">{draftError}</p>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={draftBusy} onClick={()=>closeDraft()}>ยกเลิก</button>{!draft?<button type="button" className="button primary" disabled={draftBusy||!assigneeId||reason.trim().length<3} onClick={createDraft}>{draftBusy?'กำลังตรวจหลักฐาน…':'ตรวจร่างก่อนยืนยัน'}</button>:<button type="button" className="button primary" disabled={draftBusy||!humanConfirmed} onClick={confirmDraft}>{draftBusy?'กำลังสร้างงาน…':'ยืนยันและสร้างงานติดตาม'}</button>}</div>
    </section>}
    {savedTask&&<p className="notice success" role="status">สร้างงานติดตามแล้ว <Link className="text-link" href={`/settlements/tasks/${savedTask.id}`}>เปิดงานและหลักฐาน</Link></p>}

    <section className="review-task-list" aria-labelledby="review-task-list-heading"><div className="review-task-list-heading"><div><span className="eyebrow">คิวติดตาม</span><h3 id="review-task-list-heading">งานจากข้อยกเว้นทางการเงิน</h3></div><span>{tasks.filter(task=>task.status==='open'||task.status==='in_progress').length} งานที่ยังเปิด</span></div>{tasks.length?<div className="review-task-rows">{tasks.map(task=><Link key={task.id} href={`/settlements/tasks/${task.id}`} className="review-task-row"><span><strong>{task.title}</strong><small>{assigneeName(task.assignee_id)} · อัปเดต {dateTime(task.updated_at)}</small></span><span><span className={`pill ${task.status==='resolved'?'green':task.status==='cancelled'?'neutral':'amber'}`}>{taskStatusLabel[task.status]}</span><ArrowRight size={16}/></span></Link>)}</div>:<p className="quiet-empty">ยังไม่มีงานติดตาม เมื่อพบข้อยกเว้นให้สรุปข้อมูลแล้วเลือกร่างงานจากรายการนั้น</p>}</section>
    <details className="settlement-review-history"><summary><span><strong>ประวัติการสรุป</strong><small>{displayedRuns.length} รายการล่าสุด</small></span><span>เปิดดู</span></summary><div>{displayedRuns.length?displayedRuns.map(run=><Link href={`/settlements/reviews/${run.id}`} className="settlement-review-history-row" key={run.id}><span><strong>{run.mode==='live'?'AI ช่วยจัดลำดับ':'สรุปจากข้อมูล'}</strong><small>{dateTime(run.created_at)} · {run.request.period.from} ถึง {run.request.period.to}</small></span><span className={`pill ${run.status==='succeeded'?'green':run.status==='failed'?'amber':'neutral'}`}>{run.status==='succeeded'?'สำเร็จ':run.status==='failed'?'ไม่สำเร็จ':'กำลังทำงาน'}</span></Link>):<p className="quiet-empty">ยังไม่มีประวัติการสรุป</p>}</div></details>
  </section>;
}
