'use client';
import Link from 'next/link';
import { useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft,ChevronDown,FileText } from 'lucide-react';
import type { Field,ImportInput,Mapping,Preview,SourceFile } from '@commerce/imports';
import { request,money } from '../lib/client';

type MappingField=Field|'sourceLineId'|'platformFee';
const requiredFields:Field[]=['orderId','sku','quantity','date','netSales'];
const mappingFields:MappingField[]=['orderId','sourceLineId','sku','quantity','date','netSales','platformFee'];
const labels:Record<MappingField,string>={orderId:'เลขคำสั่งซื้อ',sourceLineId:'รหัสรายการต้นทาง · แนะนำ',sku:'รหัส SKU',quantity:'จำนวน',date:'วันที่ขาย',netSales:'เงินรับสุทธิต่อรายการ (บาท)',platformFee:'ค่าธรรมเนียมแพลตฟอร์ม (บาท) · ไม่บังคับ'};
const emptyMapping:Mapping={orderId:'',sourceLineId:'',sku:'',quantity:'',date:'',netSales:'',platformFee:''};
const suggestedHeaders:Record<MappingField,string[]>={orderId:['order_id','เลขคำสั่งซื้อ'],sourceLineId:['source_line_id','line_id','order_item_id','item_id','รหัสรายการต้นทาง'],sku:['sku','รหัส sku'],quantity:['quantity','จำนวน'],date:['date','วันที่ขาย'],netSales:['net_receipt','net_sales','เงินรับสุทธิ'],platformFee:['platform_fee','ค่าธรรมเนียมแพลตฟอร์ม']};
type DraftRow={id:string;filename:string;created_at:string;total:number;invalid:number;batch_id:string|null;committed_at:string|null};
export function ImportWorkspace({tenantId,shopId,shopName,canWrite,drafts,initialPreview,initialDraftId,initialCommitted=false}:{tenantId:string;shopId:string;shopName:string;canWrite:boolean;drafts:DraftRow[];initialPreview?:Preview;initialDraftId?:string;initialCommitted?:boolean}){
  const router=useRouter(),fileRef=useRef<HTMLInputElement>(null);
  const [step,setStep]=useState(initialPreview?3:1),[source,setSource]=useState<SourceFile|null>(null),[delimiter,setDelimiter]=useState<SourceFile['delimiter']>(',');
  const [inspection,setInspection]=useState<{headers:string[];sample:string[][];total:number}|null>(null),[mapping,setMapping]=useState<Mapping>(emptyMapping);
  const [preview,setPreview]=useState<Preview|null>(initialPreview??null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(initialPreview?(initialCommitted?'นำเข้าร่างนี้แล้ว':'ร่างที่บันทึกไว้'):'');
  const [draftId,setDraftId]=useState(initialDraftId??''),[committed,setCommitted]=useState(initialCommitted),[confirmed,setConfirmed]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(!initialPreview);
  const endpoint=`/api/tenants/${tenantId}/imports`;
  const hasDuplicateRows=preview?.rows.some(r=>r.warnings.includes('ข้อมูลเหมือนรายการก่อนหน้า กรุณาตรวจว่าซ้ำหรือไม่'))??false;
  async function upload(file:File|undefined){
    if(!file)return;setError('');setSaved('');setBusy(true);
    try{
      if(!file.name.toLowerCase().endsWith('.csv'))throw new Error('เลือกรายงาน CSV หากเป็น Excel ให้บันทึกเป็น CSV UTF-8 ก่อน');
      if(file.size>1_048_576)throw new Error('ไฟล์มีขนาดเกิน 1 MB กรุณาแบ่งไฟล์');
      let csv:string;try{csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}catch{throw new Error('อ่านตัวอักษรไม่ได้ กรุณาบันทึกไฟล์เป็น CSV UTF-8');}
      const input={shopId,filename:file.name,csv,delimiter};
      const result=await request<NonNullable<typeof inspection>>(endpoint,{action:'inspect',input});
      setSource(input);setInspection(result);setPreview(null);
      setMapping(Object.fromEntries(mappingFields.map(f=>[f,result.headers.find(h=>suggestedHeaders[f].includes(h.toLowerCase()))??''])) as Mapping);setHistoryOpen(false);setStep(2);
    }catch(e){setError(e instanceof Error?e.message:'อ่านไฟล์ไม่สำเร็จ');}finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}
  }
  async function validate(){
    if(!source)return;setBusy(true);setError('');setSaved('');
    try{setPreview(await request<Preview>(endpoint,{action:'preview',input:{...source,mapping:{...mapping,sourceLineId:mapping.sourceLineId??'',platformFee:mapping.platformFee??''}} satisfies ImportInput}));setStep(3);}catch(e){setError(e instanceof Error?e.message:'ตรวจไฟล์ไม่สำเร็จ');}finally{setBusy(false);}
  }
  async function save(){
    if(!source)return;setBusy(true);setError('');
    try{const result=await request<{id:string;duplicate:boolean}>(endpoint,{action:'save',input:{...source,mapping:{...mapping,sourceLineId:mapping.sourceLineId??'',platformFee:mapping.platformFee??''}}});setDraftId(result.id);setSaved(result.duplicate?'ไฟล์และการจับคู่คอลัมน์นี้มีร่างที่บันทึกไว้แล้ว':'บันทึกร่างแล้ว ยังไม่รวมเป็นยอดขาย ตรวจความหมายของคอลัมน์ก่อนยืนยันนำเข้า');router.refresh();}catch(e){setError(e instanceof Error?e.message:'บันทึกร่างไม่สำเร็จ');}finally{setBusy(false);}
  }
  async function commit(){
    if(!draftId||!confirmed)return;setBusy(true);setError('');
    try{const result=await request<{id:string;duplicate:boolean;lines:number}>(endpoint,{action:'commit',input:{shopId,draftId}});setCommitted(true);setSaved(result.duplicate?'ร่างนี้ถูกนำเข้าไว้แล้ว ตัวเลขไม่ได้เพิ่มซ้ำ':`นำเข้า ${result.lines} รายการแล้ว ดูเงินรับและต้นทุนได้ทันที`);router.refresh();}
    catch(e){setError(e instanceof Error?e.message:'ยืนยันนำเข้าไม่สำเร็จ');}finally{setBusy(false);}
  }
  function reset(){setSource(null);setInspection(null);setPreview(null);setDraftId('');setCommitted(false);setConfirmed(false);setSaved('');setError('');setHistoryOpen(true);setStep(1);router.replace('/imports');}
  return <>
    <div className="page-heading"><div><h1>นำเข้ารายงาน</h1><p>{shopName} · ตรวจข้อมูลการขายจากไฟล์ CSV</p></div>{step>1&&canWrite&&<button type="button" className="button secondary" disabled={busy} onClick={reset}>เลือกไฟล์ใหม่</button>}</div>
    <ol className="import-steps" aria-label="ขั้นตอนนำเข้า">{['เลือกไฟล์','จับคู่คอลัมน์','ตรวจและยืนยัน'].map((s,i)=><li key={s} aria-current={step===i+1?'step':undefined} className={step===i+1?'current':''}><span>{i+1}</span>{s}</li>)}</ol>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {step===1&&canWrite&&<section className="panel import-upload"><div><h2>รายงานรายการขาย</h2><p>หนึ่งแถวต่อรายการสินค้าในคำสั่งซื้อ ต้องมีเลขคำสั่งซื้อ, SKU, จำนวน, วันที่ขาย และเงินรับสุทธิของรายการนั้น</p><p className="field-help">CSV UTF-8 · ไม่เกิน 1 MB / 1,000 รายการ · เพิ่มค่าธรรมเนียมแพลตฟอร์มได้เพื่อแสดงหลักฐาน แต่ระบบจะไม่หักซ้ำจากเงินรับสุทธิ</p></div><div className="upload-controls"><label>ตัวคั่นคอลัมน์<select value={delimiter} onChange={e=>setDelimiter(e.target.value as SourceFile['delimiter'])} disabled={busy}><option value=",">จุลภาค (,)</option><option value=";">อัฒภาค (;)</option><option value={'\t'}>แท็บ</option></select></label><input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="เลือกไฟล์ CSV" disabled={busy} onChange={e=>void upload(e.target.files?.[0])}/><span className="field-help">{busy?'กำลังอ่านไฟล์…':'ไฟล์จะถูกส่งไปตรวจในระบบ ไม่ส่งให้โมเดล AI'}</span><a className="text-link" href="/examples/orders-synthetic.csv" download>ดาวน์โหลดไฟล์ตัวอย่าง (ข้อมูลสมมติ)</a></div></section>}
    {step===1&&!canWrite&&<p className="notice">คุณเปิดดูร่างที่บันทึกไว้ได้ การนำเข้าไฟล์ต้องใช้สิทธิ์เจ้าของหรือการเงิน</p>}
    {step===2&&inspection&&source&&<section className="panel"><div className="panel-heading"><div><h2>จับคู่คอลัมน์</h2><p className="field-help">{source.filename} · {inspection.total} รายการ</p></div></div><p className="mapping-note">“เงินรับสุทธิ” ต้องเป็นยอดของรายการหลังหัก/บวกการปรับปรุงจากแพลตฟอร์มที่รวมอยู่ในตัวเลขนี้แล้ว ไม่ใช่ราคาต่อชิ้นหรือยอดโอนรวมทั้งร้าน ส่วนค่าธรรมเนียมเป็นข้อมูลประกอบและจะไม่ถูกหักซ้ำ</p>{!mapping.sourceLineId&&<p className="notice">แนะนำให้จับคู่รหัสรายการต้นทางจากแพลตฟอร์ม เพื่อป้องกันรายการขายเดิมถูกนับซ้ำเมื่ออยู่คนละไฟล์ หากไม่มี ระบบยังป้องกันการยืนยันร่างเดิมซ้ำได้</p>}<div className="mapping-list">{mappingFields.map(f=><div className="mapping-row" key={f}><label>{labels[f]}<select aria-label={`คอลัมน์ ${labels[f]}`} value={mapping[f]??''} onChange={e=>setMapping({...mapping,[f]:e.target.value})} disabled={busy}><option value="">{f==='platformFee'||f==='sourceLineId'?'ไม่ใช้คอลัมน์นี้':'เลือกคอลัมน์ในไฟล์'}</option>{inspection.headers.map(h=><option key={h}>{h}</option>)}</select></label><div className="mapping-sample"><span>ตัวอย่างจากไฟล์</span><code>{mapping[f]?inspection.sample.map(r=>r[inspection.headers.indexOf(mapping[f]!) ]).join(' · '):'—'}</code>{f==='date'&&<small>รูปแบบ YYYY-MM-DD เช่น 2026-09-16</small>}{f==='sourceLineId'&&<small>ต้องคงที่และไม่ซ้ำต่อหนึ่งรายการในร้าน</small>}</div></div>)}</div><div className="form-actions"><button type="button" className="button primary" disabled={busy||requiredFields.some(f=>!mapping[f])} onClick={validate}>{busy?'กำลังตรวจ…':'ตรวจรายการ'}</button></div></section>}
    {step===3&&preview&&<>
      <div className="import-source"><FileText size={18}/><strong>{preview.filename}</strong><span>{preview.total} รายการ</span></div>
      <div className="summary-strip import-summary"><div><span>ผ่านการตรวจรูปแบบ</span><strong>{preview.valid}<small>รายการ</small></strong></div><div><span>ต้องแก้ไข</span><strong className={preview.invalid?'text-error':''}>{preview.invalid}<small>รายการ</small></strong></div><div><span>มีข้อสังเกต</span><strong>{preview.warnings}<small>รายการ</small></strong></div></div>
      {!preview.mapping.sourceLineId&&<p className="notice">ร่างนี้ไม่มีรหัสรายการต้นทาง ระบบจึงยังตรวจรายการซ้ำข้ามไฟล์ไม่ได้</p>}
      <PreviewTable preview={preview}/>
      <p className="mapping-note">ผลนี้ตรวจรูปแบบและจับคู่ SKU แล้ว การยืนยันด้านล่างจะสร้างข้อมูลเงินรับแบบอ่านอย่างเดียวและ snapshot ต้นทุนตามวันที่ขาย หากต้นทุนไม่ครบ ระบบจะไม่คำนวณส่วนต่างรวม</p>
      {saved&&<p className="notice success" role="status">{saved}</p>}
      {source&&<div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>{setStep(2);setSaved('');}}><ArrowLeft size={16}/>แก้การจับคู่คอลัมน์</button><button type="button" className="button primary" disabled={busy||!!saved} onClick={save}>{busy?'กำลังบันทึก…':'บันทึกร่างเพื่อตรวจ'}</button></div>}
      {draftId&&canWrite&&!committed&&<section className="panel import-confirm"><h2>ยืนยันความหมายก่อนนำเข้า</h2>{hasDuplicateRows&&<p className="notice error">พบแถวที่เหมือนกันทั้งแถว กรุณานำแถวซ้ำออกจากไฟล์แล้วสร้างร่างใหม่ก่อนยืนยัน</p>}<label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>ฉันตรวจแล้วว่า “เงินรับสุทธิ” เป็นยอดต่อรายการตามนิยามด้านบน และค่าธรรมเนียมจะไม่ถูกหักซ้ำ</label><p className="field-help">ยืนยันแล้วจะแก้หรือลบรายการชุดนี้ไม่ได้ เพื่อรักษาประวัติที่ใช้ตรวจสอบตัวเลข</p><button type="button" className="button primary" disabled={busy||!confirmed||preview.invalid>0||hasDuplicateRows} onClick={commit}>{busy?'กำลังนำเข้า…':'ยืนยันนำเข้าข้อมูล'}</button></section>}
      {committed&&<div className="form-actions"><Link className="button primary" href="/performance">ดูเงินรับและต้นทุน</Link></div>}
    </>}
    <details className="panel import-history" open={historyOpen} onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary className="import-history-summary"><span><strong>ร่างที่บันทึกไว้</strong><small>ล่าสุด 30 รายการ</small></span><span className="history-toggle-label">{historyOpen?'ซ่อน':'แสดงประวัติ'}<ChevronDown size={17}/></span></summary><div className="import-history-content">{drafts.length?<div className="table-scroll"><table><thead><tr><th>ไฟล์</th><th>รายการ</th><th>ต้องแก้ไข</th><th>สถานะ</th><th>บันทึกเมื่อ</th></tr></thead><tbody>{drafts.map(d=><tr key={d.id}><td><Link className="text-link" href={`/imports?draft=${d.id}`}>{d.filename}</Link></td><td>{d.total}</td><td>{d.invalid}</td><td>{d.batch_id?<span className="pill green">นำเข้าแล้ว</span>:<span className="pill neutral">ร่าง</span>}</td><td>{new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(d.created_at))}</td></tr>)}</tbody></table></div>:<p className="quiet-empty">ยังไม่มีร่างรายงาน</p>}</div></details>
  </>;
}
function PreviewTable({preview}:{preview:Preview}){
  const [issuesOnly,setIssuesOnly]=useState(false),[page,setPage]=useState(0);
  const rows=issuesOnly?preview.rows.filter(r=>r.errors.length||r.warnings.length):preview.rows;
  const pages=Math.max(1,Math.ceil(rows.length/25)),current=Math.min(page,pages-1);
  return <section className="panel table-panel"><div className="table-toolbar"><label className="checkbox-label"><input type="checkbox" checked={issuesOnly} onChange={e=>{setIssuesOnly(e.target.checked);setPage(0);}}/>เฉพาะรายการที่ต้องตรวจ</label><span className="field-help">{rows.length} รายการ</span></div><div className="table-scroll"><table><thead><tr><th>รายการที่</th><th>คำสั่งซื้อ / SKU / ต้นทาง</th><th>วันที่ขาย</th><th className="numeric">จำนวน</th><th className="numeric">เงินรับสุทธิ</th><th className="numeric">ค่าธรรมเนียม</th><th>ผลตรวจ</th></tr></thead><tbody>{rows.slice(current*25,(current+1)*25).map(r=><tr key={r.record}><td>{r.record}</td><td><strong>{r.orderId||'—'}</strong><code>{r.sku||'—'}</code>{r.sourceLineId&&<small>ต้นทาง {r.sourceLineId}</small>}</td><td>{r.date||'—'}</td><td className="numeric">{r.quantity??'—'}</td><td className="numeric">{r.netSalesMinor===null?'—':money(r.netSalesMinor)}</td><td className="numeric">{r.platformFeeMinor===null?'—':money(r.platformFeeMinor)}</td><td className="issue-cell">{r.errors.map(x=><span className="text-error" key={x}>{x}</span>)}{r.warnings.map(x=><span className="text-warning" key={x}>{x}</span>)}{!r.errors.length&&!r.warnings.length&&<span>ผ่านการตรวจรูปแบบ</span>}</td></tr>)}</tbody></table></div>{!rows.length&&<p className="quiet-empty">ไม่มีรายการที่ต้องตรวจ</p>}<div className="table-footer"><span>รายการที่นับไม่รวมหัวคอลัมน์และบรรทัดว่าง</span><div className="pagination"><button type="button" className="button small secondary" disabled={current===0} onClick={()=>setPage(current-1)}>ก่อนหน้า</button><span>{current+1} / {pages}</span><button type="button" className="button small secondary" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>ถัดไป</button></div></div></section>;
}
