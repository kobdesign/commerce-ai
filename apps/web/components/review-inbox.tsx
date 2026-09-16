'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight,CheckCircle2 } from 'lucide-react';
import type { CostReviewInbox } from '@commerce/imports';
import { money,request,toMinor } from '../lib/client';

const date=(value:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(`${value}T00:00:00+07:00`));
const inputMoney=(value:number|null)=>value===null?'':(value/100).toFixed(2);

export function ReviewInbox({tenantId,shopId,shopName,canWrite,inbox}:{tenantId:string;shopId:string;shopName:string;canWrite:boolean;inbox:CostReviewInbox}){
  const router=useRouter(),[costs,setCosts]=useState<Record<string,string>>(()=>Object.fromEntries(inbox.items.map(i=>[i.lineId,inputMoney(i.currentCostMinor)]))),[reasons,setReasons]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState('');
  async function resolve(lineId:string,version:number,orderId:string){
    setError('');setSaved('');setBusy(lineId);
    try{
      const costMinor=toMinor((costs[lineId]??'').trim()),reason=(reasons[lineId]??'').trim();
      if(reason.length<3)throw new Error('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
      await request(`/api/tenants/${tenantId}/reviews`,{shopId,lineId,version,costMinor,reason});
      setSaved(`ยืนยันต้นทุนของคำสั่งซื้อ ${orderId} แล้ว`);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'ยืนยันต้นทุนไม่สำเร็จ');}finally{setBusy('');}
  }
  const blocked=(lineId:string)=>!!busy||!(costs[lineId]??'').trim()||(reasons[lineId]??'').trim().length<3;
  return <>
    <div className="page-heading"><div><h1>รายการที่ต้องตรวจ</h1><p>{shopName} · รายการขายที่ยังคำนวณต้นทุนไม่ได้</p></div><Link className="button secondary" href="/performance">ดูเงินรับและต้นทุน <ArrowRight size={16}/></Link></div>
    <div className="review-context"><div><span>รอดำเนินการ</span><strong>{inbox.total}</strong><small>รายการ</small></div><p>ยืนยันเฉพาะต้นทุนที่ใช้กับรายการขายนี้ ข้อมูลจากไฟล์นำเข้าและประวัติเดิมจะไม่ถูกแก้ทับ</p></div>
    {!canWrite&&inbox.total>0&&<p className="notice">สิทธิ์ผู้ตรวจสอบเปิดดูหลักฐานได้ การยืนยันต้นทุนต้องใช้สิทธิ์เจ้าของหรือการเงิน</p>}
    {error&&<p className="notice error" role="alert">{error}</p>}
    {saved&&<p className="notice success" role="status">{saved}</p>}
    {!inbox.total?<section className="panel empty-state review-empty"><CheckCircle2 size={32}/><h2>ไม่มีรายการค้างตรวจ</h2><p>รายการขายที่นำเข้ามีต้นทุนครบ หรือได้รับการยืนยันย้อนหลังแล้ว</p><Link href="/performance" className="button secondary">กลับไปดูเงินรับและต้นทุน</Link></section>:<section className="panel table-panel"><div className="panel-heading review-heading"><div><h2>ต้นทุนที่ขาดจากวันที่ขาย</h2><p className="field-help">แสดงสูงสุด {inbox.limit} รายการล่าสุดจากทั้งหมด {inbox.total} รายการ</p></div></div><div className="table-scroll review-desktop"><table className="review-table"><thead><tr><th>คำสั่งซื้อ / สินค้า</th><th>วันที่ขาย</th><th className="numeric">จำนวน</th><th className="numeric">เงินรับสุทธิ</th><th>ต้นทุนต่อหน่วย</th><th>เหตุผลและหลักฐาน</th><th></th></tr></thead><tbody>{inbox.items.map(item=><tr key={item.lineId}><td><strong>{item.productName}</strong><code>{item.orderId} · {item.sku}</code></td><td>{date(item.soldOn)}</td><td className="numeric">{item.quantity}</td><td className="numeric">{money(item.netReceiptMinor)}</td><td>{canWrite?<label className="compact-field"><span className="sr-only">ต้นทุนต่อหน่วยของ {item.orderId}</span><input inputMode="decimal" aria-label={`ต้นทุนต่อหน่วยของ ${item.orderId}`} value={costs[item.lineId]??''} placeholder="0.00" disabled={!!busy} onChange={e=>setCosts({...costs,[item.lineId]:e.target.value})}/><small>บาท{item.currentCostMinor!==null?' · จากแค็ตตาล็อกปัจจุบัน':''}</small></label>:<span>{item.currentCostMinor===null?'—':money(item.currentCostMinor)}</span>}</td><td>{canWrite?<label className="compact-field reason-field"><span className="sr-only">เหตุผลของ {item.orderId}</span><input aria-label={`เหตุผลของ ${item.orderId}`} maxLength={500} value={reasons[item.lineId]??''} placeholder="เช่น ใบแจ้งต้นทุน lot ก.ย." disabled={!!busy} onChange={e=>setReasons({...reasons,[item.lineId]:e.target.value})}/><small>อย่างน้อย 3 ตัวอักษร</small></label>:<span className="muted">รอเจ้าของหรือการเงินยืนยัน</span>}<Link className="review-evidence" href={`/imports?draft=${item.draftId}`}>เปิดร่างต้นทาง</Link></td><td>{canWrite&&<button type="button" className="button small primary" disabled={blocked(item.lineId)} onClick={()=>void resolve(item.lineId,item.version,item.orderId)}>{busy===item.lineId?'กำลังบันทึก…':'ยืนยันต้นทุน'}</button>}</td></tr>)}</tbody></table></div><div className="review-mobile-list">{inbox.items.map(item=><article className="review-card" key={item.lineId}><header><strong>{item.productName}</strong><code>{item.orderId}</code><small>SKU {item.sku}</small></header><dl><div><dt>วันที่ขาย</dt><dd>{date(item.soldOn)}</dd></div><div><dt>จำนวน</dt><dd>{item.quantity}</dd></div><div><dt>เงินรับสุทธิ</dt><dd>{money(item.netReceiptMinor)}</dd></div></dl><Link className="review-evidence" href={`/imports?draft=${item.draftId}`}>เปิดร่างนำเข้า</Link>{canWrite?<div className="review-card-form"><label>ต้นทุนต่อหน่วย (บาท)<input inputMode="decimal" aria-label={`ต้นทุนต่อหน่วยของ ${item.orderId}`} value={costs[item.lineId]??''} placeholder="0.00" disabled={!!busy} onChange={e=>setCosts({...costs,[item.lineId]:e.target.value})}/>{item.currentCostMinor!==null&&<small>แนะนำจากแค็ตตาล็อกปัจจุบัน</small>}</label><label>เหตุผลที่ใช้ต้นทุนนี้ <span className="required-note">จำเป็น</span><input aria-label={`เหตุผลของ ${item.orderId}`} maxLength={500} value={reasons[item.lineId]??''} placeholder="เช่น ใบแจ้งต้นทุน lot ก.ย." disabled={!!busy} onChange={e=>setReasons({...reasons,[item.lineId]:e.target.value})}/><small>อย่างน้อย 3 ตัวอักษร</small></label><button type="button" className="button primary" disabled={blocked(item.lineId)} onClick={()=>void resolve(item.lineId,item.version,item.orderId)}>{busy===item.lineId?'กำลังบันทึก…':'ยืนยันต้นทุนรายการนี้'}</button></div>:<p className="notice">รอเจ้าของหรือการเงินยืนยันต้นทุน</p>}</article>)}</div></section>}
    <p className="review-footnote">การยืนยันจะสร้าง calculation version ใหม่ พร้อมผู้ดำเนินการ เวลา และเหตุผล เพื่อให้ตรวจสอบย้อนหลังได้</p>
  </>;
}
