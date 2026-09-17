import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import { AppError } from '@commerce/contracts';

export const marketplaceSettlementAdapters=['tiktok-shop-th','shopee-th','lazada-th'] as const;
export type MarketplaceSettlementAdapterKey=typeof marketplaceSettlementAdapters[number];
export type MarketplaceSettlementSource={
  shopId:string;filename:string;contentBase64:string;contentType:'text/csv'|'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  delimiter?:','|';'|'\t';adapterKey?:MarketplaceSettlementAdapterKey;
};
export type MarketplaceSettlementRow={
  payoutReference:string;settledOn:string;payoutTotal:string;sourceLineId:string;orderId:string;amount:string;note:string;
  errors:string[];warnings:string[];
};
export type ParsedMarketplaceSettlement={
  adapterKey:MarketplaceSettlementAdapterKey;adapterLabel:string;schemaVersion:string;confidence:'exact'|'compatible';sheetName:string;
  rows:MarketplaceSettlementRow[];sourceHash:string;sourceBytes:Buffer;contentType:MarketplaceSettlementSource['contentType'];delimiter:','|';'|'\t'|null;
  notices:string[];
};
export type MarketplaceDetectionMiss={detected:false;headers:string[];sample:string[][];total:number;sheetName:string|null;notices:string[]};

type Cell=string|number|boolean|Date|null;
type Table={sheetName:string;rows:Cell[][]};
type CanonicalColumn='payoutReference'|'settledOn'|'payoutTotal'|'sourceLineId'|'orderId'|'amount'|'note';
type AdapterDefinition={
  key:MarketplaceSettlementAdapterKey;label:string;schemaVersion:string;filenameHints:string[];signatures:string[][];
  columns:Record<CanonicalColumn,string[]>;
};

const maxCsvBytes=1_048_576,maxXlsxBytes=5_242_880,maxRows=1000,maxColumns=80,maxSheets=12,maxCells=60_000;
const definitions:AdapterDefinition[]=[
  {
    key:'tiktok-shop-th',label:'TikTok Shop',schemaVersion:'tiktok-shop-th-statement-v1',filenameHints:['tiktok','settled','statement'],
    signatures:[['order/adjustment id','settlement amount'],['order id','total settlement amount'],['statement id','settlement amount']],
    columns:{
      payoutReference:['statement id','statement_id','payout id','payout_id','payment id','รหัส statement','รหัสรอบชำระเงิน'],
      settledOn:['settlement date','settled date','statement date','settlement time','วันที่ชำระเงิน','วันที่ settlement'],
      payoutTotal:['total settlement amount','statement amount','payout amount','payable amount','ยอดการชำระเงินทั้งหมด','ยอดรวม statement'],
      sourceLineId:['transaction id','transaction_id','settlement transaction id','order/adjustment id','รหัสธุรกรรม'],
      orderId:['order/adjustment id','order id','order_id','related order id','หมายเลขคำสั่งซื้อ'],
      amount:['settlement amount','settled amount','transaction amount','net settlement amount','ยอดการชำระเงิน'],
      note:['type','transaction type','settlement type','description','ประเภทธุรกรรม'],
    },
  },
  {
    key:'shopee-th',label:'Shopee',schemaVersion:'shopee-th-income-v1',filenameHints:['shopee','income.','seller balance','wallet_income'],
    signatures:[['order id','released amount'],['order id','total released amount'],['หมายเลขคำสั่งซื้อ','ยอดเงินที่ได้รับ']],
    columns:{
      payoutReference:['payout id','payout_id','release id','statement id','transaction group','รหัสการโอนเงิน'],
      settledOn:['release date','released date','payout date','transaction date','วันที่โอนเงิน','วันที่ได้รับเงิน'],
      payoutTotal:['total released amount','payout amount','total payout','statement amount','ยอดโอนรวม','ยอดเงินที่ได้รับทั้งหมด'],
      sourceLineId:['transaction id','transaction_id','income id','escrow release id','รหัสธุรกรรม'],
      orderId:['order id','order_id','ordersn','หมายเลขคำสั่งซื้อ','คำสั่งซื้อ'],
      amount:['released amount','order income','amount','net amount','ยอดเงินที่ได้รับ','รายรับจากคำสั่งซื้อ'],
      note:['description','type','transaction type','รายละเอียด','ประเภท'],
    },
  },
  {
    key:'lazada-th',label:'Lazada',schemaVersion:'lazada-th-account-statement-v1',filenameHints:['lazada','account statement','transaction statement'],
    signatures:[['statement number','order no.','payout amount'],['statement number','order number','paid amount'],['statement no.','order no.','amount']],
    columns:{
      payoutReference:['statement number','statement no.','statement_no','payout id','payment reference','หมายเลข statement'],
      settledOn:['paid date','payout date','statement date','transaction date','วันที่ชำระเงิน','วันที่โอนเงิน'],
      payoutTotal:['statement amount','payout amount total','total paid amount','total payout','ยอดรวม statement'],
      sourceLineId:['transaction id','transaction_id','transaction number','reference number','รหัสธุรกรรม'],
      orderId:['order no.','order number','order id','order_no','หมายเลขคำสั่งซื้อ'],
      amount:['payout amount','paid amount','seller amount','transaction amount','amount','ยอดชำระ'],
      note:['transaction type','fee name','description','ประเภทการทำรายการ','รายละเอียด'],
    },
  },
];

function fail(message:string):never{throw new AppError(400,'INVALID_MARKETPLACE_STATEMENT',message);}
function normalized(value:unknown){return String(value??'').normalize('NFKC').replace(/^\uFEFF/,'').trim().replace(/\s+/g,' ').toLowerCase();}
function cellText(value:Cell){
  if(value===null)return '';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  return String(value).trim();
}
function decodeBase64(value:string){
  if(!value||value.length>7_100_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('ข้อมูลไฟล์ไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่');
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,''))fail('ข้อมูลไฟล์ไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่');
  return bytes;
}
function validateZipEnvelope(bytes:Buffer){
  const start=Math.max(0,bytes.length-65_557);let eocd=-1;
  for(let offset=bytes.length-22;offset>=start;offset--)if(bytes.readUInt32LE(offset)===0x06054b50){eocd=offset;break;}
  if(eocd<0)fail('ไฟล์ XLSX ไม่สมบูรณ์หรือไม่ใช่ไฟล์ Excel ที่รองรับ');
  const entries=bytes.readUInt16LE(eocd+10),directorySize=bytes.readUInt32LE(eocd+12),directoryOffset=bytes.readUInt32LE(eocd+16);
  if(entries<1||entries>300||directoryOffset+directorySize>bytes.length)fail('โครงสร้างไฟล์ XLSX มีขนาดหรือจำนวนส่วนเกินขอบเขตที่รองรับ');
  let offset=directoryOffset,totalUncompressed=0;
  for(let entry=0;entry<entries;entry++){
    if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)fail('โครงสร้างไฟล์ XLSX ไม่สมบูรณ์');
    const flags=bytes.readUInt16LE(offset+8),uncompressed=bytes.readUInt32LE(offset+24),nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32);
    if(flags&1)fail('ไม่รองรับไฟล์ XLSX ที่เข้ารหัสหรือมีรหัสผ่าน');
    if(uncompressed===0xffffffff||uncompressed>12_000_000)fail('ไฟล์ XLSX มีข้อมูลภายในใหญ่เกินขอบเขตที่รองรับ');
    totalUncompressed+=uncompressed;if(totalUncompressed>30_000_000)fail('ไฟล์ XLSX ขยายข้อมูลภายในใหญ่เกินขอบเขตที่รองรับ');
    offset+=46+nameLength+extraLength+commentLength;
  }
}
function csvTable(bytes:Buffer,delimiter:','|';'|'\t'):Table{
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);let rows:string[][];
  try{rows=parse(text,{bom:true,delimiter,skip_empty_lines:true,cast:false,max_record_size:32768,trim:true});}
  catch{fail('อ่าน CSV ไม่ได้ ตรวจตัวคั่น จำนวนคอลัมน์ และเครื่องหมายคำพูดในไฟล์');}
  return {sheetName:'CSV',rows};
}
async function tables(source:MarketplaceSettlementSource,bytes:Buffer):Promise<Table[]>{
  if(source.contentType==='text/csv')return [csvTable(bytes,source.delimiter??',')];
  validateZipEnvelope(bytes);
  try{
    const sheets=await readXlsxFile(bytes);
    if(!sheets.length||sheets.length>maxSheets)fail(`รองรับไฟล์ XLSX สูงสุด ${maxSheets} ชีต`);
    const cellCount=sheets.reduce((sum,sheet)=>sum+sheet.data.reduce((rowSum,row)=>rowSum+row.length,0),0);
    if(cellCount>maxCells)fail('ไฟล์ XLSX มีจำนวนช่องข้อมูลมากเกินขอบเขตที่รองรับ');
    return sheets.map(sheet=>({sheetName:sheet.sheet,rows:sheet.data as Cell[][]}));
  }catch(error){if(error instanceof AppError)throw error;fail('อ่าน XLSX ไม่ได้ กรุณาดาวน์โหลดไฟล์ใหม่จาก Seller Center โดยไม่ตั้งรหัสผ่าน');}
}
function tableShape(table:Table){
  if(table.rows.length<2)return false;
  if(table.rows.length>maxRows+25)return false;
  return table.rows.every(row=>row.length<=maxColumns);
}
function headerCandidates(table:Table){
  return table.rows.slice(0,20).map((row,index)=>({index,headers:row.map(normalized)})).filter(row=>row.headers.some(Boolean));
}
function signatureMatches(headers:string[],definition:AdapterDefinition){
  return Math.max(0,...definition.signatures.map(signature=>signature.every(alias=>headers.includes(normalized(alias)))?signature.length:0));
}
function findAdapter(allTables:Table[],filename:string,requested?:MarketplaceSettlementAdapterKey){
  const allowed=requested?definitions.filter(definition=>definition.key===requested):definitions;
  const candidates=allTables.flatMap(table=>headerCandidates(table).flatMap(header=>allowed.map(definition=>({table,header,definition,signature:signatureMatches(header.headers,definition),filenameHint:definition.filenameHints.some(hint=>normalized(`${filename} ${table.sheetName}`).includes(normalized(hint)))}))));
  return candidates.filter(candidate=>candidate.signature>0).sort((a,b)=>b.signature-a.signature||Number(b.filenameHint)-Number(a.filenameHint)||a.header.index-b.header.index)[0]??null;
}
function column(headers:string[],aliases:string[]){for(const alias of aliases){const index=headers.indexOf(normalized(alias));if(index>=0)return index;}return -1;}
function isoDate(value:string){
  const input=value.trim();let match:RegExpMatchArray|null;
  if((match=input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)))return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  if((match=input.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)))return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  return input;
}
function decimal(value:string){
  let input=value.normalize('NFKC').trim().replace(/(?:THB|฿)/gi,'').replaceAll(',','').replace(/\s+/g,'');
  if(/^\(.+\)$/.test(input))input=`-${input.slice(1,-1)}`;
  return input;
}
function signedMinor(value:string){
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(value))return null;
  const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(minor)?(negative?-minor:minor):null;
}
function minorText(value:number){const sign=value<0?'-':'',absolute=Math.abs(value);return `${sign}${Math.floor(absolute/100)}.${String(absolute%100).padStart(2,'0')}`;}
function derivedId(adapterKey:string,sheetName:string,row:Cell[]){return `${adapterKey}:${createHash('sha256').update(JSON.stringify([sheetName,row.map(cellText)])).digest('hex').slice(0,32)}`;}
function firstTableSummary(allTables:Table[]):MarketplaceDetectionMiss{
  const table=allTables.find(tableShape)??allTables[0];if(!table)return {detected:false,headers:[],sample:[],total:0,sheetName:null,notices:[]};
  const header=headerCandidates(table)[0];if(!header)return {detected:false,headers:[],sample:[],total:0,sheetName:table.sheetName,notices:[]};
  const headers=table.rows[header.index].map(cellText);
  return {detected:false,headers,sample:table.rows.slice(header.index+1,header.index+4).map(row=>row.map(cellText)),total:Math.max(0,table.rows.length-header.index-1),sheetName:table.sheetName,notices:['ยังไม่พบรูปแบบ TikTok Shop, Shopee หรือ Lazada ที่ตรงอย่างมั่นใจ']};
}

export async function parseMarketplaceSettlement(source:MarketplaceSettlementSource):Promise<ParsedMarketplaceSettlement|MarketplaceDetectionMiss>{
  const bytes=decodeBase64(source.contentBase64),limit=source.contentType==='text/csv'?maxCsvBytes:maxXlsxBytes;
  if(bytes.length>limit)fail(`ไฟล์ ${source.contentType==='text/csv'?'CSV':'XLSX'} ต้องมีขนาดไม่เกิน ${source.contentType==='text/csv'?'1':'5'} MB`);
  const allTables=await tables(source,bytes),match=findAdapter(allTables,source.filename,source.adapterKey);
  if(!match){if(source.adapterKey)fail('หัวคอลัมน์ไม่ตรงกับตัวอ่านของแพลตฟอร์มที่เลือก');return firstTableSummary(allTables);}
  const {definition,table,header}=match;if(!tableShape(table))fail(`ชีต ${table.sheetName} ต้องมีข้อมูล 1–${maxRows} แถว และไม่เกิน ${maxColumns} คอลัมน์`);
  const headers=header.headers,positions=Object.fromEntries((Object.keys(definition.columns) as CanonicalColumn[]).map(key=>[key,column(headers,definition.columns[key])])) as Record<CanonicalColumn,number>;
  if(positions.orderId<0||positions.settledOn<0||positions.amount<0)fail(`ไฟล์ ${definition.label} ไม่มีคอลัมน์คำสั่งซื้อ วันที่ชำระเงิน หรือยอดเงินที่จำเป็น`);
  const data=table.rows.slice(header.index+1).filter(row=>row.some(value=>cellText(value)!==''));
  if(!data.length||data.length>maxRows)fail(`รองรับข้อมูล 1–${maxRows} รายการต่อไฟล์`);
  const notices:string[]=['ตัวอ่านรุ่นนี้ผ่านชุดทดสอบข้อมูลสมมติและยังรอตรวจรับกับไฟล์จริงที่ปกปิดข้อมูล กรุณาตรวจยอดก่อนยืนยัน'];
  if(positions.payoutReference<0)notices.push('ไฟล์ไม่มีรหัสรอบโอน ระบบจึงจัดกลุ่มตามวันที่ชำระเงิน');
  if(positions.payoutTotal<0)notices.push('ไฟล์ไม่มียอดรวมต่อรอบ ระบบจึงรวมยอดจากรายการในไฟล์');
  if(positions.sourceLineId<0)notices.push('ไฟล์ไม่มีรหัสธุรกรรม ระบบจึงสร้างรหัสคงที่จากข้อมูลแต่ละบรรทัด');
  const rawRows=data.map(row=>{
    const read=(key:CanonicalColumn)=>positions[key]>=0?cellText(row[positions[key]]):'';
    const settledOn=isoDate(read('settledOn')),amount=decimal(read('amount'));
    return {raw:row,payoutReference:read('payoutReference')||`${definition.key.toUpperCase()}-${settledOn}`,settledOn,payoutTotal:decimal(read('payoutTotal')),sourceLineId:read('sourceLineId')||derivedId(definition.key,table.sheetName,row),orderId:read('orderId'),amount,note:read('note')||`${definition.label} · ${table.sheetName}`};
  });
  const totals=new Map<string,number>();
  for(const row of rawRows){const value=signedMinor(row.amount);if(value!==null)totals.set(row.payoutReference,(totals.get(row.payoutReference)??0)+value);}
  const rows=rawRows.map(({raw:_,...row}):MarketplaceSettlementRow=>{
    const errors:string[]=[],warnings:string[]=[];
    if(positions.payoutReference<0)warnings.push('รหัสรอบโอนสร้างจากแพลตฟอร์มและวันที่ชำระเงิน');
    if(positions.payoutTotal<0)warnings.push('ยอดโอนรวมคำนวณจากรายการทั้งหมดในรอบนี้');
    if(positions.sourceLineId<0)warnings.push('รหัสบรรทัดสร้างจาก checksum ของข้อมูลต้นทาง');
    const value=signedMinor(row.amount);if(value!==null&&value<=0)errors.push('รายการยอดติดลบหรือศูนย์ต้องแยกเป็นค่าธรรมเนียมหรือรายการปรับยอดก่อนนำเข้า');
    if(/adjustment|reserve|withdraw|refund|fee|commission|ค่าธรรมเนียม|คืนเงิน|สำรอง|ปรับยอด/i.test(row.note))errors.push('ประเภทรายการนี้ต้องเข้ากระบวนการค่าธรรมเนียม คืนเงิน หรือปรับยอด ไม่ใช่เงินรับคำสั่งซื้อ');
    return {...row,payoutTotal:row.payoutTotal||minorText(totals.get(row.payoutReference)??0),errors,warnings};
  });
  return {adapterKey:definition.key,adapterLabel:definition.label,schemaVersion:definition.schemaVersion,confidence:match.signature>=3?'exact':'compatible',sheetName:table.sheetName,rows,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes,contentType:source.contentType,delimiter:source.contentType==='text/csv'?(source.delimiter??','):null,notices};
}

export function marketplaceAdapterCatalog(){return definitions.map(({key,label,schemaVersion})=>({key,label,schemaVersion,status:'sample-validation-required' as const}));}
