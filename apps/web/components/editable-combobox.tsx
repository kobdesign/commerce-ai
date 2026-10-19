'use client';
import { ChevronDown } from 'lucide-react';
import { useMemo,useRef,useState } from 'react';

type ComboboxFieldProps={
  id:string;
  label:string;
  value:string;
  options:string[];
  placeholder?:string;
  required?:boolean;
  maxLength?:number;
  disabled?:boolean;
  allowCustomValue?:boolean;
  emptyMessage?:string;
  helperText?:string;
  onChange:(value:string)=>void;
};

export function ComboboxField({id,label,value,options,placeholder,required=false,maxLength,disabled=false,allowCustomValue=true,emptyMessage='ไม่พบรายการที่ตรงกัน',helperText,onChange}:ComboboxFieldProps){
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const wrapperRef=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLInputElement>(null);
  const suggestions=useMemo(()=>{
    const unique=[...new Set(options.map(option=>option.trim()).filter(Boolean))];
    if(!allowCustomValue)return unique;
    const query=value.trim().toLocaleLowerCase('th-TH');
    return unique.filter(option=>!query||option.toLocaleLowerCase('th-TH').includes(query));
  },[allowCustomValue,options,value]);
  const activeIndex=Math.min(active,Math.max(0,suggestions.length-1));
  function showOptions(){setActive(Math.max(0,suggestions.indexOf(value)));setOpen(true);}
  function choose(option:string){onChange(option);setOpen(false);setActive(0);}
  function keyDown(event:React.KeyboardEvent<HTMLInputElement>){
    if(event.key==='ArrowDown'){event.preventDefault();if(open)setActive(index=>Math.min(index+1,Math.max(0,suggestions.length-1)));else showOptions();}
    else if(event.key==='ArrowUp'){event.preventDefault();if(open)setActive(index=>Math.max(index-1,0));else{showOptions();setActive(Math.max(0,suggestions.length-1));}}
    else if(event.key==='Home'&&open){event.preventDefault();setActive(0);}
    else if(event.key==='End'&&open){event.preventDefault();setActive(Math.max(0,suggestions.length-1));}
    else if(event.key==='Enter'&&open&&suggestions[activeIndex]){event.preventDefault();choose(suggestions[activeIndex]);}
    else if(event.key==='Escape'){event.preventDefault();setOpen(false);}
  }
  return <div className={`editable-combobox${allowCustomValue?'':' fixed-options'}`} ref={wrapperRef} onBlurCapture={event=>{if(!wrapperRef.current?.contains(event.relatedTarget as Node|null))setOpen(false);}}>
    <label htmlFor={id}>{label}</label>
    <div className="editable-combobox-control">
      <input ref={inputRef} id={id} role="combobox" aria-autocomplete={allowCustomValue?'list':'none'} aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open&&suggestions.length?`${id}-option-${activeIndex}`:undefined} aria-readonly={!allowCustomValue} value={value} required={required} readOnly={!allowCustomValue} maxLength={maxLength} disabled={disabled} placeholder={placeholder} onFocus={()=>{if(allowCustomValue)showOptions();}} onClick={()=>{if(!allowCustomValue)showOptions();}} onChange={event=>{if(allowCustomValue){onChange(event.target.value);setOpen(true);setActive(0);}}} onKeyDown={keyDown}/>
      <button type="button" aria-label={`${open?'ปิด':'เปิด'}รายการ${label}`} aria-expanded={open} disabled={disabled} onClick={()=>{if(open)setOpen(false);else{showOptions();inputRef.current?.focus();}}}><ChevronDown size={17} aria-hidden="true"/></button>
    </div>
    {open&&<div className="editable-combobox-menu"><ul id={`${id}-options`} role="listbox" aria-label={`รายการ${label}`}>{suggestions.length?suggestions.map((option,index)=><li role="presentation" key={option}><button id={`${id}-option-${index}`} type="button" role="option" aria-selected={value===option} className={index===activeIndex?'active':''} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option)}>{option}</button></li>):<li className="editable-combobox-empty">{emptyMessage}</li>}</ul>{helperText&&<p>{helperText}</p>}</div>}
  </div>;
}
