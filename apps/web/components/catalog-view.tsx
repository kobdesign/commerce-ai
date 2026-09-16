'use client';
import Link from 'next/link';
import { useEffect,useMemo,useState } from 'react';
import { ChevronDown,ChevronRight,Plus,Search } from 'lucide-react';
import type { CatalogItem } from '@commerce/domain';
import { money } from '../lib/client';

export function CatalogView({items:initialItems,tenantId,shopId,canReadCosts,canWrite,limit,saved,focused}:{items:CatalogItem[];tenantId:string;shopId:string;canReadCosts:boolean;canWrite:boolean;limit:number;saved?:string;focused?:string}){
  const [items,setItems]=useState(initialItems),[query,setQuery]=useState(''),[category,setCategory]=useState('all'),[missingOnly,setMissingOnly]=useState(false),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState('');
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set((saved??focused)?[saved??focused!]:[]));
  const categories=[...new Set(initialItems.map(p=>p.category))];
  useEffect(()=>{
    const normalized=query.trim();
    if(!normalized){setItems(initialItems);setSearching(false);setSearchError('');return;}
    const controller=new AbortController(),timer=setTimeout(async()=>{
      setSearching(true);setSearchError('');
      try{const params=new URLSearchParams({shopId,q:normalized}),response=await fetch(`/api/tenants/${tenantId}/catalog?${params}`,{signal:controller.signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error??'ค้นหาสินค้าไม่สำเร็จ');setItems(data.items);}
      catch(error){if(!controller.signal.aborted)setSearchError(error instanceof Error?error.message:'ค้นหาสินค้าไม่สำเร็จ');}
      finally{if(!controller.signal.aborted)setSearching(false);}
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[initialItems,query,shopId,tenantId]);
  const groups=useMemo(()=>{
    const result=new Map<string,CatalogItem[]>();
    for(const item of items)result.set(item.productId,[...(result.get(item.productId)??[]),item]);
    return [...result.values()];
  },[items]);
  const missing=groups.filter(g=>g.some(i=>i.costMinor==null));
  const filtered=groups.filter(g=>(category==='all'||g[0].category===category)&&(!missingOnly||g.some(i=>i.costMinor==null)));
  function toggle(id:string){setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  return <>
    <div className="page-heading"><div><h1>สินค้า</h1><p>{groups.length} สินค้า · {items.length} SKU {query?'ที่ตรงกับคำค้น':'ในร้านที่เลือก'}{items.length===limit?` · แสดงสูงสุด ${limit} SKU`:''}</p></div>{canWrite&&<Link href="/catalog/new" className="button primary"><Plus size={17}/>เพิ่มสินค้า</Link>}</div>
    {saved&&items.some(i=>i.productId===saved)&&<p className="notice success" role="status">บันทึกสินค้าแล้ว</p>}
    <div className="list-tabs" aria-label="รายการสินค้า"><button type="button" className={!missingOnly?'selected':''} onClick={()=>setMissingOnly(false)}>สินค้าทั้งหมด <span>{groups.length}</span></button>{canReadCosts&&<button type="button" className={missingOnly?'selected':''} onClick={()=>setMissingOnly(true)}>ยังไม่มีต้นทุน <span>{missing.length}</span></button>}</div>
    <section className="panel table-panel"><div className="table-toolbar"><label className="search-field"><Search size={17}/><input aria-label="ค้นหาสินค้า" placeholder="ค้นหาชื่อสินค้า หรือ SKU" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="กรองหมวดสินค้า" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">ทุกหมวดสินค้า</option>{categories.map(c=><option key={c}>{c}</option>)}</select>{searching&&<span className="field-help catalog-search-status" role="status">กำลังค้นหา…</span>}</div>
      {searchError&&<p className="notice error catalog-search-error" role="alert">{searchError}</p>}
      <div className="table-scroll"><table className="catalog-table"><thead><tr><th>สินค้า</th><th>หมวดสินค้า</th><th>ตัวเลือก</th><th className="numeric">ราคาขาย</th>{canReadCosts&&<th className="numeric">ต้นทุน</th>}</tr></thead><tbody>{filtered.map(group=>{
        const p=group[0],open=expanded.has(p.productId)||!!query;
        const prices=group.map(v=>v.priceMinor),min=Math.min(...prices),max=Math.max(...prices);
        const costs=group.filter(v=>v.costMinor==null).length;
        return <ProductRows key={p.productId} group={group} open={open} toggle={()=>toggle(p.productId)} canReadCosts={canReadCosts} canWrite={canWrite} price={min===max?money(min):`${money(min)} – ${money(max)}`} missingCosts={costs}/>;
      })}</tbody></table></div>
      {!filtered.length&&<div className="empty-state"><h2>{items.length?'ไม่พบสินค้า':'ยังไม่มีสินค้าในร้านนี้'}</h2><p>{items.length?'ลองเปลี่ยนคำค้นหรือหมวดสินค้า':'เพิ่มสินค้าและรหัส SKU เพื่อใช้จับคู่กับรายงานการขาย'}</p>{items.length>0&&<button type="button" className="button secondary" onClick={()=>{setQuery('');setCategory('all');setMissingOnly(false);}}>ล้างตัวกรอง</button>}</div>}
      <div className="table-footer"><span>{filtered.length} สินค้า{items.length===limit?` · แสดง ${limit} SKU แรกของผลลัพธ์`:''}</span><span>{query?'ค้นหาจากฐานข้อมูลของร้านนี้':'ราคาเป็นบาทต่อหน่วยขาย'}</span></div>
    </section>
  </>;
}
function ProductRows({group,open,toggle,canReadCosts,canWrite,price,missingCosts}:{group:CatalogItem[];open:boolean;toggle:()=>void;canReadCosts:boolean;canWrite:boolean;price:string;missingCosts:number}){
  const p=group[0];
  return <><tr><td><button type="button" className="product-disclosure" aria-expanded={open} aria-controls={`product-${p.productId}`} onClick={toggle}>{open?<ChevronDown size={17}/>:<ChevronRight size={17}/>}<span><strong>{p.name}</strong><small>{group.length===1?p.sku:`${group.length} SKU`} · หน่วย: {p.salesUnit}</small></span></button></td><td>{p.category}</td><td>{group.length===1&&!Object.keys(p.optionAttributes).length?'ไม่มีตัวเลือก':`${group.length} SKU`}</td><td className="numeric">{price}</td>{canReadCosts&&<td className="numeric">{missingCosts?<span className="text-warning">ยังไม่ระบุ {missingCosts} SKU</span>:<span>ครบแล้ว</span>}</td>}</tr>
    {open&&<tr className="product-expanded" id={`product-${p.productId}`}><td colSpan={canReadCosts?5:4}>
      {Object.keys(p.sharedAttributes).length>0&&<dl className="product-details">{Object.entries(p.sharedAttributes).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {canWrite&&<div className="product-row-actions"><Link className="text-link" href={`/catalog/${p.productId}/edit`} aria-label={`แก้ไข ${p.name}`}>แก้ไขสินค้า</Link></div>}
      <table className="sku-table"><thead><tr><th>SKU</th><th>ตัวเลือก</th><th className="numeric">ราคาขาย</th>{canReadCosts&&<th className="numeric">ต้นทุน</th>}</tr></thead><tbody>{group.map(v=><tr key={v.id}><td><code>{v.sku}</code></td><td>{Object.entries(v.optionAttributes).map(([k,val])=>`${k}: ${val}`).join(' / ')||'—'}</td><td className="numeric">{money(v.priceMinor)}</td>{canReadCosts&&<td className="numeric">{v.costMinor==null?<span className="text-warning">ยังไม่ระบุ</span>:money(v.costMinor)}</td>}</tr>)}</tbody></table>
    </td></tr>}
  </>;
}
