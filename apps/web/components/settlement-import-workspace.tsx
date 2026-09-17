'use client';

import { useRef,useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft,ChevronDown,Download,FileText,FileUp } from 'lucide-react';
import type { MarketplaceSettlementInspection,MarketplaceSettlementSource,SettlementImportBatch,SettlementImportField,SettlementImportInput,SettlementImportMapping,SettlementImportPreview,SettlementImportSource } from '@commerce/finance';
import { money,request } from '../lib/client';

const fields:SettlementImportField[]=['payoutReference','settledOn','payoutTotal','sourceLineId','orderId','amount'];
const labels:Record<SettlementImportField|string,string>={payoutReference:'รหัสรอบโอน',settledOn:'วันที่โอน',payoutTotal:'ยอดโอนรวม (บาท)',sourceLineId:'รหัสบรรทัดต้นทาง',orderId:'เลขคำสั่งซื้อ',amount:'ยอดจัดสรร (บาท)',note:'หมายเหตุ · ไม่บังคับ'};
const suggestions:Record<SettlementImportField|string,string[]>={
  payoutReference:['payout_reference','payout_id','รหัสรอบโอน'],settledOn:['settled_on','payout_date','วันที่โอน'],payoutTotal:['payout_total','total_payout','ยอดโอนรวม'],
  sourceLineId:['source_line_id','line_id','transaction_id','รหัสบรรทัดต้นทาง'],orderId:['order_id','เลขคำสั่งซื้อ'],amount:['allocation_amount','amount','ยอดจัดสรร'],note:['note','หมายเหตุ'],
};
const emptyMapping:SettlementImportMapping={payoutReference:'',settledOn:'',payoutTotal:'',sourceLineId:'',orderId:'',amount:'',note:''};
type Inspection={headers:string[];sample:string[][];total:number};
const shortHash=(value:string)=>`${value.slice(0,8)}…${value.slice(-8)}`;
const formatBytes=(value:number)=>value<1024?`${value} B`:`${(value/1024).toFixed(1)} KB`;
const adapterName=(key:string)=>({'tiktok-shop-th':'TikTok Shop','shopee-th':'Shopee','lazada-th':'Lazada','generic-settlement-lines':'CSV กำหนดคอลัมน์เอง'}[key]??key);
function base64(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer);let binary='';
  for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return btoa(binary);
}

export function SettlementImportWorkspace({tenantId,shopId,canWrite,batches}:{tenantId:string;shopId:string;canWrite:boolean;batches:SettlementImportBatch[]}){
  const router=useRouter(),fileRef=useRef<HTMLInputElement>(null),endpoint=`/api/tenants/${tenantId}/settlement-imports`;
  const [step,setStep]=useState(1),[delimiter,setDelimiter]=useState<SettlementImportSource['delimiter']>(','),[source,setSource]=useState<SettlementImportSource|null>(null);
  const [marketplaceSource,setMarketplaceSource]=useState<MarketplaceSettlementSource|null>(null);
  const [inspection,setInspection]=useState<Inspection|null>(null),[mapping,setMapping]=useState<SettlementImportMapping>(emptyMapping),[preview,setPreview]=useState<SettlementImportPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[confirmed,setConfirmed]=useState(false);

  async function upload(file:File|undefined){
    if(!file)return;setBusy(true);setError('');setSaved('');
    try{
      const lower=file.name.toLowerCase(),xlsx=lower.endsWith('.xlsx');
      if(!xlsx&&!lower.endsWith('.csv'))throw new Error('เลือกไฟล์ CSV หรือ XLSX ที่ดาวน์โหลดจาก Seller Center');
      if(file.size>(xlsx?5_242_880:1_048_576))throw new Error(`ไฟล์มีขนาดเกิน ${xlsx?'5':'1'} MB กรุณาแบ่งช่วงวันที่แล้วดาวน์โหลดใหม่`);
      const buffer=await file.arrayBuffer(),marketplaceInput:MarketplaceSettlementSource={shopId,filename:file.name,contentBase64:base64(buffer),contentType:xlsx?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv',...(xlsx?{}:{delimiter})};
      const detected=await request<MarketplaceSettlementInspection>(endpoint,{action:'inspect-marketplace',input:marketplaceInput});
      if(detected.detected){
        setSource(null);setInspection(null);setMapping(detected.preview.mapping);setPreview(detected.preview);setMarketplaceSource({...marketplaceInput,adapterKey:detected.preview.adapterKey});setConfirmed(false);setStep(3);return;
      }
      if(xlsx)throw new Error('ยังระบุรูปแบบไฟล์ XLSX นี้ไม่ได้ กรุณาใช้ไฟล์ตัวอย่างจาก Seller Center หรือส่งตัวอย่างที่ปกปิดข้อมูลเพื่อเพิ่มเวอร์ชันตัวอ่าน');
      let csv:string;try{csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{throw new Error('อ่านตัวอักษรไม่ได้ กรุณาบันทึกไฟล์เป็น CSV UTF-8');}
      const input={shopId,filename:file.name,csv,delimiter},result:Inspection={headers:detected.headers,sample:detected.sample,total:detected.total};
      setMarketplaceSource(null);setSource(input);setInspection(result);setPreview(null);setConfirmed(false);
      setMapping(Object.fromEntries([...fields,'note'].map(field=>[field,result.headers.find(header=>suggestions[field].includes(header.toLowerCase()))??''])) as SettlementImportMapping);setStep(2);
    }catch(reason){setError(reason instanceof Error?reason.message:'อ่านไฟล์ statement ไม่สำเร็จ');}
    finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}
  }
  async function validate(){
    if(!source)return;setBusy(true);setError('');setSaved('');
    try{setPreview(await request<SettlementImportPreview>(endpoint,{action:'preview',input:{...source,mapping} satisfies SettlementImportInput}));setStep(3);}
    catch(reason){setError(reason instanceof Error?reason.message:'ตรวจไฟล์ statement ไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  async function commit(){
    if((!source&&!marketplaceSource)||!preview||!confirmed)return;setBusy(true);setError('');setSaved('');
    try{
      const result=await request<{duplicate:boolean;lines:number;payouts:number;unmatchedLines:number}>(endpoint,marketplaceSource?{action:'commit-marketplace',input:{...marketplaceSource,confirmedStatement:true}}:{action:'commit',input:{...source!,mapping,confirmedStatement:true}});
      setSaved(result.duplicate?'ไฟล์และการจับคู่คอลัมน์นี้ถูกนำเข้าแล้ว ระบบไม่ได้เพิ่มยอดซ้ำ':`นำเข้า ${result.lines} บรรทัด จาก ${result.payouts} รอบโอนแล้ว${result.unmatchedLines?` · มี ${result.unmatchedLines} บรรทัดที่ยังไม่พบคำสั่งซื้อ`:''}`);setConfirmed(false);router.refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:'ยืนยันนำเข้า statement ไม่สำเร็จ');}
    finally{setBusy(false);}
  }
  function reset(){setStep(1);setSource(null);setMarketplaceSource(null);setInspection(null);setMapping(emptyMapping);setPreview(null);setError('');setSaved('');setConfirmed(false);}

  return <section className="panel settlement-import-panel">
    <details open={step>1}>
      <summary><span className="settlement-import-summary"><span className="settlement-import-icon"><FileUp size={20}/></span><span><strong>นำเข้า statement จากไฟล์</strong><small>รองรับ CSV/XLSX และตรวจจับแพลตฟอร์มอัตโนมัติ</small></span></span><span className="history-toggle-label">{step>1?'กำลังนำเข้า':'เปิด'}<ChevronDown size={17}/></span></summary>
      {canWrite?<div className="settlement-import-body">
        <ol className="import-steps settlement-import-steps" aria-label="ขั้นตอนนำเข้า statement">{['เลือกไฟล์','จับคู่คอลัมน์','ตรวจและยืนยัน'].map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined} className={step===index+1?'current':''}><span>{index+1}</span>{label}</li>)}</ol>
        {error&&<p className="notice error" role="alert">{error}</p>}
        {step===1&&<div className="settlement-import-upload"><div><h3>เลือกไฟล์ statement</h3><p>ระบบตรวจจับ TikTok Shop, Shopee และ Lazada จากหัวคอลัมน์ หากยังไม่รู้จักจะให้จับคู่คอลัมน์ CSV ตามเดิม</p><p className="field-help">CSV UTF-8 ไม่เกิน 1 MB · XLSX ไม่เกิน 5 MB · สูงสุด 1,000 บรรทัด · ไฟล์จะไม่ถูกส่งให้โมเดล AI</p></div><div className="upload-controls"><label>ตัวคั่น CSV<select value={delimiter} disabled={busy} onChange={event=>setDelimiter(event.target.value as SettlementImportSource['delimiter'])}><option value=",">จุลภาค (,)</option><option value=";">อัฒภาค (;)</option><option value={'\t'}>แท็บ</option></select></label><input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="เลือกไฟล์ statement CSV หรือ XLSX" disabled={busy} onChange={event=>void upload(event.target.files?.[0])}/><div className="settlement-example-links"><span>ไฟล์ตัวอย่างข้อมูลสมมติ</span><a className="text-link" href="/examples/tiktok-settlement-synthetic.xlsx" download>TikTok · XLSX</a><a className="text-link" href="/examples/shopee-income-synthetic.csv" download>Shopee</a><a className="text-link" href="/examples/lazada-statement-synthetic.csv" download>Lazada</a><a className="text-link" href="/examples/settlements-synthetic.csv" download>ไฟล์กลาง</a></div></div></div>}
        {step===2&&inspection&&source&&<div className="settlement-import-mapping"><div className="panel-heading"><div><h3>จับคู่คอลัมน์</h3><p className="field-help">{source.filename} · {inspection.total} บรรทัด</p></div><button type="button" className="button secondary" disabled={busy} onClick={reset}>เลือกไฟล์ใหม่</button></div><p className="mapping-note">ยอดโอนรวมต้องเป็นยอดเดียวกันทุกบรรทัดที่ใช้รหัสรอบโอนเดียวกัน ส่วนยอดจัดสรรคือส่วนของคำสั่งซื้อในบรรทัดนั้น</p><div className="mapping-list">{[...fields,'note'].map(field=><div className="mapping-row" key={field}><label>{labels[field]}<select aria-label={`คอลัมน์ ${labels[field]}`} value={mapping[field as keyof SettlementImportMapping]??''} disabled={busy} onChange={event=>setMapping({...mapping,[field]:event.target.value})}><option value="">{field==='note'?'ไม่ใช้คอลัมน์นี้':'เลือกคอลัมน์ในไฟล์'}</option>{inspection.headers.map(header=><option key={header}>{header}</option>)}</select></label><div className="mapping-sample"><span>ตัวอย่างจากไฟล์</span><code>{mapping[field as keyof SettlementImportMapping]?inspection.sample.map(row=>row[inspection.headers.indexOf(mapping[field as keyof SettlementImportMapping]??'')]).join(' · '):'—'}</code>{field==='settledOn'&&<small>รูปแบบ YYYY-MM-DD เช่น 2026-09-17</small>}</div></div>)}</div><div className="form-actions"><button type="button" className="button primary" disabled={busy||fields.some(field=>!mapping[field])} onClick={validate}>{busy?'กำลังตรวจ…':'ตรวจรายการ'}</button></div></div>}
        {step===3&&preview&&(source||marketplaceSource)&&<div className="settlement-import-preview"><div className="import-source"><FileText size={18}/><strong>{preview.filename}</strong><span>{preview.total} บรรทัด · {preview.payoutCount} รอบโอน</span>{preview.adapterLabel&&<span className="pill neutral">ตรวจจับ: {preview.adapterLabel}{preview.sourceSheet?` · ${preview.sourceSheet}`:''}</span>}</div>{preview.notices?.map(notice=><p className="notice" key={notice}>{notice}</p>)}<div className="summary-strip import-summary"><div><span>ผ่านรูปแบบ</span><strong>{preview.valid}<small>บรรทัด</small></strong></div><div><span>ต้องแก้ไข</span><strong className={preview.invalid?'text-error':''}>{preview.invalid}<small>บรรทัด</small></strong></div><div><span>มีข้อสังเกต</span><strong>{preview.warnings}<small>บรรทัด</small></strong></div></div>{preview.rows.length>100&&<p className="notice">ตารางแสดง 100 บรรทัดแรกจากทั้งหมด {preview.rows.length} บรรทัด ผลสรุปและการตรวจครอบคลุมทั้งไฟล์</p>}<div className="table-scroll"><table><thead><tr><th>รอบโอน</th><th>คำสั่งซื้อ / บรรทัด</th><th className="numeric">ยอดจัดสรร</th><th>ผลตรวจ</th></tr></thead><tbody>{preview.rows.slice(0,100).map(row=><tr key={row.record}><td><code>{row.payoutReference||'—'}</code><small>{row.settledOn||'—'} · รวม {row.payoutTotalMinor===null?'—':money(row.payoutTotalMinor)}</small></td><td><code>{row.orderId||'—'}</code><small>{row.sourceLineId||'—'}</small></td><td className="numeric">{row.amountMinor===null?'—':money(row.amountMinor)}</td><td>{row.errors.length?<span className="import-row-issues"><span className="pill red">ต้องแก้</span><small>{row.errors.join(' · ')}</small></span>:row.warnings.length?<span className="import-row-issues"><span className="pill amber">ตรวจเพิ่ม</span><small>{row.warnings.join(' · ')}</small></span>:<span className="pill green">พร้อมนำเข้า</span>}</td></tr>)}</tbody></table></div><p className="mapping-note">ระบบจะเก็บไฟล์ต้นฉบับ checksum เวอร์ชันตัวอ่าน และผลตรวจไว้กับชุดนำเข้า การยืนยันจะบันทึกทั้งไฟล์หรือไม่บันทึกเลย</p>{saved&&<p className="notice success" role="status">{saved}</p>}{!saved&&<label className="checkbox-label settlement-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>ฉันตรวจแล้วว่ารหัสรอบโอน ยอดรวม และยอดจัดสรรมาจาก statement นี้</label>}<div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={marketplaceSource?reset:()=>{setStep(2);setSaved('');setConfirmed(false);}}><ArrowLeft size={16}/>{marketplaceSource?'เลือกไฟล์ใหม่':'แก้การจับคู่'}</button>{saved?<button type="button" className="button primary" onClick={reset}>นำเข้าไฟล์ถัดไป</button>:<button type="button" className="button primary" disabled={busy||!confirmed||preview.invalid>0} onClick={commit}>{busy?'กำลังนำเข้า…':'ยืนยันนำเข้า statement'}</button>}</div></div>}
      </div>:<p className="notice settlement-import-readonly">สิทธิ์ผู้ตรวจสอบดาวน์โหลดหลักฐานเดิมได้ การนำเข้าไฟล์ต้องใช้สิทธิ์เจ้าของหรือการเงิน</p>}
    </details>
    {!!batches.length&&<div className="settlement-import-history"><div><strong>ไฟล์ที่นำเข้าล่าสุด</strong><small>เก็บต้นฉบับและ checksum · ล่าสุด 30 ไฟล์</small></div><div className="settlement-import-files">{batches.map(batch=><article key={batch.id}><span className="settlement-import-file-icon"><FileText size={17}/></span><span><strong>{batch.filename}</strong><small>{adapterName(batch.adapterKey)} · {batch.total} บรรทัด · {batch.payoutCount} รอบ · {formatBytes(batch.byteSize)}</small><code>{shortHash(batch.sourceHash)}</code></span><a className="icon-button" aria-label={`ดาวน์โหลดไฟล์ต้นฉบับ ${batch.filename}`} href={`${endpoint}/${batch.id}/source`} download><Download size={17}/></a></article>)}</div></div>}
  </section>;
}
