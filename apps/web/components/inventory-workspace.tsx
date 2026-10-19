'use client';
import Link from 'next/link';
import { useMemo,useRef,useState } from 'react';
import { ArrowDownToLine,ArrowLeft,ArrowUpFromLine,Boxes,CheckCircle2,History,ShieldCheck,Warehouse } from 'lucide-react';
import { inventoryMovementInput,type InventoryLedgerMovementType,type InventoryMovementType } from '@commerce/contracts';
import type { InventoryOverview } from '@commerce/domain';
import { request } from '../lib/client';
import { InventoryReservations } from './inventory-reservations';

const movementLabels:Record<InventoryLedgerMovementType,string>={opening:'ตั้งยอดเริ่มต้น',receipt:'รับสินค้าเข้า',adjustment_in:'ปรับเพิ่มจากการตรวจนับ',adjustment_out:'ปรับลดจากการตรวจนับ',sale_commit:'ตัดสินค้าออกตามการจอง'};
function quantity(value:number){return new Intl.NumberFormat('th-TH').format(value);}
function formatDate(value:string){return new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}

export function InventoryWorkspace({tenantId,shopId,initialOverview}:{tenantId:string;shopId:string;initialOverview:InventoryOverview}){
  const [overview,setOverview]=useState(initialOverview),[variantId,setVariantId]=useState(initialOverview.variants[0]?.id??''),[movementType,setMovementType]=useState<InventoryMovementType>('receipt');
  const [amount,setAmount]=useState(''),[reference,setReference]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const errorRef=useRef<HTMLParagraphElement>(null);
  const totals=useMemo(()=>overview.variants.reduce((sum,row)=>({onHand:sum.onHand+row.onHand,reserved:sum.reserved+row.reserved}),{onHand:0,reserved:0}),[overview.variants]);
  const selected=overview.variants.find(row=>row.id===variantId);
  async function reload(){
    const response=await fetch(`/api/tenants/${tenantId}/inventory?${new URLSearchParams({shopId,productId:overview.product.id})}`,{cache:'no-store'});
    const data=await response.json() as InventoryOverview&{error?:string};
    if(!response.ok)throw new Error(data.error??'โหลดสต็อกล่าสุดไม่สำเร็จ');
    setOverview(data);
  }
  async function submit(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();setError('');setMessage('');
    const parsed=inventoryMovementInput.safeParse({shopId,productId:overview.product.id,variantId,movementType,quantity:Number(amount),sourceReference:reference,reason,confirmed});
    if(!parsed.success){setError(confirmed?'กรอกจำนวน รหัสอ้างอิง และเหตุผลให้ครบ':'กรุณายืนยันว่าตรวจเอกสารและจำนวนแล้ว');queueMicrotask(()=>errorRef.current?.focus());return;}
    setBusy(true);
    try{
      const saved=await request<{duplicate:boolean;onHand:number}>(`/api/tenants/${tenantId}/inventory`,parsed.data);
      await reload();
      setMessage(saved.duplicate?'รายการนี้เคยบันทึกแล้ว ระบบจึงไม่เพิ่มยอดซ้ำ':`บันทึก ${movementLabels[movementType]} แล้ว ยอดคงเหลือ SKU นี้ ${quantity(saved.onHand)} ${overview.product.salesUnit}`);
      if(!saved.duplicate){setAmount('');setReference('');setReason('');setConfirmed(false);}
    }catch(cause){setError(cause instanceof Error?cause.message:'บันทึกสต็อกไม่สำเร็จ');queueMicrotask(()=>errorRef.current?.focus());}
    finally{setBusy(false);}
  }
  return <>
    <div className="page-heading inventory-heading"><div><span className="inventory-eyebrow">สต็อกระดับบริษัท · {overview.location?.name??'คลังหลัก'}</span><h1>{overview.product.name}</h1><p>{overview.variants.length} SKU · หน่วยนับ {overview.product.salesUnit}</p></div><Link className="button secondary" href="/catalog"><ArrowLeft size={16}/>กลับไปสินค้า</Link></div>
    <section className="inventory-boundary-note" aria-label="ขอบเขตการทำงานของสต็อก"><ShieldCheck size={20}/><div><strong>ยอดนี้เป็นสมุดสต็อกกลางของบริษัท</strong><p>ใช้ร่วมกันทุกช่องทางขาย การจองในหน้านี้เป็นคำสั่งภายในที่ผู้ใช้ยืนยัน ยังไม่รับออเดอร์หรือส่งยอดไป TikTok Shop, Shopee หรือ Lazada อัตโนมัติ</p></div></section>
    <section className="inventory-summary" aria-label="สรุปสต็อก"><article><span>คงเหลือจริง</span><strong>{quantity(totals.onHand)}</strong><small>{overview.product.salesUnit}</small></article><article><span>จองแล้ว</span><strong>{quantity(totals.reserved)}</strong><small>การจองภายใน</small></article><article><span>พร้อมขาย</span><strong>{quantity(totals.onHand-totals.reserved)}</strong><small>{overview.product.salesUnit}</small></article><article><span>คลังที่นับยอด</span><strong className="inventory-location"><Warehouse size={20}/>{overview.location?.name??'คลังหลัก'}</strong><small>คลังเดียวในระยะแรก</small></article></section>
    {message&&<p className="notice success" role="status"><CheckCircle2 size={16}/>{message}</p>}
    <div className="inventory-layout">
      <section className="panel inventory-stock-panel"><div className="panel-heading"><div><h2>ยอดตาม SKU</h2><p>พร้อมขาย = คงเหลือจริง − จองแล้ว</p></div><Boxes size={19}/></div><div className="table-scroll"><table className="inventory-table"><thead><tr><th>SKU</th><th>ตัวเลือก</th><th className="numeric">คงเหลือจริง</th><th className="numeric">จองแล้ว</th><th className="numeric">พร้อมขาย</th></tr></thead><tbody>{overview.variants.map(row=><tr key={row.id}><td><code>{row.sku}</code>{row.archived&&<small className="inventory-archived">หยุดขาย</small>}</td><td>{Object.entries(row.attributes).map(([key,value])=>`${key}: ${value}`).join(' / ')||'—'}</td><td className="numeric">{quantity(row.onHand)}</td><td className="numeric">{quantity(row.reserved)}</td><td className="numeric"><strong>{quantity(row.onHand-row.reserved)}</strong></td></tr>)}</tbody></table></div></section>
      {overview.canWrite&&<section className="panel inventory-form-panel"><div className="panel-heading"><div><h2>บันทึกรายการสต็อก</h2><p>ทุกรายการเก็บเป็นประวัติและแก้ย้อนหลังไม่ได้</p></div></div><form onSubmit={submit}><fieldset disabled={busy} className="inventory-fieldset"><label>SKU<select aria-label="SKU ที่ต้องการบันทึก" value={variantId} onChange={event=>setVariantId(event.target.value)}>{overview.variants.map(row=><option key={row.id} value={row.id}>{row.sku} · คงเหลือ {quantity(row.onHand)}</option>)}</select></label><label>ประเภทรายการ<select aria-label="ประเภทรายการสต็อก" value={movementType} onChange={event=>setMovementType(event.target.value as InventoryMovementType)}><option value="receipt">รับสินค้าเข้า</option><option value="opening">ตั้งยอดเริ่มต้น</option><option value="adjustment_in">ปรับเพิ่มจากการตรวจนับ</option><option value="adjustment_out">ปรับลดจากการตรวจนับ</option></select></label><label>จำนวน ({overview.product.salesUnit})<input aria-label="จำนวนสินค้า" inputMode="numeric" pattern="[0-9]*" min="1" max="1000000" required value={amount} onChange={event=>setAmount(event.target.value.replace(/\D/g,''))} placeholder="เช่น 50"/><small className="field-help">กรอกเป็นจำนวนบวก ระบบจะคำนวณทิศทางจากประเภทรายการ</small></label><label>รหัสอ้างอิงเอกสาร<input aria-label="รหัสอ้างอิงเอกสาร" required maxLength={160} value={reference} onChange={event=>setReference(event.target.value)} placeholder="เช่น PO-2026-001 หรือ COUNT-2026-10-18"/><small className="field-help">SKU เดียวกันใช้รหัสเดิมซ้ำไม่ได้ ช่วยป้องกันการเพิ่มยอดสองครั้ง</small></label><label>เหตุผล<textarea aria-label="เหตุผลของรายการสต็อก" required minLength={3} maxLength={500} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="เช่น รับสินค้าจากโรงงานตามใบส่งของ"/></label><label className="inventory-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span><strong>ฉันตรวจ SKU จำนวน และเอกสารอ้างอิงแล้ว</strong><small>การยืนยันนี้จะถูกเก็บพร้อมผู้บันทึกและเวลา</small></span></label></fieldset>{selected&&movementType==='adjustment_out'&&<p className="inventory-preview"><ArrowUpFromLine size={16}/>หลังบันทึกจะเหลือ {Math.max(0,selected.onHand-(Number(amount)||0))} {overview.product.salesUnit}</p>}{movementType!=='adjustment_out'&&amount&&<p className="inventory-preview"><ArrowDownToLine size={16}/>หลังบันทึกจะมี {(selected?.onHand??0)+(Number(amount)||0)} {overview.product.salesUnit}</p>}{error&&<p ref={errorRef} className="notice error" role="alert" tabIndex={-1}>{error}</p>}<button className="button primary inventory-submit" disabled={busy} type="submit">{busy?'กำลังบันทึก…':'ยืนยันบันทึกรายการ'}</button></form></section>}
    </div>
    <InventoryReservations tenantId={tenantId} shopId={shopId} overview={overview} onReload={reload}/>
    <section className="panel inventory-history"><div className="panel-heading"><div><h2>ประวัติการเคลื่อนไหว</h2><p>แสดง 100 รายการล่าสุดของสินค้านี้</p></div><History size={19}/></div>{overview.movements.length?<div className="table-scroll"><table><thead><tr><th>วันเวลา</th><th>SKU</th><th>รายการ</th><th>อ้างอิง</th><th>เหตุผล</th><th className="numeric">เปลี่ยนแปลง</th><th className="numeric">ยอดหลังรายการ</th></tr></thead><tbody>{overview.movements.map(row=><tr key={row.id}><td>{formatDate(row.confirmedAt)}</td><td><code>{row.sku}</code></td><td>{movementLabels[row.movementType]}</td><td><code>{row.sourceReference}</code></td><td>{row.reason}</td><td className={`numeric ${row.quantityDelta>0?'inventory-in':'inventory-out'}`}>{row.quantityDelta>0?'+':''}{quantity(row.quantityDelta)}</td><td className="numeric">{quantity(row.balanceAfter)}</td></tr>)}</tbody></table></div>:<div className="quiet-empty"><Warehouse size={25}/><p>ยังไม่มีรายการเคลื่อนไหว เริ่มจากตั้งยอดเริ่มต้นหรือรับสินค้าเข้า</p></div>}</section>
  </>;
}
