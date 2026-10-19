'use client';
import Link from 'next/link';
import { useEffect,useMemo,useRef,useState } from 'react';
import { Archive,ChevronDown,ChevronRight,PackageCheck,Plus,RotateCcw,Search } from 'lucide-react';
import type { CatalogItem,CatalogStatus } from '@commerce/domain';
import { money,request } from '../lib/client';

type Counts={activeCount:number;archivedCount:number};
type LifecycleAction={productId:string;variantId?:string;label:string;action:'archive'|'restore';version:number};
type CatalogResponse={items:CatalogItem[];counts:Counts};

export function CatalogView({items:initialItems,tenantId,shopId,canReadCosts,canWrite,canReadInventory,limit,counts:initialCounts,saved,focused}:{items:CatalogItem[];tenantId:string;shopId:string;canReadCosts:boolean;canWrite:boolean;canReadInventory:boolean;limit:number;counts:Counts;saved?:string;focused?:string}){
  const [items,setItems]=useState(initialItems),[counts,setCounts]=useState(initialCounts),[query,setQuery]=useState(''),[category,setCategory]=useState('all'),[missingOnly,setMissingOnly]=useState(false),[status,setStatus]=useState<CatalogStatus>('active'),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState(''),[reload,setReload]=useState(0);
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set((saved??focused)?[saved??focused!]:[]));
  const [lifecycle,setLifecycle]=useState<LifecycleAction|null>(null),[reason,setReason]=useState(''),[lifecycleBusy,setLifecycleBusy]=useState(false),[lifecycleMessage,setLifecycleMessage]=useState(''),[lifecycleError,setLifecycleError]=useState('');
  const reasonRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(lifecycle)reasonRef.current?.focus();},[lifecycle]);
  useEffect(()=>{
    const normalized=query.trim(),controller=new AbortController(),timer=setTimeout(async()=>{
      setSearching(true);setSearchError('');
      try{const params=new URLSearchParams({shopId,q:normalized,status}),response=await fetch(`/api/tenants/${tenantId}/catalog?${params}`,{signal:controller.signal,cache:'no-store'});const data=await response.json() as CatalogResponse&{error?:string};if(!response.ok)throw new Error(data.error??'ค้นหาสินค้าไม่สำเร็จ');setItems(data.items);setCounts(data.counts);}
      catch(error){if(!controller.signal.aborted)setSearchError(error instanceof Error?error.message:'ค้นหาสินค้าไม่สำเร็จ');}
      finally{if(!controller.signal.aborted)setSearching(false);}
    },query?250:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,reload,shopId,status,tenantId]);
  useEffect(()=>{function close(event:KeyboardEvent){if(event.key==='Escape'&&!lifecycleBusy)setLifecycle(null);}window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[lifecycleBusy]);
  const categories=[...new Set(items.map(p=>p.category))];
  const groups=useMemo(()=>{const result=new Map<string,CatalogItem[]>();for(const item of items)result.set(item.productId,[...(result.get(item.productId)??[]),item]);return [...result.values()];},[items]);
  const missing=groups.filter(g=>g.some(i=>i.costMinor==null));
  const filtered=groups.filter(g=>(category==='all'||g[0].category===category)&&(!missingOnly||g.some(i=>i.costMinor==null)));
  function toggle(id:string){setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function openLifecycle(action:LifecycleAction){setLifecycle(action);setReason('');setLifecycleError('');}
  async function submitLifecycle(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();if(!lifecycle||lifecycleBusy)return;setLifecycleError('');
    if(reason.trim().length<3){setLifecycleError('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');return;}
    setLifecycleBusy(true);
    try{
      await request(`/api/tenants/${tenantId}/products/${lifecycle.productId}/lifecycle`,{shopId,version:lifecycle.version,target:lifecycle.variantId?{type:'variant',variantId:lifecycle.variantId}:{type:'product'},action:lifecycle.action,reason},'PATCH');
      setLifecycleMessage(lifecycle.action==='archive'?`หยุดขาย ${lifecycle.label} แล้ว`:`เปิดขาย ${lifecycle.label} แล้ว`);setLifecycle(null);setReason('');setItems([]);setReload(value=>value+1);
    }catch(error){setLifecycleError(error instanceof Error?error.message:'เปลี่ยนสถานะสินค้าไม่สำเร็จ');}
    finally{setLifecycleBusy(false);}
  }
  return <>
    <div className="page-heading"><div><h1>สินค้า</h1><p>{groups.length} สินค้า · {items.length} SKU {query?'ที่ตรงกับคำค้น':status==='active'?'ที่พร้อมขาย':status==='archived'?'ที่หยุดขาย':'ทั้งหมด'}{items.length===limit?` · แสดงสูงสุด ${limit} SKU`:''}</p></div>{canWrite&&<Link href="/catalog/new" className="button primary"><Plus size={17}/>เพิ่มสินค้า</Link>}</div>
    {saved&&items.some(i=>i.productId===saved)&&<p className="notice success" role="status">บันทึกสินค้าแล้ว</p>}
    {lifecycleMessage&&<p className="notice success" role="status">{lifecycleMessage} ประวัติสินค้าและรายงานเดิมยังอยู่ครบ</p>}
    <div className="catalog-lifecycle-tabs" aria-label="กรองสถานะการขาย">
      <button type="button" className={status==='active'?'selected':''} onClick={()=>{setItems([]);setStatus('active');}}><PackageCheck size={16}/>พร้อมขาย <span>{counts.activeCount} SKU</span></button>
      <button type="button" className={status==='archived'?'selected':''} onClick={()=>{setItems([]);setStatus('archived');}}><Archive size={16}/>หยุดขาย <span>{counts.archivedCount} SKU</span></button>
      <button type="button" className={status==='all'?'selected':''} onClick={()=>{setItems([]);setStatus('all');}}>ทั้งหมด <span>{counts.activeCount+counts.archivedCount} SKU</span></button>
    </div>
    <div className="list-tabs" aria-label="รายการสินค้า"><button type="button" className={!missingOnly?'selected':''} onClick={()=>setMissingOnly(false)}>ทุกรายการ <span>{groups.length}</span></button>{canReadCosts&&<button type="button" className={missingOnly?'selected':''} onClick={()=>setMissingOnly(true)}>ยังไม่มีต้นทุน <span>{missing.length}</span></button>}</div>
    <section className="panel table-panel" aria-busy={searching}><div className="table-toolbar"><label className="search-field"><Search size={17}/><input aria-label="ค้นหาสินค้า" placeholder="ค้นหาชื่อสินค้า หรือ SKU" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="กรองหมวดสินค้า" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">ทุกหมวดสินค้า</option>{categories.map(c=><option key={c}>{c}</option>)}</select>{searching&&query&&<span className="field-help catalog-search-status" role="status">กำลังค้นหา…</span>}</div>
      {searchError&&<p className="notice error catalog-search-error" role="alert">{searchError}</p>}
      <div className="table-scroll"><table className="catalog-table"><thead><tr><th>สินค้า</th><th>สถานะ</th><th>หมวดสินค้า</th><th>ตัวเลือก</th><th className="numeric">ราคาขาย</th>{canReadCosts&&<th className="numeric">ต้นทุน</th>}</tr></thead><tbody>{filtered.map(group=>{
        const p=group[0],open=expanded.has(p.productId)||!!query,prices=group.map(v=>v.priceMinor),min=Math.min(...prices),max=Math.max(...prices),costs=group.filter(v=>v.costMinor==null).length;
        return <ProductRows key={p.productId} group={group} open={open} toggle={()=>toggle(p.productId)} canReadCosts={canReadCosts} canWrite={canWrite} canReadInventory={canReadInventory} price={min===max?money(min):`${money(min)} – ${money(max)}`} missingCosts={costs} onLifecycle={openLifecycle}/>;
      })}</tbody></table></div>
      {!filtered.length&&<div className="empty-state"><h2>{items.length?'ไม่พบสินค้า':status==='archived'?'ยังไม่มีสินค้าที่หยุดขาย':'ยังไม่มีสินค้าในร้านนี้'}</h2><p>{items.length?'ลองเปลี่ยนคำค้นหรือหมวดสินค้า':status==='archived'?'เมื่อหยุดขายสินค้า รายการจะมาอยู่ที่นี่และเปิดกลับได้':'เพิ่มสินค้าและรหัส SKU เพื่อใช้จับคู่กับรายงานการขาย'}</p>{items.length>0&&<button type="button" className="button secondary" onClick={()=>{setQuery('');setCategory('all');setMissingOnly(false);}}>ล้างตัวกรอง</button>}</div>}
      <div className="table-footer"><span>{filtered.length} สินค้า{items.length===limit?` · แสดง ${limit} SKU แรกของผลลัพธ์`:''}</span><span>{query?'ค้นหาจากฐานข้อมูลของร้านนี้':'ราคาเป็นบาทต่อหน่วยขาย'}</span></div>
    </section>
    {lifecycle&&<div className="catalog-dialog-backdrop" role="presentation"><section className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-lifecycle-title"><span className={`catalog-dialog-icon ${lifecycle.action==='restore'?'restore':''}`}>{lifecycle.action==='archive'?<Archive size={22}/>:<RotateCcw size={22}/>}</span><h2 id="catalog-lifecycle-title">{lifecycle.action==='archive'?'หยุดขาย':'เปิดขาย'} {lifecycle.label}</h2><p>{lifecycle.action==='archive'?'รายการจะไม่อยู่ในกลุ่มพร้อมขาย แต่ SKU ประวัติต้นทุนและรายการการเงินเดิมจะไม่ถูกลบ':'รายการจะกลับมาอยู่ในกลุ่มพร้อมขาย และใช้ SKU เดิมต่อเนื่อง'}</p><form onSubmit={submitLifecycle}><label>เหตุผล<textarea ref={reasonRef} aria-label="เหตุผลที่เปลี่ยนสถานะ" required minLength={3} maxLength={500} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder={lifecycle.action==='archive'?'เช่น สินค้าหมดและรอเติมสต็อก':'เช่น ได้รับสินค้าเข้ารอบใหม่แล้ว'}/></label>{lifecycleError&&<p className="notice error" role="alert">{lifecycleError}</p>}<div className="catalog-dialog-actions"><button type="button" className="button secondary" disabled={lifecycleBusy} onClick={()=>setLifecycle(null)}>ยกเลิก</button><button type="submit" className={`button ${lifecycle.action==='archive'?'danger':'primary'}`} disabled={lifecycleBusy}>{lifecycleBusy?'กำลังบันทึก…':lifecycle.action==='archive'?'ยืนยันหยุดขาย':'ยืนยันเปิดขาย'}</button></div></form></section></div>}
  </>;
}

function ProductRows({group,open,toggle,canReadCosts,canWrite,canReadInventory,price,missingCosts,onLifecycle}:{group:CatalogItem[];open:boolean;toggle:()=>void;canReadCosts:boolean;canWrite:boolean;canReadInventory:boolean;price:string;missingCosts:number;onLifecycle:(action:LifecycleAction)=>void}){
  const p=group[0],productArchived=p.productArchived,archivedVariants=group.filter(v=>v.variantArchived).length;
  const statusLabel=productArchived?'หยุดขายทั้งสินค้า':archivedVariants?`หยุดขาย ${archivedVariants} SKU`:'พร้อมขาย';
  return <><tr className={productArchived?'catalog-row-archived':''}><td><button type="button" className="product-disclosure" aria-expanded={open} aria-controls={`product-${p.productId}`} onClick={toggle}>{open?<ChevronDown size={17}/>:<ChevronRight size={17}/>}<span><strong>{p.name}</strong><small>{group.length===1?p.sku:`${group.length} SKU`} · หน่วย: {p.salesUnit}</small></span></button></td><td><span className={`catalog-status ${productArchived||archivedVariants?'archived':'active'}`}>{statusLabel}</span></td><td>{p.category}</td><td>{group.length===1&&!Object.keys(p.optionAttributes).length?'ไม่มีตัวเลือก':`${group.length} SKU`}</td><td className="numeric">{price}</td>{canReadCosts&&<td className="numeric">{missingCosts?<span className="text-warning">ยังไม่ระบุ {missingCosts} SKU</span>:<span>ครบแล้ว</span>}</td>}</tr>
    {open&&<tr className="product-expanded" id={`product-${p.productId}`}><td colSpan={canReadCosts?6:5}>
      {Object.keys(p.sharedAttributes).length>0&&<dl className="product-details">{Object.entries(p.sharedAttributes).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {(canWrite||canReadInventory)&&<div className="product-row-actions">{canReadInventory&&<Link className="text-link" href={`/catalog/${p.productId}/inventory`} aria-label={`จัดการสต็อกสำหรับ ${p.name}`}>จัดการสต็อก</Link>}{canWrite&&<><Link className="text-link" href={`/catalog/${p.productId}/edit`} aria-label={`แก้ไข ${p.name}`}>แก้ไขสินค้า</Link><Link className="text-link" href={`/catalog/${p.productId}/listings`} aria-label={`เชื่อมช่องทางขายสำหรับ ${p.name}`}>เชื่อมช่องทางขาย</Link><button type="button" className="text-button" onClick={()=>onLifecycle({productId:p.productId,label:p.name,action:productArchived?'restore':'archive',version:p.version})}>{productArchived?<><RotateCcw size={14}/>เปิดขายสินค้า</>:<><Archive size={14}/>หยุดขายทั้งสินค้า</>}</button></>}</div>}
      <table className="sku-table"><thead><tr><th>SKU</th><th>ตัวเลือก</th><th>สถานะ</th><th className="numeric">ราคาขาย</th>{canReadCosts&&<th className="numeric">ต้นทุน</th>}{canWrite&&<th><span className="sr-only">จัดการสถานะ</span></th>}</tr></thead><tbody>{group.map(v=>{const archived=productArchived||v.variantArchived;return <tr key={v.id} className={archived?'catalog-row-archived':''}><td><code>{v.sku}</code></td><td>{Object.entries(v.optionAttributes).map(([k,val])=>`${k}: ${val}`).join(' / ')||'—'}</td><td><span className={`catalog-status ${archived?'archived':'active'}`}>{productArchived?'หยุดตามสินค้า':v.variantArchived?'หยุดขาย':'พร้อมขาย'}</span></td><td className="numeric">{money(v.priceMinor)}</td>{canReadCosts&&<td className="numeric">{v.costMinor==null?<span className="text-warning">ยังไม่ระบุ</span>:money(v.costMinor)}</td>}{canWrite&&<td className="catalog-sku-action">{productArchived&&!v.variantArchived?<small>เปิดสินค้าก่อน</small>:<button type="button" className="text-button" onClick={()=>onLifecycle({productId:p.productId,variantId:v.id,label:`SKU ${v.sku}`,action:v.variantArchived?'restore':'archive',version:p.version})}>{v.variantArchived?'เปิดขาย':'หยุดขาย'}</button>}</td>}</tr>;})}</tbody></table>
      {(productArchived||archivedVariants>0)&&<p className="field-help catalog-archive-note">รายการที่หยุดขายยังใช้จับคู่ Statement ดูประวัติเดิม และเก็บความสัมพันธ์กับรหัสบนช่องทางขายได้</p>}
    </td></tr>}
  </>;
}
