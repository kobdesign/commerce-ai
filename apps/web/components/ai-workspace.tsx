'use client';
import Link from 'next/link';
import { useEffect,useRef,useState,type FormEvent,type Ref } from 'react';
import { ArrowRight,BarChart3,Boxes,Landmark,Megaphone,PackageSearch,Search,ShieldCheck,Sparkles,UsersRound } from 'lucide-react';
import { request } from '../lib/client';
import type { AiRun,catalogEvidence } from '@commerce/ai';
import type {AgentWorkspaceState} from '../lib/agent-workspace';

type Evidence=Awaited<ReturnType<typeof catalogEvidence>>;
type Output={id:string;text:string;mode:string;evidence:Evidence};
type SerializedRun=Omit<AiRun,'created_at'>&{created_at:string};
type AgentSession={sessionId:string;expiresAt:string};
type AgentTurn={
 sessionId:string;deliveryId:string;status:'completed'|'awaiting_input';answer:string;
 delegatedAgents:string[];toolNames:string[];
 usage:{inputTokens:number;outputTokens:number;costUsd:number|null};nextStreamIndex:number;
};
type AgentExchange={question:string;turn:AgentTurn};
const suggestions=['สินค้ามีกี่หมวดและหมวดอะไรบ้าง','ยกตัวอย่าง SKU พร้อมหมวดสินค้า','สรุปความหลากหลายของสินค้าในร้าน'];
const date=(value:string)=>new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value));

export function AiWorkspace({tenantId,shopId,shopName,liveEnabled,agentTeam,initialRuns}:{tenantId:string;shopId:string;shopName:string;liveEnabled:boolean;agentTeam:AgentWorkspaceState;initialRuns:SerializedRun[]}){
 const [question,setQuestion]=useState(suggestions[0]),[activeMode,setActiveMode]=useState<'tool-preview'|'live'|null>(null),[error,setError]=useState(''),[output,setOutput]=useState<Output|null>(null),[historyRuns,setHistoryRuns]=useState(initialRuns);
 const errorRef=useRef<HTMLParagraphElement>(null),resultRef=useRef<HTMLElement>(null),busy=activeMode!==null;
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 useEffect(()=>{if(output)resultRef.current?.focus();},[output]);
 async function run(mode:'tool-preview'|'live'){
 setActiveMode(mode);setError('');setOutput(null);
  try{
   const result:Output=await request(`/api/tenants/${tenantId}/ai`,{shopId,question:mode==='tool-preview'?'ตรวจรายการสินค้าในร้านที่เลือก':question,mode});
   setOutput(result);setHistoryRuns(current=>[{id:result.id,mode:result.mode,status:'succeeded',model:null,created_at:new Date().toISOString(),input_tokens:null,output_tokens:null,estimated_cost_usd_micros:null,result:{text:result.text,evidence:result.evidence}},...current.filter(item=>item.id!==result.id)].slice(0,10));
  }
  catch(cause){setError(cause instanceof Error?cause.message:'ตรวจข้อมูลไม่สำเร็จ');}
  finally{setActiveMode(null);}
 }
 return <>
  <div className="page-heading ai-page-heading"><div><h1>ผู้ช่วยวิเคราะห์ข้อมูล</h1><p>{shopName} · อ่านข้อมูลเฉพาะร้านที่เลือก</p></div><span className="ai-readonly-label"><ShieldCheck size={16}/>อ่านและอธิบายเท่านั้น</span></div>
  <section className="ai-task-grid" aria-label="งานที่ผู้ช่วยทำได้">
   <article className="ai-task-card is-current"><Boxes size={22}/><div><strong>ตรวจรายการสินค้า</strong><p>นับ SKU หมวดสินค้า และแสดงรายการอ้างอิงจากร้านนี้</p><button type="button" className="text-button" disabled={busy} onClick={()=>void run('tool-preview')}>{activeMode==='tool-preview'?'กำลังตรวจ…':'ตรวจรายการสินค้า'}<ArrowRight size={15}/></button></div></article>
   <article className="ai-task-card"><BarChart3 size={22}/><div><strong>อธิบายเงินรับและต้นทุน</strong><p>ดูสูตร เงินเหลือ และย้อนกลับไปยังหลักฐานต้นทาง</p><Link className="text-link" href="/performance">เปิดหน้าการเงิน <ArrowRight size={15}/></Link></div></article>
   <article className="ai-task-card"><Landmark size={22}/><div><strong>ช่วยตรวจเงินโอน</strong><p>สรุปข้อยกเว้นจาก Statement และให้ผู้ใช้ยืนยันงานติดตาม</p><Link className="text-link" href="/settlements">เปิดผู้ช่วยกระทบยอด <ArrowRight size={15}/></Link></div></article>
  </section>
  <AgentTeamOverview state={agentTeam} tenantId={tenantId} shopId={shopId} shopName={shopName}/>
  <div className="ai-grid merchant-ai-grid">
   <main className="panel ai-workbench">
    <div className="ai-workbench-heading"><div><span className="section-eyebrow">ขอบเขตปัจจุบัน</span><h2>ถามเกี่ยวกับสินค้าในร้าน</h2><p>ผู้ช่วยจะใช้เครื่องมืออ่านรายการสินค้าใน {shopName} เท่านั้น ไม่มีเครื่องมือแก้สินค้า สั่งซื้อ หรือเปลี่ยนตัวเลข</p></div><span className={`pill ${liveEnabled?'green':'neutral'}`}>{liveEnabled?'เชื่อม AI แล้ว':'โหมดตรวจข้อมูล'}</span></div>
    {liveEnabled?<form className="ai-question-form" onSubmit={event=>{event.preventDefault();void run('live');}}><label htmlFor="assistant-question">คำถาม<textarea id="assistant-question" value={question} onChange={event=>setQuestion(event.target.value)} maxLength={1000} rows={4} disabled={busy}/><span className="field-help">ถามเฉพาะสินค้า SKU หมวด และคุณสมบัติที่บันทึกในร้านนี้</span></label><div className="ai-suggestions" aria-label="ตัวอย่างคำถาม"><span>ลองถาม</span>{suggestions.map(item=><button type="button" key={item} disabled={busy} onClick={()=>setQuestion(item)}>{item}</button>)}</div><button type="submit" className="button primary" disabled={busy||!question.trim()}><Sparkles size={16}/>{activeMode==='live'?'กำลังวิเคราะห์…':'ถามผู้ช่วย AI'}</button></form>:<div className="notice ai-offline-notice"><strong>ยังไม่ได้เปิดการเชื่อมต่อโมเดล AI</strong><p>ขณะนี้ใช้ “ตรวจข้อมูลโดยระบบ” ได้โดยไม่ส่งข้อมูลให้โมเดล และยังใช้ผู้ช่วยกระทบยอดที่คำนวณจากหลักฐานโดยตรงได้</p></div>}
    {error?<p ref={errorRef} tabIndex={-1} className="notice error" role="alert">{error}</p>:null}
    {output?<AssistantResult ref={resultRef} output={output} shopName={shopName}/>:<section className="ai-empty-result"><Search size={25}/><h3>เริ่มจากตรวจข้อมูลสินค้า</h3><p>ผลลัพธ์จะแสดงเวลา ขอบเขต ข้อจำกัด และ SKU ที่ใช้อ้างอิงทุกครั้ง</p></section>}
   </main>
   <HistoryPanel runs={historyRuns} shopName={shopName}/>
  </div>
 </>;
}

function AgentTeamOverview({state,tenantId,shopId,shopName}:{state:AgentWorkspaceState;tenantId:string;shopId:string;shopName:string}){
 const [session,setSession]=useState<AgentSession|null>(null),[streamIndex,setStreamIndex]=useState(0),[question,setQuestion]=useState('สัปดาห์หน้าควรโปรโมตสินค้าอะไร โดยไม่เสี่ยงของขาด'),[exchanges,setExchanges]=useState<AgentExchange[]>([]),[status,setStatus]=useState<'idle'|'starting'|'thinking'|'ending'>('idle'),[error,setError]=useState('');
 const busy=status!=='idle';
 async function ask(event:FormEvent){
  event.preventDefault();const message=question.trim();if(!message||busy)return;
  setError('');
  try{
   let active=session;
   if(!active){setStatus('starting');active=await request<AgentSession>(`/api/tenants/${tenantId}/agent-conversations`,{shopId});setSession(active);}
   setStatus('thinking');
   const turn=await request<AgentTurn>(`/api/tenants/${tenantId}/agent-conversations/${encodeURIComponent(active.sessionId)}/messages`,{message,streamIndex});
   setStreamIndex(turn.nextStreamIndex);setExchanges(current=>[...current,{question:message,turn}]);setQuestion('');
  }catch(cause){setError(cause instanceof Error?cause.message:'ยังติดต่อทีม AI ไม่สำเร็จ');}
  finally{setStatus('idle');}
 }
 async function end(){
  if(!session||busy)return;setStatus('ending');setError('');
  try{await request(`/api/tenants/${tenantId}/agent-conversations/${encodeURIComponent(session.sessionId)}/end`,{reason:'ผู้ใช้จบการสนทนาจากหน้า AI workspace'});setSession(null);setStreamIndex(0);setExchanges([]);setQuestion('สัปดาห์หน้าควรโปรโมตสินค้าอะไร โดยไม่เสี่ยงของขาด');}
  catch(cause){setError(cause instanceof Error?cause.message:'ยังจบการสนทนาไม่สำเร็จ');}
  finally{setStatus('idle');}
 }
 return <section className={`panel agent-team-overview ${state.canStart?'is-ready':'is-on-hold'}`} aria-labelledby="agent-team-title">
  <div className="agent-team-heading">
   <div><span className="section-eyebrow">ทีม AI Commerce</span><h2 id="agent-team-title">ผู้ช่วยหลายคนทำงานร่วมกัน</h2><p>Commerce Lead จะแบ่งงานให้ผู้เชี่ยวชาญด้านการตลาดและสต๊อก แล้วรวมคำแนะนำพร้อมหลักฐานจาก {shopName}</p></div>
   <span className={`pill ${state.canStart?'green':'neutral'}`}><span className="agent-status-dot" aria-hidden="true"/>{state.label}</span>
  </div>
  <div className="agent-team-grid" aria-label="สมาชิกทีม AI">
   <article><UsersRound size={20}/><div><strong>Commerce Lead</strong><p>รับคำถาม วางแผน และสรุปคำตอบจากผู้เชี่ยวชาญ</p></div></article>
   <article><Megaphone size={20}/><div><strong>Marketing Analysis</strong><p>อ่านยอดขายและหาโอกาสโปรโมตสินค้า</p></div></article>
   <article><PackageSearch size={20}/><div><strong>Inventory Analysis</strong><p>ตรวจสต๊อก ความเสี่ยงของขาด และความพร้อมขาย</p></div></article>
  </div>
  {state.canStart?<div className="agent-conversation">
   <div className="agent-conversation-safety"><ShieldCheck size={18}/><div><strong>ทดสอบแบบอ่านข้อมูลเท่านั้น</strong><p>{state.message} ทุกคำขอถูกจำกัดเฉพาะ {shopName} และไม่มีสิทธิ์แก้สต๊อกหรือข้อมูลการเงิน</p></div>{session?<button type="button" className="button secondary" disabled={busy} onClick={()=>void end()}>{status==='ending'?'กำลังจบ…':'จบการสนทนา'}</button>:null}</div>
   {exchanges.length?<div className="agent-transcript" aria-live="polite">{exchanges.map(exchange=><article key={exchange.turn.deliveryId}>
    <p className="agent-user-message"><strong>คุณ</strong>{exchange.question}</p>
    <div className="agent-answer"><strong>Commerce Lead</strong><p>{exchange.turn.answer||'ทีม AI รอข้อมูลยืนยันเพิ่มเติม'}</p>
     <div className="agent-answer-evidence"><span>ทีมที่ร่วมวิเคราะห์: {exchange.turn.delegatedAgents.length?exchange.turn.delegatedAgents.join(', '):'Commerce Lead'}</span><span>เครื่องมืออ่านข้อมูล: {exchange.turn.toolNames.length?exchange.turn.toolNames.join(', '):'ไม่มี'}</span><span>Token: {exchange.turn.usage.inputTokens.toLocaleString('th-TH')} เข้า · {exchange.turn.usage.outputTokens.toLocaleString('th-TH')} ออก</span></div>
    </div>
   </article>)}</div>:null}
   <form className="agent-conversation-form" onSubmit={ask}><label htmlFor="agent-team-question">ถามทีม AI<textarea id="agent-team-question" rows={3} maxLength={2000} value={question} disabled={busy} onChange={event=>setQuestion(event.target.value)}/><span className="field-help">ตัวอย่าง: สัปดาห์หน้าควรโปรโมตสินค้าอะไร โดยไม่เสี่ยงของขาด</span></label><button type="submit" className="button primary" disabled={busy||!question.trim()}><Sparkles size={16}/>{status==='starting'?'กำลังเปิดห้องสนทนา…':status==='thinking'?'ทีมกำลังวิเคราะห์…':'ส่งให้ทีม AI'}</button></form>
   {error?<p className="notice error" role="alert">{error}</p>:null}
  </div>:<div className="agent-team-state"><ShieldCheck size={18}/><div><strong>ระบบยังป้องกันการเรียก AI อยู่</strong><p>{state.message} ระหว่างนี้ยังใช้เมนูตรวจข้อมูลด้านล่างได้ตามปกติ</p></div></div>}
 </section>;
}

function AssistantResult({ref,output,shopName}:{ref:Ref<HTMLElement>;output:Output;shopName:string}){
 const systemResult=output.mode==='tool-preview';
 return <section ref={ref} tabIndex={-1} className="ai-result merchant-ai-result" role="status" aria-labelledby="assistant-result-title">
  <header><span className={`pill ${systemResult?'neutral':'green'}`}>{systemResult?'ผลจากระบบ · ไม่ได้เรียก AI':'คำตอบจากโมเดล AI'}</span><h2 id="assistant-result-title">ผลการวิเคราะห์</h2></header>
  <p className="result-text">{output.text}</p>
  <dl className="ai-evidence-summary"><div><dt>ร้านที่อ่านข้อมูล</dt><dd>{shopName}</dd></div><div><dt>ข้อมูลที่ใช้</dt><dd>รายการสินค้าและ SKU</dd></div><div><dt>ตรวจเมื่อ</dt><dd>{date(output.evidence.asOf)}</dd></div><div><dt>ขอบเขต</dt><dd>{output.evidence.listedSkuCount} SKU · {output.evidence.categories.length} หมวด{output.evidence.truncated?' · แสดงไม่ครบทุก SKU':''}</dd></div></dl>
  <div className="ai-limitations"><strong>ข้อจำกัดของคำตอบนี้</strong><ul>{output.evidence.limitations.map(item=><li key={item}>{item}</li>)}<li>ผลลัพธ์นี้ไม่เปลี่ยนข้อมูลหรือสร้างงานโดยอัตโนมัติ</li></ul></div>
  <div className="evidence"><h3>สินค้าและ SKU ที่ใช้อ้างอิง</h3>{output.evidence.examples.length?<><EvidenceItems items={output.evidence.examples.slice(0,5)}/>{output.evidence.examples.length>5?<details className="ai-evidence-more"><summary>ดูอีก {output.evidence.examples.length-5} SKU</summary><EvidenceItems items={output.evidence.examples.slice(5)}/></details>:null}</>:<p className="quiet-empty">ร้านนี้ยังไม่มีสินค้าให้อ้างอิง</p>}<small>อ้างอิงจากข้อมูลที่ผู้ใช้มีสิทธิ์เข้าถึงในร้านที่เลือกเท่านั้น</small></div>
 </section>;
}

function EvidenceItems({items}:{items:Evidence['examples']}){
 return <ul>{items.map(item=><li key={item.evidenceRef}><span><strong>{item.name}</strong><small>{item.category}</small></span><code>{item.sku}</code></li>)}</ul>;
}

function HistoryPanel({runs,shopName}:{runs:SerializedRun[];shopName:string}){
 return <aside className="panel ai-history"><div><h2>ประวัติของร้านนี้</h2><p className="field-help">{shopName} · ล่าสุด 10 ครั้ง</p></div>{runs.length?<div className="ai-history-list">{runs.map(run=><details className="run-row" data-run-id={run.id} key={run.id}><summary><span>{date(run.created_at)}<small>{run.mode==='tool-preview'?'ตรวจข้อมูลโดยระบบ':'คำตอบจาก AI'}</small></span><span className={`pill ${run.status==='succeeded'?'green':'neutral'}`}>{run.status==='succeeded'?'สำเร็จ':run.status==='failed'?'ไม่สำเร็จ':'กำลังทำงาน'}</span></summary>{run.result?<div className="run-result"><p>{run.result.text}</p><small>{run.result.evidence.listedSkuCount} SKU · ตรวจเมื่อ {date(run.result.evidence.asOf)}</small></div>:<p className="field-help">ยังไม่มีผลลัพธ์ที่บันทึก</p>}</details>)}</div>:<p className="quiet-empty">ยังไม่มีประวัติในร้านนี้</p>}</aside>;
}
