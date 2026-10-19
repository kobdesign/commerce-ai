'use client';
import { useRef,useState } from 'react';
import { AlertTriangle,CheckCircle2,Clock3,PackageCheck,RotateCcw,ShieldCheck,UnlockKeyhole } from 'lucide-react';
import { inventoryReservationActionInput,inventoryReservationInput } from '@commerce/contracts';
import type { InventoryOverview,InventoryReservation } from '@commerce/domain';
import { request } from '../lib/client';

type Action='commit'|'release'|'expire'|'retry';
type Lifecycle={reservation:InventoryReservation;action:Action};
const statusLabels={reserved:'จองแล้ว',shortage:'ของไม่พอ',committed:'ตัดสินค้าแล้ว',released:'ปล่อยการจองแล้ว',expired:'หมดอายุ'} as const;
const actionLabels:Record<Action,string>={commit:'ตัดสินค้าออก',release:'ปล่อยการจอง',expire:'ปิดรายการหมดอายุ',retry:'ลองจองอีกครั้ง'};
function formatDate(value:string){return new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function expiry(hours:string){return new Date(Date.now()+Number(hours)*60*60*1000).toISOString();}

export function InventoryReservations({tenantId,shopId,overview,onReload}:{tenantId:string;shopId:string;overview:InventoryOverview;onReload:()=>Promise<void>}){
  const [variantId,setVariantId]=useState(overview.variants[0]?.id??''),[amount,setAmount]=useState(''),[reference,setReference]=useState(''),[hours,setHours]=useState('2'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[lifecycle,setLifecycle]=useState<Lifecycle|null>(null),[actionReason,setActionReason]=useState(''),[actionConfirmed,setActionConfirmed]=useState(false),[retryHours,setRetryHours]=useState('2');
  const errorRef=useRef<HTMLParagraphElement>(null);
  async function create(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();setError('');setMessage('');
    const parsed=inventoryReservationInput.safeParse({shopId,productId:overview.product.id,variantId,quantity:Number(amount),sourceReference:reference,expiresAt:expiry(hours),reason,confirmed});
    if(!parsed.success){setError(confirmed?'กรอก SKU จำนวน อ้างอิง อายุการจอง และเหตุผลให้ครบ':'กรุณายืนยันว่าตรวจข้อมูลการจองแล้ว');queueMicrotask(()=>errorRef.current?.focus());return;}
    setBusy(true);
    try{
      const saved=await request<{duplicate:boolean;status:'reserved'|'shortage'}>(`/api/tenants/${tenantId}/inventory-reservations`,parsed.data);
      await onReload();
      setMessage(saved.duplicate?'คำขอนี้เคยบันทึกแล้ว ระบบจึงไม่จองซ้ำ':saved.status==='shortage'?'บันทึกเป็นของไม่พอแล้ว โดยยังไม่ตัดหรือจองสต็อก':'จองสต็อกภายในแล้ว ยอดพร้อมขายถูกลดลง');
      if(!saved.duplicate){setAmount('');setReference('');setReason('');setConfirmed(false);}
    }catch(cause){setError(cause instanceof Error?cause.message:'สร้างการจองไม่สำเร็จ');queueMicrotask(()=>errorRef.current?.focus());}
    finally{setBusy(false);}
  }
  function open(reservation:InventoryReservation,action:Action){setLifecycle({reservation,action});setActionReason('');setActionConfirmed(false);setError('');setMessage('');}
  async function transition(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();if(!lifecycle)return;setError('');
    const candidate={shopId,productId:overview.product.id,version:lifecycle.reservation.version,action:lifecycle.action,reason:actionReason,confirmed:actionConfirmed,...(lifecycle.action==='retry'?{expiresAt:expiry(retryHours)}:{})};
    const parsed=inventoryReservationActionInput.safeParse(candidate);
    if(!parsed.success){setError(actionConfirmed?'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร':'กรุณายืนยันว่าตรวจผลของคำสั่งแล้ว');return;}
    setBusy(true);
    try{
      const saved=await request<{status:InventoryReservation['status']}>(`/api/tenants/${tenantId}/inventory-reservations/${lifecycle.reservation.id}`,parsed.data,'PATCH');
      await onReload();setLifecycle(null);setMessage(saved.status==='shortage'?'ยังมีสินค้าไม่พอ ระบบไม่ได้สร้างยอดจอง':`${actionLabels[lifecycle.action]}เรียบร้อยแล้ว`);
    }catch(cause){setError(cause instanceof Error?cause.message:'เปลี่ยนสถานะการจองไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  return <section className="inventory-reservations-section" aria-labelledby="inventory-reservations-title">
    <div className="inventory-reservations-heading"><div><span>คำสั่งภายใน · ผู้ใช้ยืนยันทุกครั้ง</span><h2 id="inventory-reservations-title">การจองสต็อก</h2><p>การจองลดเฉพาะยอดพร้อมขาย การตัดสินค้าออกจึงลดของจริง</p></div><ShieldCheck size={21}/></div>
    {message&&<p className="notice success" role="status"><CheckCircle2 size={16}/>{message}</p>}
    <div className="inventory-reservations-layout">
      {overview.canWrite&&<form className="panel inventory-reservation-form" onSubmit={create}><h3>สร้างการจองภายใน</h3><p className="field-help">ใช้กับคำสั่งซื้อหรือการกันสินค้าเฉพาะรายการที่ตรวจแล้ว</p><fieldset disabled={busy} className="inventory-fieldset"><label>SKU<select aria-label="SKU ที่ต้องการจอง" value={variantId} onChange={event=>setVariantId(event.target.value)}>{overview.variants.map(row=><option key={row.id} value={row.id}>{row.sku} · พร้อมขาย {row.onHand-row.reserved}</option>)}</select></label><div className="inventory-reservation-fields"><label>จำนวน<input aria-label="จำนวนที่ต้องการจอง" inputMode="numeric" pattern="[0-9]*" required value={amount} onChange={event=>setAmount(event.target.value.replace(/\D/g,''))} placeholder="เช่น 2"/></label><label>อายุการจอง<select aria-label="อายุการจอง" value={hours} onChange={event=>setHours(event.target.value)}><option value="0.5">30 นาที</option><option value="2">2 ชั่วโมง</option><option value="24">24 ชั่วโมง</option><option value="168">7 วัน</option></select></label></div><label>รหัสคำสั่งซื้อหรืออ้างอิง<input aria-label="รหัสอ้างอิงการจอง" required maxLength={160} value={reference} onChange={event=>setReference(event.target.value)} placeholder="เช่น ORDER-2026-001"/></label><label>เหตุผล<textarea aria-label="เหตุผลของการจอง" required minLength={3} maxLength={500} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="เช่น ลูกค้าชำระเงินแล้ว รอตรวจที่อยู่"/></label><label className="inventory-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span><strong>ฉันตรวจ SKU จำนวน และรหัสอ้างอิงแล้ว</strong><small>หากของไม่พอ ระบบจะเก็บเป็นรายการติดตามโดยไม่สร้างยอดจอง</small></span></label></fieldset>{error&&!lifecycle&&<p ref={errorRef} className="notice error" role="alert" tabIndex={-1}>{error}</p>}<button className="button primary inventory-submit" disabled={busy} type="submit">{busy?'กำลังตรวจสต็อก…':'สร้างการจอง'}</button></form>}
      <div className="panel inventory-reservation-list"><div className="panel-heading"><div><h3>รายการจองและของไม่พอ</h3><p>{overview.reservations.length} รายการล่าสุด</p></div></div>{overview.reservations.length?<div className="inventory-reservation-records">{overview.reservations.map(item=>{const due=item.status==='reserved'&&new Date(item.expiresAt)<=new Date();return <article key={item.id} className={`inventory-reservation-record ${item.status}`}><header><div>{item.status==='shortage'?<AlertTriangle size={17}/>:<Clock3 size={17}/>}<span><strong>{item.sourceReference}</strong><small><code>{item.sku}</code> · {item.requestedQuantity} {overview.product.salesUnit}</small></span></div><span className={`pill reservation-${item.status}`}>{statusLabels[item.status]}</span></header><dl><div><dt>หมดอายุ</dt><dd>{formatDate(item.expiresAt)}</dd></div><div><dt>เหตุผล</dt><dd>{item.reason}</dd></div>{item.resolutionReason&&<div><dt>ผลการดำเนินการ</dt><dd>{item.resolutionReason}</dd></div>}</dl>{overview.canWrite&&<div className="inventory-reservation-actions">{item.status==='reserved'&&!due&&<button type="button" className="button primary small" onClick={()=>open(item,'commit')}><PackageCheck size={14}/>ตัดสินค้าออก</button>}{item.status==='reserved'&&<button type="button" className="button secondary small" onClick={()=>open(item,due?'expire':'release')}>{due?<Clock3 size={14}/>:<UnlockKeyhole size={14}/>} {due?'ปิดรายการหมดอายุ':'ปล่อยการจอง'}</button>}{['shortage','expired'].includes(item.status)&&<button type="button" className="button secondary small" onClick={()=>open(item,'retry')}><RotateCcw size={14}/>ลองจองอีกครั้ง</button>}</div>}</article>;})}</div>:<div className="quiet-empty"><Clock3 size={24}/><p>ยังไม่มีการจองหรือรายการของไม่พอ</p></div>}</div>
    </div>
    {lifecycle&&<div className="catalog-dialog-backdrop" role="presentation"><section className="catalog-dialog reservation-dialog" role="dialog" aria-modal="true" aria-labelledby="reservation-action-title"><h2 id="reservation-action-title">{actionLabels[lifecycle.action]}</h2><p><code>{lifecycle.reservation.sourceReference}</code> · {lifecycle.reservation.sku} · {lifecycle.reservation.requestedQuantity} {overview.product.salesUnit}</p><form onSubmit={transition}>{lifecycle.action==='retry'&&<label>อายุการจองใหม่<select aria-label="อายุการจองใหม่" value={retryHours} onChange={event=>setRetryHours(event.target.value)}><option value="0.5">30 นาที</option><option value="2">2 ชั่วโมง</option><option value="24">24 ชั่วโมง</option><option value="168">7 วัน</option></select></label>}<label>เหตุผล<textarea aria-label="เหตุผลที่เปลี่ยนสถานะการจอง" required minLength={3} maxLength={500} rows={3} value={actionReason} onChange={event=>setActionReason(event.target.value)} placeholder={lifecycle.action==='commit'?'เช่น แพ็กสินค้าออกจากคลังแล้ว':'ระบุสิ่งที่ตรวจสอบและเหตุผล'}/></label><label className="inventory-confirm"><input type="checkbox" checked={actionConfirmed} onChange={event=>setActionConfirmed(event.target.checked)}/><span><strong>ฉันตรวจผลที่จะเกิดกับยอดสต็อกแล้ว</strong><small>{lifecycle.action==='commit'?'ของจริงและยอดจองจะลดพร้อมกัน':'ระบบจะบันทึกผู้ยืนยัน เวลา และเหตุผล'}</small></span></label>{error&&<p className="notice error" role="alert">{error}</p>}<div className="catalog-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>{setError('');setLifecycle(null);}}>ยกเลิก</button><button type="submit" className="button primary" disabled={busy}>{busy?'กำลังบันทึก…':actionLabels[lifecycle.action]}</button></div></form></section></div>}
  </section>;
}
