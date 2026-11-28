'use client';
import {useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {AlertTriangle,Bot,Building2,CheckCircle2,History,Power,PowerOff,ShieldCheck,Store} from 'lucide-react';
import {platformAgentRouteActivationInput,platformAgentRouteRevocationInput,type AgentRouteEnvironment} from '@commerce/contracts';
import {request} from '../lib/client';

type Tenant={
  tenantId:string;tenantName:string;shopCount:number;policyId:string|null;environment:AgentRouteEnvironment|null;
  dataScope:'synthetic'|null;status:'pending'|'active'|'revoked'|null;version:number|null;expiresAt:string|null;
  reason:string|null;updatedAt:string|null;eventCount:number;lastAction:'proposed'|'approved'|'activated'|'revoked'|null;lastEventAt:string|null;
};
type Dialog={tenant:Tenant;action:'activate'|'revoke'};
const dateTime=(value:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const futureLocal=(hours=4)=>{const date=new Date(Date.now()+hours*3600000-new Date().getTimezoneOffset()*60000);return date.toISOString().slice(0,16);};
const normalizedDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toISOString();};
function effectiveStatus(item:Tenant){
  if(item.status==='active'&&item.expiresAt&&new Date(item.expiresAt)>new Date())return 'active' as const;
  if(item.status==='active')return 'expired' as const;
  return item.status??'not_configured';
}
const statusLabels={active:'เปิดใช้งาน',expired:'หมดอายุ',pending:'รออนุมัติ',revoked:'ปิดใช้งาน',not_configured:'ยังไม่ตั้งค่า'} as const;

export function PlatformAiControlCenter({environment,tenants}:{environment:AgentRouteEnvironment;tenants:Tenant[]}){
  const router=useRouter(),errorRef=useRef<HTMLParagraphElement>(null);
  const [dialog,setDialog]=useState<Dialog|null>(null),[expiresAt,setExpiresAt]=useState(()=>futureLocal()),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[query,setQuery]=useState('');
  const visible=useMemo(()=>tenants.filter(item=>item.tenantName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[query,tenants]);
  const activeCount=tenants.filter(item=>effectiveStatus(item)==='active').length;
  function open(tenant:Tenant,action:Dialog['action']){setDialog({tenant,action});setExpiresAt(futureLocal());setReason(action==='activate'?'เปิดใช้งาน AI แบบอ่านอย่างเดียวสำหรับการทดสอบที่ได้รับอนุมัติ':'หยุดการใช้งาน AI และยกเลิก session ที่ยังเปิดอยู่');setConfirmed(false);setError('');setMessage('');}
  function showError(value:string){setError(value);queueMicrotask(()=>errorRef.current?.focus());}
  async function submit(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();if(!dialog)return;setError('');setBusy(true);
    try{
      if(dialog.action==='activate'){
        const input={tenantId:dialog.tenant.tenantId,version:dialog.tenant.version??0,environment,expiresAt:normalizedDate(expiresAt),reason,confirmed};
        if(!platformAgentRouteActivationInput.safeParse(input).success){showError(confirmed?'กำหนดเวลาหมดอายุและเหตุผลอย่างน้อย 10 ตัวอักษร':'กรุณายืนยันขอบเขตการเปิดใช้งาน');return;}
        await request('/api/platform/agent-routes',input);
        setMessage(`เปิด AI ให้ ${dialog.tenant.tenantName} แล้ว ระบบจะปิดอัตโนมัติตามเวลาที่กำหนด`);
      }else{
        const input={tenantId:dialog.tenant.tenantId,version:dialog.tenant.version??0,reason,confirmed};
        if(!platformAgentRouteRevocationInput.safeParse(input).success){showError(confirmed?'ระบุเหตุผลอย่างน้อย 10 ตัวอักษร':'กรุณายืนยันการปิดใช้งาน');return;}
        await request('/api/platform/agent-routes',input,'PATCH');
        setMessage(`ปิด AI ให้ ${dialog.tenant.tenantName} และยกเลิก session ที่ยังใช้งานแล้ว`);
      }
      setDialog(null);router.refresh();
    }catch(cause){showError(cause instanceof Error?cause.message:'บันทึกการตั้งค่าไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  return <div className="platform-ai-page">
    <header className="page-heading platform-ai-heading"><div><span className="orders-eyebrow">PLATFORM OPERATIONS</span><h1>AI Control Center</h1><p>เปิดหรือหยุดทีม AI รายบริษัท โดยไม่แก้ Environment Variable และไม่ต้อง deploy ใหม่</p></div><span className="service-security-label"><ShieldCheck size={15}/>Platform Owner</span></header>
    <div className="service-boundary-note"><ShieldCheck size={20}/><div><strong>Tenant policy อยู่ในฐานข้อมูลและมีประวัติทุกการเปลี่ยนแปลง</strong><p>Render เก็บเฉพาะ global availability และ emergency kill switch ส่วนบริษัท วันหมดอายุ และการ revoke จัดการจากหน้านี้</p></div></div>
    <section className="platform-ai-summary" aria-label="ภาพรวมการเปิดใช้ AI"><article><Building2 size={18}/><span><strong>{tenants.length}</strong><small>บริษัททั้งหมด</small></span></article><article><Bot size={18}/><span><strong>{activeCount}</strong><small>กำลังเปิด AI</small></span></article><article><History size={18}/><span><strong>{tenants.reduce((sum,item)=>sum+item.eventCount,0)}</strong><small>เหตุการณ์ที่บันทึก</small></span></article></section>
    {message&&<p className="notice success service-message" role="status"><CheckCircle2 size={16}/>{message}</p>}
    <section className="panel platform-ai-directory"><div className="platform-ai-toolbar"><div><h2>บริษัทในแพลตฟอร์ม</h2><p>Environment: <strong>{environment}</strong> · ข้อมูลทดสอบแบบอ่านอย่างเดียว</p></div><label><span className="sr-only">ค้นหาบริษัท</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="ค้นหาชื่อบริษัท"/></label></div>
      <div className="platform-ai-tenants">{visible.map(item=>{const state=effectiveStatus(item);return <article key={item.tenantId} className={`platform-ai-tenant ${state}`}><header><div className="platform-ai-tenant-title"><span><Building2 size={18}/></span><div><strong>{item.tenantName}</strong><small><Store size={12}/>{item.shopCount} ร้าน · <code>{item.tenantId}</code></small></div></div><span className={`pill ${state==='active'?'green':'neutral'}`}>{statusLabels[state]}</span></header><dl><div><dt>ขอบเขตข้อมูล</dt><dd>{item.dataScope==='synthetic'?'ข้อมูลสมมติ':'ยังไม่กำหนด'}</dd></div><div><dt>หมดอายุ</dt><dd>{item.expiresAt?dateTime(item.expiresAt):'—'}</dd></div><div><dt>เวอร์ชัน</dt><dd>{item.version??0}</dd></div><div><dt>ประวัติ</dt><dd>{item.eventCount} เหตุการณ์</dd></div></dl>{item.reason&&<p className="platform-ai-reason">{item.reason}</p>}<footer><span>{item.lastEventAt?`เปลี่ยนล่าสุด ${dateTime(item.lastEventAt)}`:'ยังไม่มีการเปลี่ยนแปลง'}</span>{state==='active'?<button className="button secondary" type="button" onClick={()=>open(item,'revoke')}><PowerOff size={15}/>ปิด AI</button>:<button className="button primary" type="button" onClick={()=>open(item,'activate')}><Power size={15}/>เปิด AI</button>}</footer></article>})}</div>
      {!visible.length&&<div className="empty-state"><Building2 size={26}/><h2>ไม่พบบริษัท</h2><p>ลองค้นหาด้วยชื่อบริษัทอีกครั้ง</p></div>}
    </section>
    {dialog&&<div className="catalog-dialog-backdrop" role="presentation"><section className="catalog-dialog platform-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-ai-dialog-title"><span className={dialog.action==='activate'?'credential-dialog-icon':'service-revoke-icon'}>{dialog.action==='activate'?<Power size={21}/>:<AlertTriangle size={21}/>}</span><h2 id="platform-ai-dialog-title">{dialog.action==='activate'?'เปิด AI':'ปิด AI'} · {dialog.tenant.tenantName}</h2><p>{dialog.action==='activate'?'สิทธิ์มีอายุสูงสุด 24 ชั่วโมง และระบบจะกลับสู่สถานะปิดเมื่อหมดเวลา':'Session และ grant ที่ยังเปิดอยู่ของบริษัทนี้จะถูกเพิกถอนทันที'}</p><form onSubmit={submit}>{dialog.action==='activate'&&<label>เปิดถึงเวลา<input type="datetime-local" value={expiresAt} min={futureLocal(.1)} max={futureLocal(24)} onChange={event=>setExpiresAt(event.target.value)}/><small className="field-help">แนะนำ 4 ชั่วโมงสำหรับรอบทดสอบ</small></label>}<label>เหตุผล <span className="required-note">จำเป็น</span><textarea rows={3} minLength={10} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label><label className="inventory-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span><strong>{dialog.action==='activate'?'ฉันยืนยันให้บริษัทนี้ใช้ AI แบบอ่านอย่างเดียว':'ฉันยืนยันให้หยุด AI และ session ที่ยังทำงาน'}</strong><small>ระบบจะบันทึกผู้ดำเนินการ เวลา เหตุผล และ policy version</small></span></label>{error&&<p ref={errorRef} className="notice error" role="alert" tabIndex={-1}>{error}</p>}<div className="catalog-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>{setDialog(null);setError('');}}>ยกเลิก</button><button type="submit" className={`button ${dialog.action==='activate'?'primary':'danger'}`} disabled={busy}>{busy?'กำลังบันทึก…':dialog.action==='activate'?'ยืนยันเปิด AI':'ยืนยันปิด AI'}</button></div></form></section></div>}
  </div>;
}
