'use client';
import Link from 'next/link';
import { useEffect,useMemo,useRef,useState } from 'react';
import { Archive,ArrowLeft,CheckCircle2,Link2,RotateCcw,ShieldCheck } from 'lucide-react';
import { channelListingInput } from '@commerce/contracts';
import type { ChannelListingMapping,ProductForEdit,Shop } from '@commerce/domain';
import { request } from '../lib/client';

type Lifecycle={mapping:ChannelListingMapping;action:'archive'|'restore'};
const channelNames:Record<string,string>={tiktok:'TikTok Shop',shopee:'Shopee',lazada:'Lazada',direct:'ช่องทางตรง'};
function formatDate(value:string){return new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function identity(mapping:ChannelListingMapping){return mapping.externalVariantId?`${mapping.externalProductId} / ${mapping.externalVariantId}`:mapping.externalProductId;}

export function ListingMappingWorkspace({tenantId,shop,product,initialMappings}:{tenantId:string;shop:Shop;product:ProductForEdit;initialMappings:ChannelListingMapping[]}){
  const [mappings,setMappings]=useState(initialMappings),[variantId,setVariantId]=useState(product.variants.find(v=>!v.archived)?.id??product.variants[0]?.id??'');
  const [externalProductId,setExternalProductId]=useState(''),[externalVariantId,setExternalVariantId]=useState(''),[externalSku,setExternalSku]=useState(''),[listingName,setListingName]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[showHistory,setShowHistory]=useState(false);
  const [lifecycle,setLifecycle]=useState<Lifecycle|null>(null),[reason,setReason]=useState(''),[lifecycleError,setLifecycleError]=useState('');
  const errorRef=useRef<HTMLDivElement>(null),reasonRef=useRef<HTMLTextAreaElement>(null);
  const active=useMemo(()=>mappings.filter(item=>!item.archivedAt),[mappings]),archived=useMemo(()=>mappings.filter(item=>item.archivedAt),[mappings]);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  useEffect(()=>{if(lifecycle)reasonRef.current?.focus();},[lifecycle]);
  useEffect(()=>{function close(event:KeyboardEvent){if(event.key==='Escape'&&!busy)setLifecycle(null);}window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[busy]);
  async function addMapping(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();setError('');setMessage('');
    const parsed=channelListingInput.safeParse({shopId:shop.id,productId:product.id,variantId,externalProductId,externalVariantId,externalSku,listingName,confirmed});
    if(!parsed.success){setError(confirmed?'กรอกรหัสสินค้าบนช่องทางขายและเลือก SKU ให้ครบ':'กรุณายืนยันว่าตรวจรหัสจาก Seller Center แล้ว');return;}
    setBusy(true);
    try{
      const saved=await request<ChannelListingMapping>(`/api/tenants/${tenantId}/listing-mappings`,parsed.data);
      setMappings(previous=>[saved,...previous]);setExternalProductId('');setExternalVariantId('');setExternalSku('');setListingName('');setConfirmed(false);setMessage(`เชื่อมรหัสกับ SKU ${saved.sku} แล้ว`);
    }catch(cause){setError(cause instanceof Error?cause.message:'เชื่อมรหัสไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  function openLifecycle(mapping:ChannelListingMapping,action:'archive'|'restore'){setLifecycle({mapping,action});setReason('');setLifecycleError('');}
  async function changeLifecycle(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();if(!lifecycle||busy)return;setLifecycleError('');
    if(reason.trim().length<3){setLifecycleError('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');return;}
    setBusy(true);
    try{
      const result=await request<{version:number;archived:boolean}>(`/api/tenants/${tenantId}/listing-mappings/${lifecycle.mapping.id}`,{shopId:shop.id,version:lifecycle.mapping.version,action:lifecycle.action,reason},'PATCH');
      const archivedAt=result.archived?new Date().toISOString():null;
      setMappings(previous=>previous.map(item=>item.id===lifecycle.mapping.id?{...item,version:result.version,archivedAt,archiveReason:result.archived?reason:null}:item));
      setMessage(result.archived?'ยกเลิกการเชื่อมแล้ว ประวัติเดิมยังอยู่':'นำการเชื่อมกลับมาใช้งานแล้ว');setLifecycle(null);setReason('');
    }catch(cause){setLifecycleError(cause instanceof Error?cause.message:'เปลี่ยนสถานะไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  return <>
    <Link href="/catalog" className="text-link back-link"><ArrowLeft size={16}/>กลับไปสินค้า</Link>
    <div className="page-heading listing-heading"><div><span className="listing-eyebrow">รหัสช่องทางขาย</span><h1>{product.name}</h1><p>{channelNames[shop.channel]??shop.channel} · {shop.name}</p></div><span className="pill neutral">{active.length} การเชื่อมที่ใช้งาน</span></div>
    <div className="listing-boundary-note"><ShieldCheck size={19}/><div><strong>ระบบบันทึกความสัมพันธ์ของรหัสเท่านั้น</strong><p>ยังไม่ได้ส่งข้อมูลหรือปรับสต็อกบน {channelNames[shop.channel]??shop.channel} การเชื่อมแต่ละครั้งต้องตรวจจาก Seller Center และยืนยันโดยผู้ใช้</p></div></div>
    {message&&<p className="notice success" role="status">{message}</p>}
    <div className="listing-layout">
      <section className="panel listing-form-panel"><div className="panel-heading"><div><h2>เพิ่มการเชื่อม</h2><p>เลือก SKU กลาง แล้วระบุรหัสที่ช่องทางขายใช้จริง</p></div><Link2 size={21}/></div>
        <form onSubmit={addMapping}>
          <fieldset disabled={busy} className="listing-fieldset">
            <label>SKU กลางของบริษัท<select value={variantId} onChange={event=>setVariantId(event.target.value)} required>{product.variants.map(variant=><option value={variant.id} key={variant.id}>{variant.sku}{Object.keys(variant.attributes).length?` · ${Object.values(variant.attributes).join(' / ')}`:''}{variant.archived?' · หยุดขาย':''}</option>)}</select><span className="field-help">ใช้ SKU นี้เป็นตัวอ้างอิงเดียวในรายงานและระบบหลังบ้าน</span></label>
            <div className="listing-id-grid"><label>รหัสสินค้าใน {channelNames[shop.channel]??shop.channel}<input value={externalProductId} onChange={event=>setExternalProductId(event.target.value)} required maxLength={160} placeholder="Product ID"/></label><label>รหัสตัวเลือกสินค้า <span className="muted small">(ถ้ามี)</span><input value={externalVariantId} onChange={event=>setExternalVariantId(event.target.value)} maxLength={160} placeholder="Variant / Model ID"/></label></div>
            <details className="listing-optional"><summary>ข้อมูลช่วยตรวจสอบ</summary><div className="listing-id-grid"><label>SKU ที่แสดงบนช่องทาง<input value={externalSku} onChange={event=>setExternalSku(event.target.value)} maxLength={160} placeholder="เว้นว่างได้"/></label><label>ชื่อรายการขาย<input value={listingName} onChange={event=>setListingName(event.target.value)} maxLength={200} placeholder="เว้นว่างได้"/></label></div></details>
            <label className="checkbox-label listing-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>ฉันตรวจรหัสนี้จาก Seller Center ของร้าน <strong>{shop.name}</strong> แล้ว และยืนยันว่าเป็น SKU ที่เลือก</span></label>
          </fieldset>
          {error&&<div className="notice error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
          <button className="button primary listing-submit" disabled={busy}>{busy?'กำลังบันทึก…':'ยืนยันการเชื่อม'}</button>
        </form>
      </section>
      <section className="panel listing-current"><div className="panel-heading"><div><h2>การเชื่อมที่ใช้งาน</h2><p>รหัสหนึ่งรายการบนช่องทางขายเชื่อมได้กับ SKU กลางเดียว</p></div><span>{active.length}</span></div>
        {!active.length?<div className="quiet-empty"><Link2 size={27}/><p>ยังไม่มีการเชื่อมสำหรับสินค้านี้</p></div>:<div className="listing-records">{active.map(mapping=><ListingRecord key={mapping.id} mapping={mapping} onAction={()=>openLifecycle(mapping,'archive')}/>)}</div>}
      </section>
    </div>
    <section className="listing-history"><button type="button" className="text-button" onClick={()=>setShowHistory(value=>!value)} aria-expanded={showHistory}>{showHistory?'ซ่อน':'ดู'}ประวัติที่ยกเลิก ({archived.length})</button>{showHistory&&<div className="panel">{!archived.length?<p className="quiet-empty">ยังไม่มีประวัติที่ยกเลิก</p>:<div className="listing-records">{archived.map(mapping=><ListingRecord key={mapping.id} mapping={mapping} archived onAction={()=>openLifecycle(mapping,'restore')}/>)}</div>}</div>}</section>
    {lifecycle&&<div className="catalog-dialog-backdrop" role="presentation"><section className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="listing-lifecycle-title"><span className={`catalog-dialog-icon ${lifecycle.action==='restore'?'restore':''}`}>{lifecycle.action==='archive'?<Archive size={22}/>:<RotateCcw size={22}/>}</span><h2 id="listing-lifecycle-title">{lifecycle.action==='archive'?'ยกเลิกการเชื่อม':'นำการเชื่อมกลับมาใช้'}</h2><p><code>{identity(lifecycle.mapping)}</code> · SKU {lifecycle.mapping.sku}</p><p>{lifecycle.action==='archive'?'รายงานใหม่จะไม่ใช้การเชื่อมนี้ แต่ประวัติเดิมจะยังอยู่ หากรหัสผิดให้ยกเลิกแล้วสร้างรายการที่ถูกต้อง':'ระบบจะใช้ความสัมพันธ์นี้กับข้อมูลใหม่อีกครั้ง หากรหัสเดียวกันถูกเชื่อมกับ SKU อื่นอยู่จะนำกลับไม่ได้'}</p><form onSubmit={changeLifecycle}><label>เหตุผล<textarea ref={reasonRef} required minLength={3} maxLength={500} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder={lifecycle.action==='archive'?'เช่น เลือก SKU ผิด ต้องสร้างการเชื่อมใหม่':'เช่น ตรวจสอบกับ Seller Center อีกครั้งแล้ว'}/></label>{lifecycleError&&<p className="notice error" role="alert">{lifecycleError}</p>}<div className="catalog-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setLifecycle(null)}>ยกเลิก</button><button type="submit" className={`button ${lifecycle.action==='archive'?'danger':'primary'}`} disabled={busy}>{busy?'กำลังบันทึก…':lifecycle.action==='archive'?'ยืนยันยกเลิกการเชื่อม':'ยืนยันนำกลับมาใช้'}</button></div></form></section></div>}
  </>;
}

function ListingRecord({mapping,archived=false,onAction}:{mapping:ChannelListingMapping;archived?:boolean;onAction:()=>void}){
  return <article className={`listing-record ${archived?'archived':''}`}><div className="listing-record-main"><span className={`catalog-status ${archived?'archived':'active'}`}>{archived?'ยกเลิกแล้ว':'ใช้งาน'}</span><div><strong>SKU {mapping.sku}</strong><small>{Object.entries(mapping.variantAttributes).map(([key,value])=>`${key}: ${value}`).join(' / ')||'ไม่มีตัวเลือก'}</small></div></div><dl><div><dt>รหัสบนช่องทาง</dt><dd><code>{identity(mapping)}</code></dd></div>{mapping.externalSku&&<div><dt>SKU บนช่องทาง</dt><dd><code>{mapping.externalSku}</code></dd></div>}{mapping.listingName&&<div><dt>ชื่อรายการขาย</dt><dd>{mapping.listingName}</dd></div>}<div><dt>หลักฐานการยืนยัน</dt><dd><CheckCircle2 size={14}/>ผู้ใช้ตรวจด้วยตนเอง · {formatDate(mapping.verifiedAt)}</dd></div>{archived&&mapping.archiveReason&&<div><dt>เหตุผลที่ยกเลิก</dt><dd>{mapping.archiveReason}</dd></div>}</dl><button type="button" className="text-button" onClick={onAction}>{archived?<><RotateCcw size={14}/>นำกลับมาใช้</>:<><Archive size={14}/>ยกเลิกการเชื่อม</>}</button></article>;
}
