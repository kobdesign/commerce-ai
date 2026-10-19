'use client';
import { useEffect,useRef,useState } from 'react';
import { Check,Eye,EyeOff,Headset,LockKeyhole,ShieldCheck,Square,Timer,UserRound,Wifi } from 'lucide-react';

type SessionState='idle'|'consent'|'waiting'|'active'|'ended';
const synthetic={
  name:'ลูกค้าทดสอบ ก.',email:'synthetic.customer@example.test',bank:'ธนาคารตัวอย่าง •••• 4455',evidence:'statement-synthetic-sep.csv',apiKey:'sk_test_SYNTHETIC_ONLY',otp:'842913',
};
const rows=Array.from({length:24},(_,index)=>({sku:`SYN-${String(index+1).padStart(3,'0')}`,name:index%2?'กางเกงชิโน่ขายาว':'กางเกงชิโน่ขาสั้น',status:index%3?'พร้อมขาย':'รอตรวจต้นทุน'}));
function sessionCode(){const value=new Uint32Array(1);crypto.getRandomValues(value);return String(value[0]%1_000_000).padStart(6,'0');}
function clock(seconds:number){return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}

export function SupportPocWorkspace({organizationName}:{organizationName:string}){
  const [state,setState]=useState<SessionState>('idle'),[code,setCode]=useState(''),[agentCode,setAgentCode]=useState(''),[agentError,setAgentError]=useState('');
  const [remaining,setRemaining]=useState(600),[topic,setTopic]=useState('เพิ่มผู้ใช้ในทีมไม่ได้'),[detail,setDetail]=useState('ไม่พบปุ่มกำหนดสิทธิ์ของผู้ใช้ใหม่'),[dynamicOpen,setDynamicOpen]=useState(false);
  const consentButton=useRef<HTMLButtonElement>(null),dynamicField=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(state==='consent')consentButton.current?.focus();},[state]);
  useEffect(()=>{if(dynamicOpen)dynamicField.current?.focus();},[dynamicOpen]);
  useEffect(()=>{
    if(state!=='waiting'&&state!=='active')return;
    const timer=window.setInterval(()=>setRemaining(value=>{if(value<=1){setState('ended');setAgentCode('');return 0;}return value-1;}),1000);
    return()=>window.clearInterval(timer);
  },[state]);
  useEffect(()=>{
    function escape(event:KeyboardEvent){if(event.key==='Escape'){if(dynamicOpen)setDynamicOpen(false);else if(state==='consent')setState('idle');}}
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[dynamicOpen,state]);
  function requestHelp(){setState('consent');setAgentError('');}
  function consent(){setCode(sessionCode());setRemaining(600);setState('waiting');setAgentCode('');setAgentError('');}
  function claim(){if(!/^\d{6}$/.test(agentCode)||agentCode!==code){setAgentError('รหัสไม่ถูกต้อง หรือ session นี้ไม่พร้อมให้เชื่อมต่อ');return;}setAgentError('');setState('active');}
  function stop(){setState('ended');setCode('');setAgentCode('');setDynamicOpen(false);}
  const sharing=state==='waiting'||state==='active';
  return <>
    <div className="page-heading support-poc-heading"><div><span className="support-eyebrow">SUPPORT-01 · SYNTHETIC POC</span><h1>พื้นที่ทดสอบ Co-browsing</h1><p>ทดสอบการช่วยเหลือลูกค้าแบบดูอย่างเดียวก่อนเชื่อมผู้ให้บริการจริง</p></div><span className="pill neutral"><ShieldCheck size={14}/> ไม่มีข้อมูลจริง</span></div>
    {sharing&&<section className="support-share-bar" role="status" aria-live="polite"><span className="support-live-dot"/><div><strong>{state==='active'?'กำลังแชร์หน้าแบบจำลอง':'รอเจ้าหน้าที่เชื่อมต่อ'}</strong><small>ดูได้เฉพาะส่วนที่อนุญาต · เหลือเวลา {clock(remaining)}</small></div><button type="button" className="button secondary" onClick={stop}><Square size={15}/>หยุดแชร์</button></section>}
    {state==='ended'&&<div className="notice" role="status">จบการแชร์แล้ว เจ้าหน้าที่ไม่สามารถเชื่อมต่อด้วยรหัสเดิมได้</div>}
    <div className="support-poc-grid">
      <section className="panel support-customer-surface" aria-labelledby="customer-surface-heading">
        <header className="support-pane-heading"><div><span className="support-pane-icon"><UserRound size={18}/></span><div><h2 id="customer-surface-heading">หน้าของลูกค้า</h2><p>{organizationName} · ข้อมูลสมมติ</p></div></div><span className="pill neutral">Customer view</span></header>
        <div className="support-safe-block" data-support-share="case-summary"><label>หัวข้อที่ต้องการความช่วยเหลือ<input aria-label="หัวข้อที่ต้องการความช่วยเหลือ" value={topic} onChange={event=>setTopic(event.target.value)} maxLength={100}/></label><label>อธิบายปัญหา<textarea aria-label="อธิบายปัญหา" value={detail} onChange={event=>setDetail(event.target.value)} rows={3} maxLength={300}/></label></div>
        <div className="support-data-grid">
          <article data-support-pii><span><LockKeyhole size={15}/>ข้อมูลส่วนบุคคล</span><strong>{synthetic.name}</strong><small>{synthetic.email}</small></article>
          <article data-support-financial><span><LockKeyhole size={15}/>ข้อมูลการเงิน</span><strong>{synthetic.bank}</strong><small>ยอดเงินสมมติ 12,450.00 บาท</small></article>
          <article data-support-evidence><span><LockKeyhole size={15}/>หลักฐานต้นฉบับ</span><strong>{synthetic.evidence}</strong><small>SHA-256: synthetic-only</small></article>
          <article data-support-secret><span><LockKeyhole size={15}/>Secret และ OTP</span><strong>{synthetic.apiKey}</strong><small>OTP {synthetic.otp}</small></article>
        </div>
        <div className="support-test-actions"><button type="button" className="button secondary" onClick={()=>setDynamicOpen(true)}>เปิดฟอร์ม Dynamic</button>{state==='idle'||state==='ended'?<button type="button" className="button primary" onClick={requestHelp}><Headset size={17}/>ขอความช่วยเหลือ</button>:<span className="field-help"><LockKeyhole size={14}/> Session นี้เป็น view-only</span>}</div>
        <section className="support-table-section" data-support-share="catalog-list"><div><h3>ตารางสินค้าสำหรับทดสอบการเลื่อน</h3><small>24 รายการสมมติ · พื้นที่นี้อนุญาตให้เห็น</small></div><div className="support-scroll-table" tabIndex={0} aria-label="รายการสินค้าสมมติ"><table><thead><tr><th>SKU</th><th>สินค้า</th><th>สถานะ</th></tr></thead><tbody>{rows.map(row=><tr key={row.sku}><td><code>{row.sku}</code></td><td>{row.name}</td><td>{row.status}</td></tr>)}</tbody></table></div></section>
      </section>
      <aside className="panel support-agent-console" aria-labelledby="agent-console-heading">
        <header className="support-pane-heading"><div><span className="support-pane-icon agent"><Headset size={18}/></span><div><h2 id="agent-console-heading">Agent Console จำลอง</h2><p>ไม่ได้เชื่อมต่อผู้ให้บริการ</p></div></div><span className="pill amber"><Eye size={14}/>ดูอย่างเดียว</span></header>
        {state==='waiting'&&<div className="support-agent-claim"><label>รหัส Session<input aria-label="รหัส Session สำหรับเจ้าหน้าที่" inputMode="numeric" autoComplete="off" maxLength={6} value={agentCode} onChange={event=>setAgentCode(event.target.value.replace(/\D/g,''))} placeholder="000000"/></label><button type="button" className="button primary" onClick={claim}>เชื่อมต่อแบบจำลอง</button>{agentError&&<p role="alert" className="text-error">{agentError}</p>}</div>}
        {state==='active'?<div className="support-agent-preview" aria-label="ภาพที่เจ้าหน้าที่เห็น"><div className="support-preview-status"><Wifi size={16}/><span><strong>เชื่อมต่อแล้ว</strong><small>Tenant และ Case ตรงกัน</small></span><Timer size={15}/><code>{clock(remaining)}</code></div><section><span className="support-preview-label">หน้าปัจจุบัน</span><strong>Support PoC / Catalog surface</strong></section><section><span className="support-preview-label">ปัญหาที่ลูกค้าแจ้ง</span><strong>{topic||'ยังไม่ระบุหัวข้อ'}</strong><p>{detail||'ยังไม่มีรายละเอียด'}</p></section>{dynamicOpen&&<section><span className="support-preview-label">Dynamic layer</span><strong>ฟอร์มรายละเอียดปัญหาเปิดอยู่</strong><small>ค่าที่จัดเป็น PII และ Secret ถูกปกปิด</small></section>}<section className="support-masked-summary"><div><EyeOff size={16}/><span><strong>ปกปิด 4 กลุ่มข้อมูล</strong><small>PII · การเงิน · หลักฐาน · Secret/OTP</small></span></div>{['ชื่อและอีเมล','บัญชีและยอดเงิน','ไฟล์ต้นฉบับ','API key และ OTP'].map(label=><p key={label}><LockKeyhole size={14}/>{label}<span>ปกปิด</span></p>)}</section><div className="support-view-only-note"><Check size={16}/><span><strong>View-only enforcement</strong><small>ไม่มีปุ่ม click, type หรือ submit ไปยังหน้าลูกค้า</small></span></div></div>:<div className="support-agent-empty"><span><Headset size={24}/></span><h3>{state==='waiting'?'กรอกรหัสจากลูกค้า':'ยังไม่มี session ที่เชื่อมต่อ'}</h3><p>{state==='waiting'?'รหัสต้องตรงกับ tenant, case และเจ้าหน้าที่ที่ได้รับมอบหมาย':'เริ่มจากปุ่ม “ขอความช่วยเหลือ” ในหน้าลูกค้า'}</p></div>}
        {sharing&&<div className="support-code-card" data-support-secret><span>รหัสสำหรับ PoC</span><code aria-label="รหัส Co-browsing">{code}</code><small>ใช้ครั้งเดียว · อายุ 10 นาที · ในระบบจริงเก็บเฉพาะ hash</small></div>}
        <div className="support-policy-list"><h3>Policy ที่บังคับใช้</h3>{['Explicit consent','Exact tenant / case / agent','Private by default','Recording ปิด','Remote control ปิด'].map(label=><p key={label}><Check size={14}/>{label}</p>)}</div>
      </aside>
    </div>
    {state==='consent'&&<div className="support-modal-backdrop" role="presentation"><section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-consent-title"><span className="support-modal-icon"><ShieldCheck size={23}/></span><h2 id="support-consent-title">อนุญาตให้เจ้าหน้าที่ดูหน้านี้หรือไม่</h2><p>เจ้าหน้าที่จะเห็นเฉพาะส่วนที่ระบบอนุญาตและแนะนำตำแหน่งบนหน้าได้ โดยไม่สามารถกดปุ่ม พิมพ์ข้อมูล หรือส่งรายการแทนคุณ</p><ul><li>ข้อมูลส่วนบุคคล การเงิน หลักฐาน และรหัสลับถูกปกปิด</li><li>แชร์เฉพาะหน้าในระบบ Commerce</li><li>หยุดแชร์ได้ตลอดเวลา และ session หมดอายุใน 10 นาที</li></ul><div className="support-modal-actions"><button type="button" className="button secondary" onClick={()=>setState('idle')}>ยังไม่แชร์</button><button ref={consentButton} type="button" className="button primary" onClick={consent}>ยินยอมและสร้างรหัส</button></div></section></div>}
    {dynamicOpen&&<div className="support-modal-backdrop" role="presentation"><section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="dynamic-modal-title"><span className="support-modal-icon neutral-icon"><Headset size={22}/></span><h2 id="dynamic-modal-title">รายละเอียดปัญหาแบบ Dynamic</h2><p>ใช้ทดสอบการเพิ่ม element หลังเริ่ม session และ Thai IME</p><label data-support-share="dynamic-note">ข้อความที่แชร์ได้<input ref={dynamicField} aria-label="ข้อความภาษาไทยใน Dynamic modal" defaultValue="ช่วยชี้ตำแหน่งปุ่มเพิ่มสมาชิกให้หน่อย"/></label><label data-support-pii>เบอร์โทรศัพท์สมมติ<input aria-label="เบอร์โทรศัพท์สมมติ" defaultValue="080-000-0000"/></label><label data-support-secret>รหัส OTP สมมติ<input aria-label="รหัส OTP สมมติ" defaultValue={synthetic.otp}/></label><div className="support-modal-actions"><button type="button" className="button primary" onClick={()=>setDynamicOpen(false)}>ปิดฟอร์มทดสอบ</button></div></section></div>}
  </>;
}
