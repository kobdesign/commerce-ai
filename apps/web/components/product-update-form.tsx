'use client';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft,Plus,Trash2 } from 'lucide-react';
import { normalizeLabel,productUpdateInput,salesUnits } from '@commerce/contracts';
import type { ProductForEdit } from '@commerce/domain';
import { money,request,RequestError,toMinor } from '../lib/client';

export function ProductUpdateForm({product,tenantId,shopId,shopName}:{product:ProductForEdit;tenantId:string;shopId:string;shopName:string}){
  const router=useRouter(),sequence=useRef(Object.keys(product.attributes).length),errorRef=useRef<HTMLDivElement>(null);
  const [name,setName]=useState(product.name),[category,setCategory]=useState(product.category),[unit,setUnit]=useState(product.salesUnit);
  const [details,setDetails]=useState(()=>Object.entries(product.attributes).map(([name,value],id)=>({id,name,value})));
  const [rows,setRows]=useState(()=>product.variants.map(v=>({...v,price:(v.priceMinor/100).toFixed(2),cost:v.costMinor===null?'':(v.costMinor/100).toFixed(2)})));
  const [reason,setReason]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const costChanged=rows.some(r=>{try{return (r.cost.trim()?toMinor(r.cost):null)!==r.costMinor;}catch{return true;}});
  useEffect(()=>{if(!dirty)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  function back(){if(!dirty||window.confirm('ข้อมูลที่ยังไม่บันทึกจะหายไป ต้องการออกจากหน้านี้หรือไม่?'))router.push('/catalog');}
  async function save(e:React.SubmitEvent<HTMLFormElement>){
    e.preventDefault();if(busy||conflict)return;setError('');
    try{
      const entries=details.map(d=>[d.name.trim(),d.value.trim()]);
      if(entries.some(([k,v])=>!k||!v))throw new Error('กรอกชื่อและค่ารายละเอียดให้ครบ หรือลบแถวที่ไม่ใช้');
      if(new Set(entries.map(([k])=>normalizeLabel(k))).size!==entries.length)throw new Error('ชื่อรายละเอียดสินค้าซ้ำกัน');
      const variants=rows.map(r=>({id:r.id,priceMinor:toMinor(r.price),costMinor:r.cost.trim()?toMinor(r.cost):null}));
      const parsed=productUpdateInput.safeParse({shopId,version:product.version,name,category,salesUnit:unit,attributes:Object.fromEntries(entries),variants,reason});
      if(!parsed.success)throw new Error('กรุณาตรวจข้อมูลสินค้าและจำนวนเงินที่กรอก');
      if(costChanged&&reason.trim().length<3)throw new Error('กรุณาระบุเหตุผลที่เปลี่ยนต้นทุนอย่างน้อย 3 ตัวอักษร');
      setBusy(true);
      const result=await request<{id:string}>(`/api/tenants/${tenantId}/products/${product.id}`,parsed.data,'PATCH');
      setDirty(false);router.push(`/catalog?saved=${result.id}`);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');setConflict(e instanceof RequestError&&e.code==='STALE_PRODUCT');setBusy(false);}
  }
  return <>
    <button className="text-button back-link" type="button" disabled={busy} onClick={back}><ArrowLeft size={16}/> กลับไปสินค้า</button>
    <div className="page-heading"><div><h1>แก้ไขสินค้า</h1><p>{shopName} · {product.variants.length} SKU</p></div></div>
    <form className="panel editor-form" onSubmit={save} onChange={()=>setDirty(true)}>
      <fieldset className="editor-fieldset" disabled={busy}>
        <section className="editor-section"><div className="section-caption"><h2>ข้อมูลสินค้า</h2><p>รายละเอียดที่ใช้ร่วมกันทุกตัวเลือก</p></div><div className="section-fields field-grid">
          <label className="full-width">ชื่อสินค้า<input required maxLength={150} value={name} onChange={e=>setName(e.target.value)}/></label>
          <label>หมวดสินค้า<input required maxLength={80} value={category} onChange={e=>setCategory(e.target.value)}/></label>
          <label>หน่วยขาย<select value={unit} onChange={e=>setUnit(e.target.value)}>{salesUnits.map(u=><option key={u}>{u}</option>)}</select></label>
        </div></section>
        <section className="editor-section"><div className="section-caption"><h2>รายละเอียดเพิ่มเติม</h2><p>เช่น วัสดุ ความจุ หรือวิธีดูแล</p></div><div className="section-fields">
          {details.map((d,i)=><div className="detail-row" key={d.id}>
            <input aria-label={`ชื่อรายละเอียด ${i+1}`} placeholder="ชื่อรายละเอียด" maxLength={40} value={d.name} onChange={e=>setDetails(details.map(x=>x.id===d.id?{...x,name:e.target.value}:x))}/>
            <input aria-label={`ค่ารายละเอียด ${i+1}`} placeholder="ค่า" maxLength={80} value={d.value} onChange={e=>setDetails(details.map(x=>x.id===d.id?{...x,value:e.target.value}:x))}/>
            <button className="icon-button" type="button" aria-label={`ลบรายละเอียด ${i+1}`} onClick={()=>{setDetails(details.filter(x=>x.id!==d.id));setDirty(true);}}><Trash2 size={16}/></button>
          </div>)}
          <button type="button" className="text-button" disabled={details.length>=12} onClick={()=>{setDetails([...details,{id:sequence.current++,name:'',value:''}]);setDirty(true);}}><Plus size={16}/>เพิ่มรายละเอียด</button>
        </div></section>
        <section className="editor-section variant-section"><div className="section-caption"><h2>ราคาและต้นทุน</h2><p>บาทต่อหน่วยขาย · เว้นต้นทุนว่างเมื่อยังไม่ทราบ ใส่ 0 เฉพาะกรณีไม่มีต้นทุน</p></div><div className="section-fields">
          <div className="table-scroll"><table className="variant-table"><thead><tr><th>SKU</th><th>ตัวเลือก</th><th>ราคาขาย (บาท)</th><th>ต้นทุนต่อหน่วย (บาท)</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.id}>
            <td><code>{r.sku}</code></td><td>{Object.entries(r.attributes).map(([k,v])=>`${k}: ${v}`).join(' / ')||'—'}</td>
            <td><input aria-label={`ราคาขาย ${r.sku}`} inputMode="decimal" required value={r.price} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,price:e.target.value}:x))}/></td>
            <td><input aria-label={`ต้นทุน ${r.sku}`} inputMode="decimal" placeholder="ยังไม่ระบุ" value={r.cost} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,cost:e.target.value}:x))}/></td>
          </tr>)}</tbody></table></div>
          <p className="field-help">รหัส SKU และตัวเลือกคงเดิม เพื่อใช้จับคู่รายงานการขาย ข้อมูลและราคาใช้ร่วมกันในร้านที่เชื่อมกับสินค้านี้</p>
          {costChanged&&<div className="cost-change-note"><label>เหตุผลที่เปลี่ยนต้นทุน<textarea required minLength={3} maxLength={500} rows={2} placeholder="เช่น ปรับตามใบสั่งซื้อรอบใหม่" value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="field-help">ต้นทุนใหม่มีผลตั้งแต่บันทึก โดยเก็บประวัติต้นทุนเดิมไว้</p></div>}
        </div></section>
      </fieldset>
      {error&&<div className="notice error" role="alert" tabIndex={-1} ref={errorRef}>{error}{conflict&&<button className="button secondary conflict-reload" type="button" onClick={()=>{if(window.confirm('โหลดข้อมูลล่าสุดและยกเลิกข้อมูลที่ยังไม่บันทึกในหน้านี้หรือไม่?'))router.refresh();}}>โหลดข้อมูลล่าสุด</button>}</div>}
      <div className="editor-footer"><span>{dirty?'มีการเปลี่ยนแปลงที่ยังไม่บันทึก':'แก้รายละเอียดหรือราคา แล้วบันทึกการเปลี่ยนแปลง'}</span><div className="form-actions"><button className="button secondary" type="button" disabled={busy} onClick={back}>ยกเลิก</button><button className="button primary" disabled={busy||!dirty||conflict}>{busy?'กำลังบันทึก…':'บันทึกการเปลี่ยนแปลง'}</button></div></div>
    </form>
    <section className="panel cost-history"><details open={product.history.length>0}><summary>ประวัติต้นทุน <span>{product.historyLimited?'100 รายการล่าสุด':`${product.history.length} รายการ`}</span></summary>
      {product.history.length?<div className="table-scroll"><table className="sku-table"><thead><tr><th>มีผลตั้งแต่</th><th>SKU</th><th className="numeric">ต้นทุนต่อหน่วย</th><th>หมายเหตุ</th></tr></thead><tbody>{product.history.map(h=><tr key={h.id}><td><time dateTime={h.effectiveAt}>{new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(h.effectiveAt))}</time></td><td><code>{h.sku}</code></td><td className="numeric">{h.amountMinor===null?'ยังไม่ระบุ':money(h.amountMinor)}</td><td>{h.note??'ต้นทุนเมื่อเพิ่มสินค้า'}</td></tr>)}</tbody></table></div>:<p className="field-help">ยังไม่มีการบันทึกต้นทุนของสินค้านี้</p>}
      <p className="field-help">เวลาในประเทศไทย · ประวัตินี้ยังไม่ได้เชื่อมกับการคำนวณกำไรจากออเดอร์</p>
    </details></section>
  </>;
}
