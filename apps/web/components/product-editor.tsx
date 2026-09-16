'use client';
import { useEffect,useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft,Plus,Trash2 } from 'lucide-react';
import { attributeMap,buildCombinations,normalizeLabel,productFamilyInput,salesUnits,variantKey } from '@commerce/contracts';
import { request,toMinor } from '../lib/client';
import { mergeOptionValues,OptionValues } from './option-values';

type Detail={id:number;name:string;value:string};
type Axis={id:number;name:string;values:string[];draft:string};
type Row={attributes:Record<string,string>;sku:string;price:string;cost:string};

export function ProductEditor({tenantId,shopId,shopName,categories}:{tenantId:string;shopId:string;shopName:string;categories:string[]}){
  const router=useRouter(),sequence=useRef(0),errorRef=useRef<HTMLDivElement>(null);
  const [details,setDetails]=useState<Detail[]>([]),[axes,setAxes]=useState<Axis[]>([]),[rows,setRows]=useState<Row[]>([]);
  const [name,setName]=useState(''),[category,setCategory]=useState(''),[unit,setUnit]=useState<string>('ชิ้น');
  const [sku,setSku]=useState(''),[price,setPrice]=useState(''),[cost,setCost]=useState('');
  const [multiple,setMultiple]=useState(false),[generated,setGenerated]=useState(''),[dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
  const signature=JSON.stringify(axes.map(a=>({name:a.name.trim(),values:a.values})));
  const stale=multiple&&(generated!==signature||axes.some(a=>a.draft.trim()));
  useEffect(()=>{if(!dirty)return;const handler=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  function back(){if(!dirty||window.confirm('ข้อมูลที่ยังไม่บันทึกจะหายไป ต้องการออกจากหน้านี้หรือไม่?'))router.push('/catalog');}
  function generate(){
    setError('');setNote('');
    try{
      if(!sku.trim())throw new Error('กรอกรหัส SKU หลักก่อนสร้างรายการตัวเลือก');
      const completeAxes=axes.map(a=>({...a,name:a.name.trim(),values:mergeOptionValues(a.values,a.draft).values,draft:''}));
      const combinations=buildCombinations(completeAxes);
      const previous=new Map(rows.map(r=>[variantKey(r.attributes),r]));
      const used=new Set(rows.map(r=>normalizeLabel(r.sku)));let sequence=1;
      setRows(combinations.map(attributes=>{
        const existing=previous.get(variantKey(attributes));if(existing)return existing;
        let code:string;do{code=`${sku.trim()}-${String(sequence++).padStart(2,'0')}`;}while(used.has(normalizeLabel(code)));
        used.add(normalizeLabel(code));return {attributes,sku:code,price,cost};
      }));
      setAxes(completeAxes);setGenerated(JSON.stringify(completeAxes.map(a=>({name:a.name,values:a.values}))));setDirty(true);setNote(`สร้าง ${combinations.length} SKU แล้ว ตรวจรหัสและราคาก่อนบันทึก`);
    }catch(e){setError(e instanceof Error?e.message:'ตรวจตัวเลือกอีกครั้ง');}
  }
  function updateRow(index:number,key:'sku'|'price'|'cost',value:string){setRows(rows.map((r,i)=>i===index?{...r,[key]:value}:r));}
  async function save(e:React.SubmitEvent<HTMLFormElement>){
    e.preventDefault();setError('');setNote('');
    try{
      const entries=details.map(d=>[d.name.trim(),d.value.trim()]);
      if(entries.some(([k,v])=>!k||!v))throw new Error('กรอกชื่อและค่ารายละเอียดให้ครบ หรือลบแถวที่ไม่ใช้');
      if(new Set(entries.map(([k])=>normalizeLabel(k))).size!==entries.length)throw new Error('ชื่อรายละเอียดสินค้าซ้ำกัน กรุณาใช้ชื่อที่ต่างกัน');
      const parsed=attributeMap.safeParse(Object.fromEntries(entries));
      if(!parsed.success)throw new Error('ตรวจชื่อและค่ารายละเอียดสินค้า: ชื่อไม่เกิน 40 ตัวอักษร ค่าไม่เกิน 80 ตัวอักษร');
      if(multiple&&(stale||!rows.length))throw new Error('กดสร้างรายการ SKU หลังแก้ตัวเลือก แล้วตรวจรายการก่อนบันทึก');
      const variants=(multiple?rows:[{attributes:{},sku,price,cost}]).map(r=>({...r,sku:r.sku.trim(),priceMinor:toMinor(r.price),costMinor:r.cost.trim()?toMinor(r.cost):null})).map(({attributes,sku,priceMinor,costMinor})=>({attributes,sku,priceMinor,costMinor}));
      const input=productFamilyInput.safeParse({shopId,name,category,salesUnit:unit,attributes:parsed.data,variants});
      if(!input.success)throw new Error(input.error.issues[0]?.message||'กรุณาตรวจข้อมูลสินค้า');
      setBusy(true);
      const result=await request<{id:string}>(`/api/tenants/${tenantId}/products`,input.data);
      setDirty(false);router.push(`/catalog?saved=${result.id}`);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');setBusy(false);}
  }
  return <>
    <button className="text-button back-link" type="button" onClick={back}><ArrowLeft size={16}/> กลับไปสินค้า</button>
    <div className="page-heading"><div><h1>เพิ่มสินค้า</h1><p>ร้าน {shopName}</p></div></div>
    <form onSubmit={save} onChange={()=>setDirty(true)} className="editor-form">
      <fieldset disabled={busy} className="editor-fieldset">
        <section className="editor-section"><div className="section-caption"><h2>ข้อมูลสินค้า</h2><p>ข้อมูลที่ใช้ร่วมกันทุก SKU</p></div><div className="section-fields field-grid">
          <label className="full-width">ชื่อสินค้า <input value={name} onChange={e=>setName(e.target.value)} required maxLength={150} placeholder="เช่น กางเกงชิโนขายาว รุ่น Everyday"/></label>
          <label>หมวดสินค้า<input value={category} onChange={e=>setCategory(e.target.value)} list="product-categories" required maxLength={80} placeholder="เลือกหรือพิมพ์หมวดใหม่"/></label>
          <datalist id="product-categories">{Array.from(new Set([...categories,'เสื้อผ้า','ของใช้ในบ้าน','สกินแคร์','เครื่องเขียน'])).map(c=><option key={c}>{c}</option>)}</datalist>
          <label>หน่วยขาย<select value={unit} onChange={e=>setUnit(e.target.value)}>{salesUnits.map(u=><option key={u}>{u}</option>)}</select></label>
        </div></section>
        <section className="editor-section"><div className="section-caption"><h2>รายละเอียดสินค้า</h2><p>เช่น เนื้อผ้า วัสดุ หรือวิธีดูแล<br/>ใช้เหมือนกันทุกตัวเลือก</p></div><div className="section-fields">
          {!details.length&&<p className="field-help">เว้นว่างได้ หากต้องการแยกขนาด S, M, L ให้เพิ่มในส่วนตัวเลือกขายด้านล่าง</p>}
          {details.map((d,i)=><div className="detail-row" key={d.id}><label>ชื่อรายละเอียด {i+1}<input value={d.name} onChange={e=>setDetails(details.map(x=>x.id===d.id?{...x,name:e.target.value}:x))} maxLength={40} placeholder="เช่น เนื้อผ้า" required/></label><label>ค่ารายละเอียด {i+1}<input value={d.value} onChange={e=>setDetails(details.map(x=>x.id===d.id?{...x,value:e.target.value}:x))} maxLength={80} placeholder="เช่น คอตตอน 100%" required/></label><button type="button" className="icon-button danger" aria-label={`ลบรายละเอียด ${i+1}`} onClick={()=>{setDetails(details.filter(x=>x.id!==d.id));setDirty(true);}}><Trash2 size={17}/></button></div>)}
          <button type="button" className="text-button" disabled={details.length>=12} onClick={()=>{setDetails([...details,{id:++sequence.current,name:'',value:''}]);setDirty(true);}}><Plus size={16}/>เพิ่มรายละเอียด</button><span className="field-limit">{details.length}/12</span>
        </div></section>
        <section className="editor-section"><div className="section-caption"><h2>ราคาและรหัสสินค้า</h2><p>ราคาเป็นบาทต่อหน่วยขาย<br/>ต้นทุนที่ยังไม่ทราบเว้นว่างได้</p></div><div className="section-fields field-grid">
          <label className="full-width">{multiple?'รหัส SKU หลัก':'รหัส SKU'}<input aria-label={multiple?'รหัส SKU หลัก':'รหัส SKU'} value={sku} onChange={e=>setSku(e.target.value)} required maxLength={multiple?55:64} placeholder="เช่น CHINO-01"/><span className="field-help">{multiple?'ใช้ตั้งรหัสเริ่มต้น เช่น CHINO-01-01 แก้รหัสแต่ละรายการได้ด้านล่าง':'ใช้รหัสที่ตรงกับรายการขายของร้าน รหัสต้องไม่ซ้ำในบริษัท'}</span></label>
          <label>ราคาขาย (บาท)<input value={price} onChange={e=>setPrice(e.target.value)} inputMode="decimal" required={!multiple} placeholder="0.00"/></label>
          <label>ต้นทุนต่อหน่วย (บาท)<input value={cost} onChange={e=>setCost(e.target.value)} inputMode="decimal" placeholder="ยังไม่ทราบ"/></label>
          {multiple&&rows.length>0&&<button type="button" className="text-button full-width" onClick={()=>{if(window.confirm('ใช้ราคาและต้นทุนด้านบนกับทุก SKU?')){setRows(rows.map(r=>({...r,price,cost})));setDirty(true);}}}>ใช้ราคาและต้นทุนนี้กับทุก SKU</button>}
        </div></section>
        <section className="editor-section"><div className="section-caption"><h2>ตัวเลือกขาย</h2><p>เช่น สี ไซซ์ กลิ่น หรือความจุ<br/>แต่ละชุดตัวเลือกมี SKU ของตัวเอง</p></div><div className="section-fields">
          <label className="checkbox-label option-toggle"><input type="checkbox" checked={multiple} onChange={e=>{if(!e.target.checked&&rows.length&&!window.confirm('เปลี่ยนเป็นสินค้า SKU เดียว? รายการตัวเลือกยังเก็บไว้จนกว่าจะบันทึก'))return;setMultiple(e.target.checked);if(e.target.checked&&!axes.length)setAxes([{id:++sequence.current,name:'',values:[],draft:''}]);}}/>สินค้ามีหลายตัวเลือก</label>
          {multiple?<>
            {axes.map((axis,i)=><div className="axis-row" key={axis.id}>
              <div className="axis-header"><label>ชื่อตัวเลือก {i+1}<input value={axis.name} onChange={e=>setAxes(axes.map(a=>a.id===axis.id?{...a,name:e.target.value}:a))} maxLength={40} placeholder="เช่น ขนาด หรือสี" required/></label><button className="icon-button danger" type="button" aria-label={`ลบตัวเลือก ${i+1}`} onClick={()=>{setAxes(axes.filter(a=>a.id!==axis.id));setDirty(true);}}><Trash2 size={17}/></button></div>
              <OptionValues index={i+1} name={axis.name} values={axis.values} draft={axis.draft} onChange={(values,draft)=>{setAxes(previous=>previous.map(a=>a.id===axis.id?{...a,values,draft}:a));setDirty(true);setNote('');}}/>
            </div>)}
            <div className="row-actions"><button type="button" className="text-button" disabled={axes.length>=3} onClick={()=>{setAxes([...axes,{id:++sequence.current,name:'',values:[],draft:''}]);setDirty(true);}}><Plus size={16}/>เพิ่มประเภทตัวเลือก</button><span className="field-limit">{axes.length}/3</span></div>
            <div className="generation-bar"><p>เช่น 2 สี × 3 ไซซ์ = 6 SKU · สูงสุด 100 SKU ต่อสินค้า</p><button type="button" className="button secondary" onClick={generate}>{rows.length?'อัปเดตรายการ SKU':'สร้างรายการ SKU'}</button></div>
          </>:<p className="field-help">บันทึกเป็นสินค้า 1 SKU โดยไม่ต้องกำหนดตัวเลือก</p>}
        </div></section>
        {multiple&&rows.length>0&&<section className="variant-section"><div className="section-title-row"><h2>รายการที่จะบันทึก <span className="count-pill">{rows.length} SKU</span></h2></div>{stale&&<p className="notice amber">ตัวเลือกถูกแก้ไขแล้ว กด “อัปเดตรายการ SKU” ก่อนบันทึก ราคาและรหัสของชุดตัวเลือกเดิมจะยังอยู่</p>}<div className="table-scroll"><table className="variant-table"><thead><tr><th>ตัวเลือก</th><th>รหัส SKU</th><th>ราคาขาย (บาท)</th><th>ต้นทุน (บาท)</th><th><span className="sr-only">ลบ</span></th></tr></thead><tbody>{rows.map((r,i)=><tr key={variantKey(r.attributes)}><td>{Object.entries(r.attributes).map(([k,v])=><span className="option-line" key={k}>{k}: <strong>{v}</strong></span>)}</td><td><input aria-label={`SKU รายการ ${i+1}`} value={r.sku} required maxLength={64} onChange={e=>updateRow(i,'sku',e.target.value)}/></td><td><input aria-label={`ราคาขายรายการ ${i+1}`} value={r.price} required inputMode="decimal" onChange={e=>updateRow(i,'price',e.target.value)}/></td><td><input aria-label={`ต้นทุนรายการ ${i+1}`} value={r.cost} inputMode="decimal" placeholder="ยังไม่ทราบ" onChange={e=>updateRow(i,'cost',e.target.value)}/></td><td><button type="button" className="icon-button danger" aria-label={`ลบ SKU รายการ ${i+1}`} onClick={()=>{setRows(rows.filter((_,j)=>j!==i));setDirty(true);}}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div><p className="field-help">ลบชุดตัวเลือกที่ไม่ได้ขายได้ การอัปเดตรายการ SKU จะสร้างชุดตัวเลือกทั้งหมดอีกครั้ง</p></section>}
      </fieldset>
      {error&&<div className="notice error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      {note&&<p className="notice" role="status">{note}</p>}
      <div className="editor-footer"><span>{multiple?`${rows.length} SKU`:'1 SKU'} · บันทึกในร้าน {shopName}</span><div><button className="button secondary" type="button" disabled={busy} onClick={back}>ยกเลิก</button><button className="button primary" disabled={busy}>{busy?'กำลังบันทึก…':'บันทึกสินค้า'}</button></div></div>
    </form>
  </>;
}
