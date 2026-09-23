import { createHash,createHmac } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import { z } from 'zod';
import {
  marketplaceSettlementHeaderRole,parseMarketplaceSettlement,type MarketplaceSettlementAdapterKey,
  type MarketplaceSettlementColumn,type MarketplaceSettlementSource,
} from './settlement-adapters';

export const settlementSampleIntakeVersion='settlement-sample-intake-v1' as const;
type Delimiter=','|';'|'\t';
type Cell=string|number|boolean|Date|null;
type IntakeTable={sheetName:string;rows:Cell[][]};
export type SettlementSampleFinding={code:'SENSITIVE_COLUMN_VALUE'|'EMAIL_VALUE'|'PHONE_VALUE'|'UNSAFE_IDENTIFIER';sheet:string;column:string;count:number};
export type SettlementSampleReview={
  version:typeof settlementSampleIntakeVersion;status:'ready_for_finance_review'|'blocked';adapter:null|{key:MarketplaceSettlementAdapterKey;label:string;schemaVersion:string;confidence:'exact'|'compatible';sheetName:string};
  redaction:{passed:boolean;findings:SettlementSampleFinding[]};
  semantics:{rows:number;payouts:number;reportedTotalRows:number;derivedTotalRows:number;positiveRows:number;nonPositiveRows:number;invalidRows:number;warningRows:number;allocatedTotalMinor:number;reportedPayoutTotalMinor:number}|null;
  lineage:{sanitizedSha256:string;contentType:MarketplaceSettlementSource['contentType']};blockers:string[];limitations:string[];
};
export type SanitizedSettlementCsv={csv:string;manifest:{
  version:typeof settlementSampleIntakeVersion;headerRow:number;rows:number;columns:number;delimiter:Delimiter;
  pseudonymization:'hmac-sha256-20';preserved:['settledOn','payoutTotal','amount'];unknownColumns:'redacted';notes:'classified';sanitizedSha256:string;
}};
export const settlementSampleAcceptance=z.object({
  version:z.literal(settlementSampleIntakeVersion),adapterKey:z.enum(['tiktok-shop-th','shopee-th','lazada-th']),schemaVersion:z.string().min(1).max(100),sanitizedSha256:z.string().regex(/^[a-f0-9]{64}$/),
  source:z.object({exportedAt:z.string().datetime(),sellerCenterTimezone:z.string().min(1).max(80),currency:z.literal('THB')}).strict(),
  expected:z.object({rowCount:z.number().int().min(1),payoutCount:z.number().int().min(1),allocatedTotalMinor:z.number().int(),reportedPayoutTotalMinor:z.number().int()}).strict(),
  review:z.object({reviewer:z.string().trim().min(1).max(120),reviewedAt:z.string().datetime(),headersCorrect:z.boolean(),datesCorrect:z.boolean(),signsCorrect:z.boolean(),identitySemanticsCorrect:z.boolean(),totalsCorrect:z.boolean(),notes:z.string().trim().min(3).max(2000)}).strict(),
  decision:z.enum(['accepted','rejected']),
}).strict().superRefine((value,ctx)=>{
  if(value.decision==='accepted'&&![value.review.headersCorrect,value.review.datesCorrect,value.review.signsCorrect,value.review.identitySemanticsCorrect,value.review.totalsCorrect].every(Boolean))ctx.addIssue({code:'custom',path:['decision'],message:'accepted ต้องผ่านการตรวจทุกหัวข้อ'});
});
export type SettlementSampleAcceptance=z.infer<typeof settlementSampleAcceptance>;

const redacted='[REDACTED]';
const emailPattern=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern=/(?:^|\D)(?:\+66|0)\d{8,9}(?:$|\D)/;
const anonPattern=/^ANON-(?:ORDER|LINE|PAYOUT)-[A-F0-9]{20}$/;
const generatedLinePattern=/^(?:tiktok-shop-th|shopee-th|lazada-th):[a-f0-9]{32}$/;
const generatedPayoutPattern=/^(?:TIKTOK-SHOP-TH|SHOPEE-TH|LAZADA-TH)-\d{4}-\d{2}-\d{2}$/;

function text(value:Cell){if(value===null)return '';if(value instanceof Date)return value.toISOString().slice(0,10);return String(value).trim();}
function csvRows(bytes:Buffer,delimiter:Delimiter){return parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),{bom:true,delimiter,skip_empty_lines:true,cast:false,max_record_size:32768,trim:true}) as string[][];}
async function intakeTables(source:MarketplaceSettlementSource):Promise<IntakeTable[]>{
  const bytes=Buffer.from(source.contentBase64,'base64');
  if(source.contentType==='text/csv')return [{sheetName:'CSV',rows:csvRows(bytes,source.delimiter??',')}];
  const sheets=await readXlsxFile(bytes);return sheets.map(sheet=>({sheetName:sheet.sheet,rows:sheet.data as Cell[][]}));
}
function headerIndex(rows:Cell[][],adapterKey?:MarketplaceSettlementAdapterKey){
  const ranked=rows.slice(0,20).map((row,index)=>({index,roles:row.map(value=>marketplaceSettlementHeaderRole(text(value),adapterKey)).filter(Boolean).length})).sort((a,b)=>b.roles-a.roles||a.index-b.index)[0];
  return ranked&&ranked.roles>=2?ranked.index:-1;
}
function identifierSafe(role:MarketplaceSettlementColumn,value:string){
  if(role==='orderId')return anonPattern.test(value);
  if(role==='sourceLineId')return anonPattern.test(value)||generatedLinePattern.test(value);
  if(role==='payoutReference')return anonPattern.test(value)||generatedPayoutPattern.test(value);
  return true;
}
function scanTables(tables:IntakeTable[],adapterKey?:MarketplaceSettlementAdapterKey){
  const findings:SettlementSampleFinding[]=[];
  for(const [tableIndex,table] of tables.entries()){
    const index=headerIndex(table.rows,adapterKey);if(index<0)continue;const headers=table.rows[index].map(text),data=table.rows.slice(index+1);
    const preamble=table.rows.slice(0,index).flatMap(row=>row.map(text)).filter(value=>value&&value!==redacted);
    if(preamble.length)findings.push({code:'SENSITIVE_COLUMN_VALUE',sheet:`sheet_${tableIndex+1}`,column:'preamble',count:preamble.length});
    for(const [column,header] of headers.entries()){
      const role=marketplaceSettlementHeaderRole(header,adapterKey),values=data.map(row=>text(row[column])).filter(Boolean),active=values.filter(value=>value!==redacted);
      const location={sheet:`sheet_${tableIndex+1}`,column:`column_${column+1}`};
      if(!role&&active.length)findings.push({code:'SENSITIVE_COLUMN_VALUE',...location,count:active.length});
      const emails=active.filter(value=>emailPattern.test(value)).length;if(emails)findings.push({code:'EMAIL_VALUE',...location,count:emails});
      const phones=active.filter(value=>phonePattern.test(value)).length;if(phones)findings.push({code:'PHONE_VALUE',...location,count:phones});
      if(role&&['orderId','sourceLineId','payoutReference'].includes(role)){
        const unsafe=active.filter(value=>!identifierSafe(role,value)).length;if(unsafe)findings.push({code:'UNSAFE_IDENTIFIER',...location,count:unsafe});
      }
    }
  }
  return findings;
}
function sha256(value:Buffer|string){return createHash('sha256').update(value).digest('hex');}
function payoutCount(rows:{payoutReference:string}[]){return new Set(rows.map(row=>row.payoutReference)).size;}
function minor(value:string){const normalized=value.replaceAll(',','').trim(),match=normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);if(!match)return 0;const amount=Number(match[2])*100+Number((match[3]??'').padEnd(2,'0'));return match[1]? -amount:amount;}

export async function reviewSanitizedSettlementSample(source:MarketplaceSettlementSource):Promise<SettlementSampleReview>{
  const bytes=Buffer.from(source.contentBase64,'base64'),tables=await intakeTables(source),findings=scanTables(tables,source.adapterKey),parsed=await parseMarketplaceSettlement(source);
  const blockers:string[]=[];if(findings.length)blockers.push('พบข้อมูลระบุตัวบุคคลหรือรหัสต้นทางที่ยังไม่ถูกแทนค่า');
  if(!('adapterKey' in parsed))blockers.push('ยังตรวจจับ adapter จากหัวคอลัมน์ไม่ได้');
  const reportedPayouts=new Map<string,number>();if('adapterKey' in parsed)for(const row of parsed.rows)if(row.payoutTotalBasis==='reported_total')reportedPayouts.set(row.payoutReference,minor(row.payoutTotal));
  const semantics='adapterKey' in parsed?{
    rows:parsed.rows.length,payouts:payoutCount(parsed.rows),reportedTotalRows:parsed.rows.filter(row=>row.payoutTotalBasis==='reported_total').length,
    derivedTotalRows:parsed.rows.filter(row=>row.payoutTotalBasis==='derived_from_lines').length,positiveRows:parsed.rows.filter(row=>Number(row.amount)>0).length,
    nonPositiveRows:parsed.rows.filter(row=>Number(row.amount)<=0).length,invalidRows:parsed.rows.filter(row=>row.errors.length>0).length,
    warningRows:parsed.rows.filter(row=>row.warnings.length>0).length,allocatedTotalMinor:parsed.rows.reduce((sum,row)=>sum+minor(row.amount),0),
    reportedPayoutTotalMinor:[...reportedPayouts.values()].reduce((sum,value)=>sum+value,0),
  }:null;
  if(semantics?.invalidRows)blockers.push('มีรายการที่ adapter ระบุว่าต้องแยกไป flow ค่าธรรมเนียม คืนเงิน หรือปรับยอด');
  return {
    version:settlementSampleIntakeVersion,status:blockers.length?'blocked':'ready_for_finance_review',
    adapter:'adapterKey' in parsed?{key:parsed.adapterKey,label:parsed.adapterLabel,schemaVersion:parsed.schemaVersion,confidence:parsed.confidence,sheetName:source.contentType==='text/csv'?'CSV':'WORKSHEET'}:null,
    redaction:{passed:findings.length===0,findings},semantics,lineage:{sanitizedSha256:sha256(bytes),contentType:source.contentType},blockers,
    limitations:['รายงานนี้ไม่ยืนยันความถูกต้องของยอดหรือความครบถ้วนของ export','ต้องให้ผู้ใช้การเงินเทียบยอด วันที่ เครื่องหมาย และชนิดรายการกับ Seller Center','XLSX ที่แปลงเป็น CSV ยังไม่ยืนยันพฤติกรรมเฉพาะ workbook หรือหลายชีต'],
  };
}

export function verifySettlementSampleAcceptance(review:SettlementSampleReview,input:unknown){
  const acceptance=settlementSampleAcceptance.parse(input),checks=[
    {id:'review_ready',passed:review.status==='ready_for_finance_review'},
    {id:'source_hash',passed:review.lineage.sanitizedSha256===acceptance.sanitizedSha256},
    {id:'adapter',passed:review.adapter?.key===acceptance.adapterKey&&review.adapter.schemaVersion===acceptance.schemaVersion},
    {id:'row_count',passed:review.semantics?.rows===acceptance.expected.rowCount},
    {id:'payout_count',passed:review.semantics?.payouts===acceptance.expected.payoutCount},
    {id:'allocated_total',passed:review.semantics?.allocatedTotalMinor===acceptance.expected.allocatedTotalMinor},
    {id:'reported_payout_total',passed:review.semantics?.reportedPayoutTotalMinor===acceptance.expected.reportedPayoutTotalMinor},
    {id:'finance_signoff',passed:acceptance.decision==='accepted'},
  ];
  return {version:settlementSampleIntakeVersion,passed:checks.every(check=>check.passed),checks,acceptance};
}

function pseudonym(key:string,role:'ORDER'|'LINE'|'PAYOUT',value:string){return `ANON-${role}-${createHmac('sha256',key).update(`${role}:${value.normalize('NFKC').trim()}`).digest('hex').slice(0,20).toUpperCase()}`;}
function safeAmount(value:string){return /^(?:THB|฿)?\s*(?:-?\d[\d,]*(?:\.\d{1,2})?|\(\d[\d,]*(?:\.\d{1,2})?\))\s*(?:THB|฿)?$/i.test(value)?value:redacted;}
function safeDate(value:string){return /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[ T].*)?$/.test(value)?value:redacted;}
function safeNote(value:string){
  const classes=[['REFUND',/refund|คืนเงิน/i],['FEE',/fee|commission|ค่าธรรมเนียม/i],['ADJUSTMENT',/adjustment|ปรับยอด/i],['RESERVE',/reserve|สำรอง/i],['WITHDRAWAL',/withdraw|ถอน/i]].filter(([,pattern])=>(pattern as RegExp).test(value)).map(([label])=>label);
  return `ANON-NOTE:${classes.length?classes.join('+'):'SALE'}`;
}
function csvCell(value:string,delimiter:Delimiter){return value.includes(delimiter)||/["\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;}

export function sanitizeMarketplaceSettlementCsv(input:{csv:string;delimiter?:Delimiter;redactionKey:string;adapterKey:MarketplaceSettlementAdapterKey}):SanitizedSettlementCsv{
  if(input.redactionKey.length<32)throw new Error('DATA_REDACTION_KEY ต้องยาวอย่างน้อย 32 ตัวอักษร');
  const delimiter=input.delimiter??',',rows=parse(input.csv,{bom:true,delimiter,skip_empty_lines:true,cast:false,max_record_size:32768,trim:true}) as string[][],index=headerIndex(rows,input.adapterKey);
  if(index<0)throw new Error('ไม่พบแถวหัวคอลัมน์ทางการเงินที่รองรับ');
  const headers=rows[index].map(value=>String(value).trim()),roles=headers.map(header=>marketplaceSettlementHeaderRole(header,input.adapterKey));
  const output=rows.map((row,rowIndex)=>row.map((raw,column)=>{
    const value=String(raw??'').trim();if(!value)return '';
    if(rowIndex===index)return /^[=+@]/.test(value)?'[REDACTED-HEADER]':value;
    if(rowIndex<index)return redacted;
    const role=roles[column];
    if(role==='orderId')return pseudonym(input.redactionKey,'ORDER',value);
    if(role==='sourceLineId')return pseudonym(input.redactionKey,'LINE',value);
    if(role==='payoutReference')return pseudonym(input.redactionKey,'PAYOUT',value);
    if(role==='settledOn')return safeDate(value);
    if(role==='payoutTotal'||role==='amount')return safeAmount(value);
    if(role==='note')return safeNote(value);
    return redacted;
  }));
  const csv=`${output.map(row=>row.map(value=>csvCell(value,delimiter)).join(delimiter)).join('\n')}\n`,columns=Math.max(...rows.map(row=>row.length));
  return {csv,manifest:{version:settlementSampleIntakeVersion,headerRow:index+1,rows:Math.max(0,rows.length-index-1),columns,delimiter,pseudonymization:'hmac-sha256-20',preserved:['settledOn','payoutTotal','amount'],unknownColumns:'redacted',notes:'classified',sanitizedSha256:sha256(csv)}};
}
