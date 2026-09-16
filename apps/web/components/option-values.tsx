'use client';
import { useId,useRef,useState } from 'react';
import { Plus,X } from 'lucide-react';
import { normalizeLabel } from '@commerce/contracts';

export function mergeOptionValues(existing:string[],text:string){
  const additions=text.split(/[,，\r\n]/).map(v=>v.trim()).filter(Boolean);
  if(additions.some(v=>v.length>80))throw new Error('แต่ละค่าต้องยาวไม่เกิน 80 ตัวอักษร');
  const values=[...existing],known=new Set(existing.map(normalizeLabel)),duplicates:string[]=[];
  for(const value of additions){
    const key=normalizeLabel(value);
    if(known.has(key)){duplicates.push(value);continue;}
    values.push(value);known.add(key);
  }
  if(values.length>100)throw new Error('เพิ่มได้สูงสุด 100 ค่าต่อประเภท และรวมไม่เกิน 100 SKU');
  return {values,duplicates};
}

export function OptionValues({index,name,values,draft,onChange}:{index:number;name:string;values:string[];draft:string;onChange:(values:string[],draft:string)=>void}){
  const id=useId(),input=useRef<HTMLInputElement>(null);
  const [message,setMessage]=useState(''),[invalid,setInvalid]=useState(false);
  function commit(text=draft){
    try{
      const next=mergeOptionValues(values,text);
      onChange(next.values,'');setInvalid(false);
      setMessage(next.duplicates.length?`มีค่า ${next.duplicates.join(', ')} อยู่แล้ว จึงไม่เพิ่มซ้ำ`:next.values.length>values.length?`เพิ่มแล้ว รวม ${next.values.length} ค่า`:'พิมพ์ค่าที่ต้องการเพิ่ม');
      input.current?.focus();
    }catch(error){setInvalid(true);setMessage(error instanceof Error?error.message:'เพิ่มค่าไม่สำเร็จ');}
  }
  return <div className="option-values">
    <label htmlFor={id}>ค่าตัวเลือก {index}</label>
    <p className="field-help" id={`${id}-help`}>พิมพ์ทีละค่าแล้วกด Enter หรือปุ่มเพิ่ม</p>
    <ul className="option-chips" aria-label={`ค่าที่เพิ่มในตัวเลือก ${index}`}>
      {values.map(value=><li key={normalizeLabel(value)}><span>{value}</span><button type="button" aria-label={`ลบค่า ${value} ในตัวเลือก ${index}`} onClick={()=>{onChange(values.filter(v=>v!==value),draft);setInvalid(false);setMessage(`ลบ ${value} แล้ว เหลือ ${values.length-1} ค่า`);input.current?.focus();}}><X size={14}/></button></li>)}
    </ul>
    <div className="option-value-entry"><input id={id} ref={input} value={draft} maxLength={8100} aria-describedby={`${id}-help ${id}-message`} aria-invalid={invalid||undefined} placeholder={values.length?'เพิ่มอีกค่า…':'เช่น S'} onChange={e=>{onChange(values,e.target.value);setInvalid(false);setMessage('');}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(['Enter',',','，'].includes(e.key)){e.preventDefault();commit();}}} onPaste={e=>{const text=e.clipboardData.getData('text');if(!/[,，\r\n]/.test(text))return;e.preventDefault();const el=e.currentTarget;commit(draft.slice(0,el.selectionStart??draft.length)+text+draft.slice(el.selectionEnd??draft.length));}}/><button type="button" className="button secondary" aria-label={`เพิ่มค่าในตัวเลือก ${index}`} disabled={!draft.trim()} onClick={()=>commit()}><Plus size={16}/>เพิ่ม</button></div>
    {['ขนาด','ไซซ์','ไซส์','size'].includes(normalizeLabel(name))&&<div className="size-suggestion"><span>ขนาดที่ใช้บ่อย</span><button type="button" className="text-button" onClick={()=>commit([draft,'S, M, L, XL'].filter(Boolean).join(','))}>เพิ่ม S, M, L, XL</button></div>}
    <p id={`${id}-message`} className={`option-message${invalid?' text-error':''}`} aria-live="polite">{message||`${values.length} ค่า${draft.trim()?' · ค่าที่กำลังพิมพ์จะถูกรวมเมื่อกดสร้างรายการ SKU':''}`}</p>
  </div>;
}
