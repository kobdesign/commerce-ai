'use client';
import { ChevronDown } from 'lucide-react';
import { useMemo,useRef,useState } from 'react';

export function EditableCombobox({id,label,value,options,placeholder,required=false,maxLength,disabled=false,onChange}:{id:string;label:string;value:string;options:string[];placeholder?:string;required?:boolean;maxLength?:number;disabled?:boolean;onChange:(value:string)=>void}){
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const wrapperRef=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLInputElement>(null);
  const suggestions=useMemo(()=>{
    const query=value.trim().toLocaleLowerCase('th-TH');
    return [...new Set(options.map(option=>option.trim()).filter(Boolean))].filter(option=>!query||option.toLocaleLowerCase('th-TH').includes(query));
  },[options,value]);
  const activeIndex=Math.min(active,Math.max(0,suggestions.length-1));
  function choose(option:string){onChange(option);setOpen(false);setActive(0);}
  function keyDown(event:React.KeyboardEvent<HTMLInputElement>){
    if(event.key==='ArrowDown'){event.preventDefault();setActive(index=>open?Math.min(index+1,Math.max(0,suggestions.length-1)):0);setOpen(true);}
    else if(event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActive(index=>Math.max(index-1,0));}
    else if(event.key==='Enter'&&open&&suggestions[activeIndex]){event.preventDefault();choose(suggestions[activeIndex]);}
    else if(event.key==='Escape'){event.preventDefault();setOpen(false);}
  }
  return <div className="editable-combobox" ref={wrapperRef} onBlurCapture={event=>{if(!wrapperRef.current?.contains(event.relatedTarget as Node|null))setOpen(false);}}>
    <label htmlFor={id}>{label}</label>
    <div className="editable-combobox-control">
      <input ref={inputRef} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open&&suggestions.length?`${id}-option-${activeIndex}`:undefined} value={value} required={required} maxLength={maxLength} disabled={disabled} placeholder={placeholder} onFocus={()=>setOpen(true)} onChange={event=>{onChange(event.target.value);setOpen(true);setActive(0);}} onKeyDown={keyDown}/>
      <button type="button" aria-label={`${open?'ปิด':'เปิด'}รายการ${label}`} aria-expanded={open} disabled={disabled} onClick={()=>{const next=!open;setOpen(next);if(next)inputRef.current?.focus();}}><ChevronDown size={17} aria-hidden="true"/></button>
    </div>
    {open&&<div className="editable-combobox-menu"><ul id={`${id}-options`} role="listbox" aria-label={`รายการ${label}`}>{suggestions.length?suggestions.map((option,index)=><li id={`${id}-option-${index}`} role="option" aria-selected={value===option} key={option}><button type="button" className={index===activeIndex?'active':''} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option)}>{option}</button></li>):<li className="editable-combobox-empty">ไม่พบหมวดเดิม ใช้ข้อความนี้เป็นหมวดใหม่ได้</li>}</ul><p>เลือกจากรายการหรือพิมพ์หมวดใหม่</p></div>}
  </div>;
}
