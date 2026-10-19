'use client';
import Link from 'next/link';
import { useRef,useState } from 'react';
import { ArrowLeft,CheckCircle2,GitBranch,LockKeyhole,ShieldCheck,SlidersHorizontal,Warehouse } from 'lucide-react';
import { inventoryCompanyDistributionInput,inventoryDistributionModes,inventorySkuDistributionInput,type InventoryDistributionMode } from '@commerce/contracts';
import type { InventoryCompanyDistributionPolicy,InventorySkuDistributionOverview } from '@commerce/domain';
import { request } from '../lib/client';

const labels:Record<InventoryDistributionMode,string>={shared:'ใช้กองกลางร่วม',fixed:'แบ่งโควตาคงที่',hybrid:'Hybrid'};
const descriptions:Record<InventoryDistributionMode,string>={
  shared:'ทุกช่องทางใช้ยอดพร้อมจัดสรรก้อนเดียวกัน ไม่มีจำนวนแยกร้าน',
  fixed:'กันจำนวนให้แต่ละช่องทาง ผลรวมต้องไม่เกินยอดพร้อมจัดสรร',
  hybrid:'ใช้กองกลางร่วม พร้อมกำหนดเพดานเปิดขายสูงสุดของแต่ละช่องทาง',
};
const channelNames:Record<string,string>={tiktok:'TikTok Shop',shopee:'Shopee',lazada:'Lazada',direct:'ขายตรง'};
const quantity=(value:number)=>new Intl.NumberFormat('th-TH').format(value);

function ModePicker({value,onChange,disabled=false}:{value:InventoryDistributionMode;onChange:(mode:InventoryDistributionMode)=>void;disabled?:boolean}){
  return <fieldset className="distribution-mode-picker" disabled={disabled}><legend>รูปแบบการกระจายสต็อก</legend>{inventoryDistributionModes.map(mode=><label key={mode} className={value===mode?'selected':''}><input type="radio" name="distribution-mode" value={mode} checked={value===mode} onChange={()=>onChange(mode)}/><span><strong>{labels[mode]}{mode==='hybrid'?<em>แนะนำ</em>:null}</strong><small>{descriptions[mode]}</small></span></label>)}</fieldset>;
}

export function CompanyDistributionPolicyForm({tenantId,initialPolicy}:{tenantId:string;initialPolicy:InventoryCompanyDistributionPolicy}){
  const [policy,setPolicy]=useState(initialPolicy),[mode,setMode]=useState(initialPolicy.mode),[safetyStock,setSafetyStock]=useState(String(initialPolicy.safetyStock)),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const errorRef=useRef<HTMLParagraphElement>(null);
  async function submit(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();setError('');setMessage('');
    const parsed=inventoryCompanyDistributionInput.safeParse({mode,safetyStock:safetyStock===''?Number.NaN:Number(safetyStock),version:policy.version,confirmed});
    if(!parsed.success){setError(confirmed?'กรอก Safety stock เป็นจำนวนตั้งแต่ 0 ขึ้นไป':'กรุณายืนยันว่าคุณเข้าใจว่านี่เป็นค่าเริ่มต้นของทุก SKU');queueMicrotask(()=>errorRef.current?.focus());return;}
    setBusy(true);try{const saved=await request<InventoryCompanyDistributionPolicy>(`/api/tenants/${tenantId}/inventory-distribution`,{scope:'company',...parsed.data});setPolicy(saved);setConfirmed(false);setMessage('บันทึกค่าเริ่มต้นของบริษัทแล้ว SKU ที่ไม่ได้ตั้งค่าเฉพาะจะใช้ค่านี้');}
    catch(cause){setError(cause instanceof Error?cause.message:'บันทึกนโยบายไม่สำเร็จ');queueMicrotask(()=>errorRef.current?.focus());}finally{setBusy(false);}
  }
  return <>
    <Link className="text-link back-link" href="/inventory"><ArrowLeft size={16}/>กลับไปสต็อกกลาง</Link>
    <div className="page-heading distribution-heading"><div><span className="inventory-eyebrow">ค่าเริ่มต้นระดับบริษัท</span><h1>นโยบายกระจายสต็อก</h1><p>ใช้กับ SKU ที่ยังไม่ได้ตั้งค่าช่องทางเป็นกรณีพิเศษ</p></div><span className="pill neutral"><LockKeyhole size={14}/>Planning only</span></div>
    <section className="inventory-boundary-note"><ShieldCheck size={20}/><div><strong>การตั้งค่านี้ยังไม่ส่งยอดออก Marketplace</strong><p>ระบบใช้เพื่อคำนวณและเตรียมแผนเท่านั้น เมื่อมี connector แล้วจึงต้องผ่านการตรวจ sync, reconciliation และ controlled-write ก่อน</p></div></section>
    <form className="panel distribution-form" onSubmit={submit}><div className="panel-heading"><div><h2>ค่าเริ่มต้นของทุก SKU</h2><p>{policy.configured?`บันทึกแล้ว · เวอร์ชัน ${policy.version}`:'ยังไม่ได้บันทึก ระบบใช้ Hybrid และ Safety stock 0 เป็นค่าเริ่มต้น'}</p></div><SlidersHorizontal size={20}/></div>
      <ModePicker value={mode} onChange={setMode} disabled={!policy.canWrite||busy}/>
      <label className="distribution-safety">Safety stock ต่อ SKU<input aria-label="Safety stock ต่อ SKU" inputMode="numeric" pattern="[0-9]*" min="0" max="1000000000" required value={safetyStock} disabled={!policy.canWrite||busy} onChange={event=>setSafetyStock(event.target.value.replace(/\D/g,''))}/><small>จำนวนที่กันไว้ ไม่เปิดให้ช่องทางขาย เช่น กันไว้สำหรับยอดคลาดเคลื่อนหรือหน้าร้าน</small></label>
      {policy.canWrite?<><label className="checkbox-label distribution-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>ฉันเข้าใจว่าค่านี้จะเป็นค่าเริ่มต้นของ SKU ทั้งบริษัทที่ยังไม่มี override</span></label>{error&&<p className="notice error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{message&&<p className="notice success" role="status"><CheckCircle2 size={16}/>{message}</p>}<button className="button primary" disabled={busy}>{busy?'กำลังบันทึก…':'บันทึกค่าเริ่มต้นบริษัท'}</button></>:<p className="notice">คุณมีสิทธิ์อ่านนโยบาย แต่เฉพาะเจ้าของหรือฝ่ายการเงินแก้ไขได้</p>}
    </form>
  </>;
}

export function SkuDistributionPolicyForm({tenantId,initialOverview}:{tenantId:string;initialOverview:InventorySkuDistributionOverview}){
  const [overview,setOverview]=useState(initialOverview),[source,setSource]=useState<'inherit'|'override'>(initialOverview.source),[mode,setMode]=useState(initialOverview.mode),[safetyStock,setSafetyStock]=useState(String(initialOverview.safetyStock));
  const [channelValues,setChannelValues]=useState<Record<string,string>>(()=>Object.fromEntries(initialOverview.channels.map(channel=>[channel.shopId,channel.quantity===null?'':String(channel.quantity)])));
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const errorRef=useRef<HTMLParagraphElement>(null);
  const safety=safetyStock===''?0:Number(safetyStock),distributable=Math.max(0,overview.balance.available-safety);
  const configuredTotal=Object.values(channelValues).reduce((sum,value)=>sum+(value===''?0:Number(value)),0);
  const fixedInvalid=source==='override'&&mode==='fixed'&&configuredTotal>distributable;
  function selectSource(next:'inherit'|'override'){
    setSource(next);setMessage('');setError('');if(next==='inherit'){setMode(overview.companyPolicy.mode);setSafetyStock(String(overview.companyPolicy.safetyStock));}else if(overview.source==='inherit'){setMode(overview.companyPolicy.mode);setSafetyStock(String(overview.companyPolicy.safetyStock));}
  }
  async function submit(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();setError('');setMessage('');
    const channels=source==='inherit'?[]:overview.channels.map(channel=>({shopId:channel.shopId,quantity:mode==='shared'?null:channelValues[channel.shopId]===''?null:Number(channelValues[channel.shopId])}));
    const parsed=inventorySkuDistributionInput.safeParse({variantId:overview.variant.id,source,mode,safetyStock:safety,channels,version:overview.version,confirmed});
    if(!parsed.success){setError(confirmed?'กรอกจำนวนของทุกช่องทางให้ครบและใช้จำนวนตั้งแต่ 0 ขึ้นไป':'กรุณายืนยันว่าการตั้งค่านี้ยังไม่ส่งยอดออก Marketplace');queueMicrotask(()=>errorRef.current?.focus());return;}
    if(fixedInvalid){setError(`โควตารวม ${quantity(configuredTotal)} มากกว่าสต็อกที่จัดสรรได้ ${quantity(distributable)}`);queueMicrotask(()=>errorRef.current?.focus());return;}
    setBusy(true);try{const saved=await request<InventorySkuDistributionOverview>(`/api/tenants/${tenantId}/inventory-distribution`,{scope:'sku',...parsed.data});setOverview(saved);setSource(saved.source);setMode(saved.mode);setSafetyStock(String(saved.safetyStock));setChannelValues(Object.fromEntries(saved.channels.map(channel=>[channel.shopId,channel.quantity===null?'':String(channel.quantity)])));setConfirmed(false);setMessage(saved.source==='inherit'?'เปลี่ยนกลับมาใช้ค่าเริ่มต้นของบริษัทแล้ว':'บันทึกนโยบายเฉพาะ SKU แล้ว');}
    catch(cause){setError(cause instanceof Error?cause.message:'บันทึกนโยบายไม่สำเร็จ');queueMicrotask(()=>errorRef.current?.focus());}finally{setBusy(false);}
  }
  return <>
    <Link className="text-link back-link" href="/inventory"><ArrowLeft size={16}/>กลับไปสต็อกกลาง</Link>
    <div className="page-heading distribution-heading"><div><span className="inventory-eyebrow">ตั้งค่าช่องทางขาย · SKU {overview.variant.sku}</span><h1>{overview.product.name}</h1><p>{Object.entries(overview.variant.attributes).map(([key,value])=>`${key}: ${value}`).join(' / ')||'ไม่มีตัวเลือก'}</p></div><span className="pill neutral"><LockKeyhole size={14}/>Planning only</span></div>
    <section className="distribution-stock-summary"><article><Warehouse size={18}/><span>คงเหลือจริง</span><strong>{quantity(overview.balance.onHand)}</strong></article><article><GitBranch size={18}/><span>จองแล้ว</span><strong>{quantity(overview.balance.reserved)}</strong></article><article><ShieldCheck size={18}/><span>Safety stock</span><strong>{quantity(safety)}</strong></article><article className={distributable===0?'needs-attention':''}><SlidersHorizontal size={18}/><span>พร้อมจัดสรร</span><strong>{quantity(distributable)}</strong></article></section>
    <form className="panel distribution-form" onSubmit={submit}><div className="panel-heading"><div><h2>นโยบายของ SKU นี้</h2><p>พร้อมจัดสรร = คงเหลือจริง − จองแล้ว − Safety stock</p></div></div>
      <fieldset className="distribution-source" disabled={!overview.canWrite||busy}><legend>เลือกแหล่งการตั้งค่า</legend><label className={source==='inherit'?'selected':''}><input type="radio" checked={source==='inherit'} onChange={()=>selectSource('inherit')}/><span><strong>ใช้ค่าเริ่มต้นของบริษัท</strong><small>{labels[overview.companyPolicy.mode]} · Safety stock {quantity(overview.companyPolicy.safetyStock)}</small></span></label><label className={source==='override'?'selected':''}><input type="radio" checked={source==='override'} onChange={()=>selectSource('override')}/><span><strong>ตั้งค่าเฉพาะ SKU นี้</strong><small>ใช้เมื่อสินค้านี้มีความเร็วขายหรือความเสี่ยงต่างจากสินค้าอื่น</small></span></label></fieldset>
      {source==='override'&&<><ModePicker value={mode} onChange={setMode} disabled={!overview.canWrite||busy}/><label className="distribution-safety">Safety stock ของ SKU<input aria-label="Safety stock ของ SKU" inputMode="numeric" pattern="[0-9]*" min="0" max="1000000000" required value={safetyStock} disabled={!overview.canWrite||busy} onChange={event=>setSafetyStock(event.target.value.replace(/\D/g,''))}/><small>หลังกันสำรองแล้ว เหลือพร้อมจัดสรร {quantity(distributable)} {overview.product.salesUnit}</small></label><section className="distribution-channels" aria-labelledby="channel-policy-title"><div><h3 id="channel-policy-title">จำนวนรายช่องทาง</h3><p>{mode==='shared'?'ทุกช่องทางใช้กองกลางเดียวกัน':mode==='fixed'?'จำนวนที่กันไว้ให้แต่ละช่องทาง':'เพดานเปิดขายสูงสุด โดยยังตัดจากกองกลางเดียวกัน'}</p></div>{overview.channels.map(channel=><label key={channel.shopId}><span><strong>{channelNames[channel.channel]??channel.channel}</strong><small>{channel.shopName}</small></span>{mode==='shared'?<output>ใช้กองกลางร่วม</output>:<input aria-label={`${mode==='fixed'?'โควตา':'เพดาน'} ${channelNames[channel.channel]??channel.channel}`} inputMode="numeric" pattern="[0-9]*" min="0" max="1000000000" required value={channelValues[channel.shopId]??''} disabled={!overview.canWrite||busy} onChange={event=>setChannelValues(values=>({...values,[channel.shopId]:event.target.value.replace(/\D/g,'')}))}/>}</label>)}{mode==='fixed'&&<p className={`distribution-total ${fixedInvalid?'error':''}`}>โควตารวม {quantity(configuredTotal)} / จัดสรรได้ {quantity(distributable)}</p>}{mode==='hybrid'&&<p className="distribution-total">เพดานรวมสูงกว่าสต็อกได้ เพราะทุกช่องทางยังใช้กองกลางร่วม</p>}</section></>}
      {source==='inherit'&&<div className="distribution-inherited"><ShieldCheck size={20}/><div><strong>SKU นี้จะใช้ {labels[overview.companyPolicy.mode]}</strong><p>Safety stock {quantity(overview.companyPolicy.safetyStock)} {overview.product.salesUnit} หากแก้ค่าบริษัทในภายหลัง SKU นี้จะเปลี่ยนตาม</p></div></div>}
      {overview.canWrite?<><label className="checkbox-label distribution-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>ฉันตรวจยอดและเข้าใจว่านี่เป็นแผนภายใน ระบบยังไม่ส่งจำนวนออก Marketplace</span></label>{error&&<p className="notice error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}{message&&<p className="notice success" role="status"><CheckCircle2 size={16}/>{message}</p>}<button className="button primary" disabled={busy||fixedInvalid}>{busy?'กำลังบันทึก…':source==='inherit'?'ใช้ค่าเริ่มต้นบริษัท':'บันทึกนโยบาย SKU'}</button></>:<p className="notice">คุณมีสิทธิ์อ่านนโยบาย แต่เฉพาะเจ้าของหรือฝ่ายการเงินแก้ไขได้</p>}
    </form>
  </>;
}
