'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useRef,useState } from 'react';
import { ArrowRight,CheckCircle2,RotateCcw,X } from 'lucide-react';
import type { FinancialEventItem,FinancialEventLedger,FinancialEventType } from '@commerce/finance';
import { money,request,toMinor } from '../lib/client';

const labels:Record<FinancialEventType,string>={refund:'คืนเงินให้ลูกค้า',fee_rebate:'เครดิตค่าธรรมเนียมคืน'};
const date=(value:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(`${value}T00:00:00+07:00`));
const isNegative=(item:FinancialEventItem)=>item.reversesEventId?item.eventType==='fee_rebate':item.eventType==='refund';

function EventStatus({item}:{item:FinancialEventItem}){
  if(item.reversesEventId)return <><span className="pill neutral">รายการแก้กลับ</span><small>อ้างอิงรายการเดิม</small></>;
  if(item.reversedByEventId)return <span className="pill neutral">ถูกแก้กลับแล้ว</span>;
  if(item.matchedLineCount)return <span className="pill green">จับคู่ {item.matchedLineCount} รายการ</span>;
  return <span className="pill amber">รอตรวจสอบ</span>;
}

export function FinancialEventWorkspace({tenantId,shopId,shopName,canWrite,today,ledger}:{tenantId:string;shopId:string;shopName:string;canWrite:boolean;today:string;ledger:FinancialEventLedger}){
  const router=useRouter(),[eventType,setEventType]=useState<FinancialEventType>('refund'),[sourceEventId,setSourceEventId]=useState(''),[orderId,setOrderId]=useState(''),[occurredOn,setOccurredOn]=useState(today),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const [reversing,setReversing]=useState<FinancialEventItem|null>(null),[reversalDate,setReversalDate]=useState(today),[reversalNote,setReversalNote]=useState(''),[reversalConfirmed,setReversalConfirmed]=useState(false),[reversalBusy,setReversalBusy]=useState(false),[reversalError,setReversalError]=useState(''),[reversalSaved,setReversalSaved]=useState('');
  const reversalNoteRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    if(reversing){
      document.getElementById('reversal-entry')?.scrollIntoView({block:'center'});
      reversalNoteRef.current?.focus();
    }
  },[reversing]);

  async function submit(event:React.FormEvent){
    event.preventDefault();setError('');setSaved('');setBusy(true);
    try{
      const amountMinor=toMinor(amount.trim());if(amountMinor<=0)throw new Error('จำนวนเงินต้องมากกว่า 0 บาท');
      const result=await request<{duplicate:boolean;matchedLineCount:number}>(`/api/tenants/${tenantId}/financial-events`,{shopId,sourceEventId:sourceEventId.trim(),orderId:orderId.trim(),eventType,occurredOn,amountMinor,note:note.trim(),confirmedOutsideImportedReceipt:confirmed});
      setSaved(result.duplicate?'รายการต้นทางนี้ถูกบันทึกไว้แล้ว ระบบไม่ได้เพิ่มยอดซ้ำ':result.matchedLineCount?`บันทึกรายการแล้ว จับคู่กับคำสั่งซื้อ ${orderId.trim()} จำนวน ${result.matchedLineCount} รายการ`:`บันทึกรายการแล้ว แต่ยังไม่พบคำสั่งซื้อ ${orderId.trim()} รายการนี้รอตรวจสอบและยังไม่รวมในยอดที่จับคู่แล้ว`);
      if(!result.duplicate){setSourceEventId('');setOrderId('');setAmount('');setNote('');setConfirmed(false);}router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'บันทึกรายการไม่สำเร็จ');}finally{setBusy(false);}
  }

  function selectReversal(item:FinancialEventItem){
    setReversing(item);setReversalDate(today);setReversalNote('');setReversalConfirmed(false);setReversalError('');setReversalSaved('');
  }

  async function submitReversal(event:React.FormEvent){
    event.preventDefault();if(!reversing)return;setReversalError('');setReversalSaved('');setReversalBusy(true);
    try{
      const result=await request<{duplicate:boolean}>(`/api/tenants/${tenantId}/financial-events/${reversing.id}/reverse`,{shopId,occurredOn:reversalDate,note:reversalNote.trim(),confirmedCorrection:reversalConfirmed});
      setReversalSaved(result.duplicate?'รายการแก้กลับนี้ถูกบันทึกไว้แล้ว ระบบไม่ได้เพิ่มยอดซ้ำ':`แก้กลับรายการ ${reversing.sourceEventId} แล้ว ยอดเดิมยังคงอยู่ในประวัติ`);setReversing(null);router.refresh();
    }catch(e){setReversalError(e instanceof Error?e.message:'แก้กลับรายการไม่สำเร็จ');}finally{setReversalBusy(false);}
  }

  return <>
    <div className="page-heading"><div><h1>คืนเงินและปรับยอด</h1><p>{shopName} · เหตุการณ์หลังการขายที่อยู่นอกยอดเงินรับในไฟล์เดิม</p></div><Link className="button secondary" href="/performance">ดูผลต่อเงินรับ <ArrowRight size={16}/></Link></div>
    <section className="summary-strip adjustment-overview" aria-label="สรุปรายการปรับยอด"><div><span>รายการทั้งหมด</span><strong>{ledger.summary.total}<small>รายการ</small></strong></div><div><span>จับคู่คำสั่งซื้อแล้ว</span><strong>{ledger.summary.matched}<small>รายการ</small></strong></div><div><span>รอตรวจสอบ</span><strong className={ledger.summary.unmatched?'text-error':''}>{ledger.summary.unmatched}<small>รายการ</small></strong></div><div><span>ผลต่อเงินรับที่จับคู่แล้ว</span><strong className={ledger.summary.netAdjustmentMinor<0?'text-error':''}>{ledger.summary.netAdjustmentMinor>=0?'+':''}{money(ledger.summary.netAdjustmentMinor)}</strong></div></section>
    {reversalSaved&&<p className="notice success" role="status">{reversalSaved}</p>}
    {ledger.summary.unmatched>0&&<p className="notice error"><strong>มี {ledger.summary.unmatched} รายการที่ยังไม่พบคำสั่งซื้อ</strong><br/>ระบบเก็บหลักฐานไว้ แต่ยังไม่รวมรายการเหล่านี้ในยอดเงินรับที่จับคู่แล้ว กรุณาตรวจเลขคำสั่งซื้อหรือรอนำเข้ารายการขายต้นทาง</p>}
    {!canWrite&&<p className="notice">สิทธิ์ผู้ตรวจสอบเปิดดูรายการและหลักฐานได้ การบันทึกรายการใหม่ต้องใช้สิทธิ์เจ้าของหรือการเงิน</p>}
    {canWrite&&<section className="panel financial-event-entry"><div><h2>บันทึกเหตุการณ์</h2><p className="field-help">ใช้เฉพาะยอดคืนเงินหรือเครดิตที่เกิดหลังข้อมูลขายเดิมและยังไม่รวมใน “เงินรับสุทธิ” ที่นำเข้าแล้ว ระบบจะไม่แก้รายการขายเดิม</p></div><form onSubmit={submit}><div className="financial-event-fields"><label>ประเภทเหตุการณ์<select value={eventType} disabled={busy} onChange={e=>setEventType(e.target.value as FinancialEventType)}><option value="refund">คืนเงินให้ลูกค้า</option><option value="fee_rebate">เครดิตค่าธรรมเนียมคืน</option></select></label><label>วันที่เกิดเหตุการณ์<input type="date" value={occurredOn} max="2100-12-31" required disabled={busy} onChange={e=>setOccurredOn(e.target.value)}/></label><label>รหัสรายการต้นทาง<input aria-label="รหัสรายการต้นทาง" value={sourceEventId} maxLength={150} required placeholder="เช่น REFUND-20260916-001" disabled={busy} onChange={e=>setSourceEventId(e.target.value)}/><span className="field-help">ต้องคงที่และไม่ซ้ำต่อร้าน เพื่อป้องกันบันทึกซ้ำ</span></label><label>เลขคำสั่งซื้อ<input value={orderId} maxLength={100} required placeholder="เลขเดียวกับรายงานยอดขาย" disabled={busy} onChange={e=>setOrderId(e.target.value)}/></label><label>จำนวนเงิน (บาท)<input aria-label="จำนวนเงิน (บาท)" inputMode="decimal" value={amount} required placeholder="0.00" disabled={busy} onChange={e=>setAmount(e.target.value)}/><span className="field-help">กรอกเป็นจำนวนบวก ระบบกำหนดเครื่องหมายจากประเภทเหตุการณ์</span></label><label className="full-width">เหตุผลหรือหลักฐาน<input value={note} minLength={3} maxLength={500} required placeholder="เช่น ลูกค้าได้รับคืนบางส่วนและยังเก็บสินค้า" disabled={busy} onChange={e=>setNote(e.target.value)}/></label></div><label className="checkbox-label financial-scope-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>ฉันตรวจแล้วว่ายอดนี้ยังไม่รวมอยู่ในเงินรับสุทธิที่นำเข้าไว้ จึงไม่ทำให้หักหรือบวกซ้ำ</label>{error&&<p className="notice error" role="alert">{error}</p>}{saved&&<p className="notice success" role="status">{saved}</p>}<div className="form-actions"><button type="submit" className="button primary" disabled={busy||!confirmed||!sourceEventId.trim()||!orderId.trim()||!occurredOn||!amount.trim()||note.trim().length<3}>{busy?'กำลังบันทึก…':'บันทึกรายการปรับยอด'}</button></div></form></section>}
    {canWrite&&reversing&&<section className="panel reversal-entry" id="reversal-entry" aria-labelledby="reversal-heading"><div className="reversal-heading"><div><span className="eyebrow">แก้ไขโดยไม่ลบประวัติ</span><h2 id="reversal-heading">แก้กลับรายการ</h2><p>ระบบจะสร้างรายการตรงข้ามในจำนวน {money(reversing.amountMinor)} สำหรับคำสั่งซื้อ <code>{reversing.orderId}</code></p></div><button type="button" className="icon-button" aria-label="ยกเลิกการแก้กลับ" disabled={reversalBusy} onClick={()=>setReversing(null)}><X size={18}/></button></div><dl className="reversal-source"><div><dt>รายการเดิม</dt><dd>{labels[reversing.eventType]}</dd></div><div><dt>รหัสต้นทางเดิม</dt><dd><code>{reversing.sourceEventId}</code></dd></div><div><dt>ผลของรายการแก้กลับ</dt><dd>{reversing.eventType==='refund'?'+':'-'}{money(reversing.amountMinor)}</dd></div></dl><form onSubmit={submitReversal}><p className="system-reference-note">ระบบจะสร้างรหัสรายการแก้กลับให้อัตโนมัติและผูกกับรายการเดิม</p><div className="financial-event-fields"><label>วันที่แก้กลับ<input type="date" value={reversalDate} max="2100-12-31" required disabled={reversalBusy} onChange={e=>setReversalDate(e.target.value)}/></label><label>เหตุผลที่แก้กลับ<input ref={reversalNoteRef} value={reversalNote} minLength={3} maxLength={500} required placeholder="เช่น บันทึกยอดซ้ำจากเอกสารต้นทาง" disabled={reversalBusy} onChange={e=>setReversalNote(e.target.value)}/></label></div><label className="checkbox-label financial-scope-confirm"><input type="checkbox" checked={reversalConfirmed} disabled={reversalBusy} onChange={e=>setReversalConfirmed(e.target.checked)}/>ฉันยืนยันว่าต้องการยกเลิกผลของรายการนี้ โดยเก็บรายการเดิมไว้ในประวัติ</label>{reversalError&&<p className="notice error" role="alert">{reversalError}</p>}<div className="form-actions"><button type="button" className="button secondary" disabled={reversalBusy} onClick={()=>setReversing(null)}>ยกเลิก</button><button type="submit" className="button primary" disabled={reversalBusy||!reversalConfirmed||!reversalDate||reversalNote.trim().length<3}>{reversalBusy?'กำลังแก้กลับ…':'ยืนยันการแก้กลับ'}</button></div></form></section>}
    {!ledger.items.length?<section className="panel empty-state adjustment-empty"><CheckCircle2 size={30}/><h2>ยังไม่มีรายการปรับยอด</h2><p>เมื่อเกิด refund หรือเครดิตค่าธรรมเนียมหลังการขาย รายการที่บันทึกจะแสดงพร้อมสถานะการจับคู่ที่นี่</p></section>:<section className="panel table-panel adjustment-history"><div className="panel-heading adjustment-heading"><div><h2>ประวัติรายการปรับยอด</h2><p className="field-help">ล่าสุด {ledger.limit} รายการ · ข้อมูลเป็น append-only</p></div></div><div className="table-scroll adjustment-desktop"><table><thead><tr><th>วันที่ / ประเภท</th><th>คำสั่งซื้อ</th><th className="numeric">จำนวนเงิน</th><th>สถานะ</th><th>หลักฐาน</th>{canWrite&&<th>การทำงาน</th>}</tr></thead><tbody>{ledger.items.map(item=><tr key={item.id}><td><strong>{item.reversesEventId?'แก้กลับ · ':''}{labels[item.eventType]}</strong><small>{date(item.occurredOn)}</small></td><td><code>{item.orderId}</code></td><td className={`numeric ${isNegative(item)?'text-error':''}`}>{isNegative(item)?'-':'+'}{money(item.amountMinor)}</td><td className="adjustment-status"><EventStatus item={item}/></td><td className="adjustment-evidence"><strong>{item.note}</strong><code>{item.sourceEventId}</code></td>{canWrite&&<td>{!item.reversesEventId&&!item.reversedByEventId?<button type="button" className="text-button reversal-action" onClick={()=>selectReversal(item)}><RotateCcw size={15}/>แก้กลับรายการ</button>:<span className="muted">—</span>}</td>}</tr>)}</tbody></table></div><div className="adjustment-mobile-list">{ledger.items.map(item=><article className="adjustment-card" key={item.id}><header><div><strong>{item.reversesEventId?'แก้กลับ · ':''}{labels[item.eventType]}</strong><small>{date(item.occurredOn)}</small></div><strong className={isNegative(item)?'text-error':''}>{isNegative(item)?'-':'+'}{money(item.amountMinor)}</strong></header><div className="adjustment-card-status"><EventStatus item={item}/></div><dl><div><dt>คำสั่งซื้อ</dt><dd><code>{item.orderId}</code></dd></div><div><dt>หลักฐาน</dt><dd>{item.note}</dd></div></dl><code className="adjustment-card-reference">{item.sourceEventId}</code>{canWrite&&!item.reversesEventId&&!item.reversedByEventId&&<button type="button" className="button secondary adjustment-card-action" onClick={()=>selectReversal(item)}><RotateCcw size={16}/>แก้กลับรายการ</button>}</article>)}</div></section>}
    <p className="review-footnote">รายการทั้งหมดเป็น append-only ระบบไม่แก้ไขหรือลบหลักฐานเดิม รายการแก้กลับสร้างได้หนึ่งครั้งต่อรายการต้นทาง</p>
  </>;
}
