import { createHash,randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { AppError,uuid,type Context } from '@commerce/contracts';
import { withTenant,type Tx } from '@commerce/db';
import { assertShop,audit } from '@commerce/domain';
import { marketplaceSettlementAdapters,parseMarketplaceSettlement,type MarketplaceDetectionMiss,type MarketplaceSettlementAdapterKey,type MarketplaceSettlementSource,type ParsedMarketplaceSettlement } from './settlement-adapters';

export * from './settlement-adapters';

export const settlementImportFields=['payoutReference','settledOn','payoutTotal','sourceLineId','orderId','amount'] as const;
export type SettlementImportField=typeof settlementImportFields[number];
export type SettlementImportMapping=Record<SettlementImportField,string>&{note:string};
const mappingSchema=z.object({
  payoutReference:z.string().min(1),settledOn:z.string().min(1),payoutTotal:z.string().min(1),sourceLineId:z.string().min(1),
  orderId:z.string().min(1),amount:z.string().min(1),note:z.string().default(''),
}).strict();
const fileSchema=z.object({shopId:uuid,filename:z.string().trim().min(1).max(150),csv:z.string().min(1).max(1_048_576),delimiter:z.enum([',',';','\t'])}).strict();
const marketplaceFileSchema=z.object({
  shopId:uuid,filename:z.string().trim().min(1).max(150),contentBase64:z.string().min(1).max(7_100_000),
  contentType:z.enum(['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),delimiter:z.enum([',',';','\t']).optional(),
  adapterKey:z.enum(marketplaceSettlementAdapters).optional(),
}).strict();
const marketplaceCommitSchema=marketplaceFileSchema.extend({adapterKey:z.enum(marketplaceSettlementAdapters),confirmedStatement:z.literal(true)});
const mappedSchema=fileSchema.extend({mapping:mappingSchema});
const commitSchema=mappedSchema.extend({confirmedStatement:z.literal(true)});
export type SettlementImportSource=z.infer<typeof fileSchema>;
export type SettlementImportInput=z.infer<typeof mappedSchema>;
export type SettlementImportPreviewRow={
  record:number;sourceLineId:string;payoutReference:string;orderId:string;settledOn:string;payoutTotalMinor:number|null;
  amountMinor:number|null;note:string;matched:boolean;errors:string[];warnings:string[];
};
export type SettlementImportPayoutPreview={payoutReference:string;settledOn:string;payoutTotalMinor:number;allocatedMinor:number;differenceMinor:number;lineCount:number;unmatchedLineCount:number};
export type SettlementImportPreview={
  rows:SettlementImportPreviewRow[];payouts:SettlementImportPayoutPreview[];total:number;valid:number;invalid:number;warnings:number;
  payoutCount:number;balancedPayoutCount:number;unmatchedLineCount:number;sourceHash:string;mapping:SettlementImportMapping;filename:string;
  adapterKey?:MarketplaceSettlementAdapterKey;adapterLabel?:string;schemaVersion?:string;sourceSheet?:string;notices?:string[];
};
export type SettlementImportBatch={id:string;filename:string;byteSize:number;sourceHash:string;adapterKey:string;schemaVersion:string;total:number;payoutCount:number;unmatchedLineCount:number;committedAt:string};
export type SettlementImportDownload={filename:string;contentType:string;byteSize:number;sourceHash:string;content:Buffer};
export type MarketplaceSettlementPreview=SettlementImportPreview&{adapterKey:MarketplaceSettlementAdapterKey;adapterLabel:string;schemaVersion:string;sourceSheet:string;notices:string[]};
export type MarketplaceSettlementInspection=MarketplaceDetectionMiss|{detected:true;preview:MarketplaceSettlementPreview};

const parserVersion='settlement-preview-v1',adapterKey='generic-settlement-lines',schemaVersion='generic-settlement-lines-v1';
const marketplaceParserVersion='marketplace-settlement-preview-v1';
function access(role:string,write=true){if(!(write?['owner','finance']:['owner','finance','auditor']).includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการไฟล์ statement เงินโอน');}
function reject(message:string):never{throw new AppError(400,'INVALID_SETTLEMENT_CSV',message);}
function readCsv(input:SettlementImportSource){
  if(Buffer.byteLength(input.csv,'utf8')>1_048_576)reject('ไฟล์ต้องมีขนาดไม่เกิน 1 MB');
  if(input.csv.includes('\0')||input.csv.includes('\uFFFD'))reject('กรุณาบันทึกไฟล์เป็น CSV UTF-8');
  let records:string[][];
  try{records=parse(input.csv,{bom:true,delimiter:input.delimiter,skip_empty_lines:true,cast:false,max_record_size:16384,trim:true});}
  catch{reject('อ่าน CSV ไม่ได้ ตรวจตัวคั่น จำนวนคอลัมน์ และเครื่องหมายคำพูดในไฟล์');}
  if(records.length<2)reject('ไฟล์ต้องมีหัวคอลัมน์และข้อมูลอย่างน้อยหนึ่งรายการ');
  if(records.length>1001)reject('รองรับสูงสุด 1,000 รายการต่อไฟล์ กรุณาแบ่งไฟล์');
  const headers=records[0].map(value=>value.trim());
  if(headers.length>40||headers.some(value=>!value||value.length>100))reject('หัวคอลัมน์ต้องไม่ว่าง ยาวไม่เกิน 100 ตัวอักษร และไม่เกิน 40 คอลัมน์');
  if(new Set(headers.map(value=>value.normalize('NFKC').toLowerCase())).size!==headers.length)reject('ชื่อหัวคอลัมน์ซ้ำกัน กรุณาแก้ชื่อก่อนนำเข้า');
  return {headers,records:records.slice(1)};
}
function amount(value:string){
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction='']=value.replaceAll(',','').split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(minor)&&minor>=1&&minor<=1_000_000_000?minor:null;
}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function dateValue(value:string|Date){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}

async function analyze(tx:Tx,ctx:Context,input:SettlementImportInput):Promise<SettlementImportPreview>{
  await assertShop(tx,ctx,input.shopId);
  const {headers,records}=readCsv(input),selected=[...settlementImportFields.map(field=>input.mapping[field]),...(input.mapping.note?[input.mapping.note]:[])];
  if(new Set(selected).size!==selected.length||settlementImportFields.some(field=>!headers.includes(input.mapping[field]))||(input.mapping.note&&!headers.includes(input.mapping.note)))reject('เลือกคอลัมน์ให้ครบ โดยแต่ละข้อมูลใช้คนละคอลัมน์');
  const positions=Object.fromEntries(settlementImportFields.map(field=>[field,headers.indexOf(input.mapping[field])])) as Record<SettlementImportField,number>;
  const notePosition=input.mapping.note?headers.indexOf(input.mapping.note):-1;
  type SourceRow=Record<SettlementImportField,string>&{note:string};
  const source=records.map(values=>({...Object.fromEntries(settlementImportFields.map(field=>[field,values[positions[field]].trim()])),note:notePosition>=0?values[notePosition].trim():''}) as SourceRow);
  const sourceIds=[...new Set(source.map(row=>row.sourceLineId).filter(Boolean))],orderIds=[...new Set(source.map(row=>row.orderId).filter(Boolean))],payoutReferences=[...new Set(source.map(row=>row.payoutReference).filter(Boolean))];
  const committed=sourceIds.length?await tx.query<{sourceLineId:string}>('SELECT source_line_id AS "sourceLineId" FROM app.settlement_lines WHERE shop_id=$1 AND source_line_id=ANY($2::text[])',[input.shopId,sourceIds]):[];
  const knownOrders=orderIds.length?await tx.query<{orderId:string}>('SELECT DISTINCT order_id AS "orderId" FROM app.sales_lines WHERE shop_id=$1 AND order_id=ANY($2::text[])',[input.shopId,orderIds]):[];
  const existingPayouts=payoutReferences.length?await tx.query<{payoutReference:string;settledOn:string|Date;payoutTotalMinor:number}>(`SELECT payout_reference AS "payoutReference",max(settled_on) AS "settledOn",max(payout_total_minor)::int AS "payoutTotalMinor"
    FROM app.settlement_lines WHERE shop_id=$1 AND payout_reference=ANY($2::text[]) AND reverses_line_id IS NULL GROUP BY payout_reference`,[input.shopId,payoutReferences]):[];
  const committedIds=new Set(committed.map(row=>row.sourceLineId)),known=new Set(knownOrders.map(row=>row.orderId));
  const existingByPayout=new Map(existingPayouts.map(row=>[row.payoutReference,{settledOn:dateValue(row.settledOn),payoutTotalMinor:row.payoutTotalMinor}]));
  const seenSourceIds=new Set<string>();
  const rows=source.map((row,index):SettlementImportPreviewRow=>{
    const errors:string[]=[],warnings:string[]=[],payoutTotalMinor=amount(row.payoutTotal),amountMinor=amount(row.amount),matched=known.has(row.orderId);
    if(!row.sourceLineId||row.sourceLineId.length>150)errors.push('รหัสบรรทัดต้นทางว่างหรือยาวเกิน 150 ตัวอักษร');
    else if(seenSourceIds.has(row.sourceLineId))errors.push('รหัสบรรทัดต้นทางซ้ำในไฟล์นี้');
    else if(committedIds.has(row.sourceLineId))errors.push('บรรทัดต้นทางนี้ถูกนำเข้าในร้านนี้แล้ว');
    seenSourceIds.add(row.sourceLineId);
    if(!row.payoutReference||row.payoutReference.length>150)errors.push('รหัสรอบโอนว่างหรือยาวเกิน 150 ตัวอักษร');
    if(!row.orderId||row.orderId.length>100)errors.push('เลขคำสั่งซื้อว่างหรือยาวเกิน 100 ตัวอักษร');
    if(!validDate(row.settledOn))errors.push('วันที่โอนต้องเป็น YYYY-MM-DD และเป็นวันที่จริง');
    if(payoutTotalMinor===null)errors.push('ยอดโอนรวมต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    if(amountMinor===null)errors.push('ยอดจัดสรรต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    if(row.note&&row.note.length<3)errors.push('หมายเหตุต้องยาวอย่างน้อย 3 ตัวอักษร หรือเว้นว่างเพื่อใช้อ้างอิงไฟล์อัตโนมัติ');
    if(row.note.length>500)errors.push('หมายเหตุต้องยาวไม่เกิน 500 ตัวอักษร');
    if(!matched)warnings.push('ยังไม่พบคำสั่งซื้อนี้ในร้าน');
    return {record:index+1,sourceLineId:row.sourceLineId.slice(0,150),payoutReference:row.payoutReference.slice(0,150),orderId:row.orderId.slice(0,100),settledOn:row.settledOn.slice(0,30),payoutTotalMinor,amountMinor,note:row.note||`นำเข้าจาก ${input.filename} แถว ${index+1}`,matched,errors,warnings};
  });
  const grouped=new Map<string,{settledOn:string;payoutTotalMinor:number;allocatedMinor:number;records:number[];unmatchedLineCount:number}>();
  for(const row of rows){
    if(!row.payoutReference||!validDate(row.settledOn)||row.payoutTotalMinor===null||row.amountMinor===null)continue;
    const group=grouped.get(row.payoutReference);
    if(group){
      if(group.settledOn!==row.settledOn||group.payoutTotalMinor!==row.payoutTotalMinor)row.errors.push('วันที่หรือยอดรวมของรอบโอนเดียวกันไม่ตรงกัน');
      group.allocatedMinor+=row.amountMinor;group.records.push(row.record);if(!row.matched)group.unmatchedLineCount++;
    }else grouped.set(row.payoutReference,{settledOn:row.settledOn,payoutTotalMinor:row.payoutTotalMinor,allocatedMinor:row.amountMinor,records:[row.record],unmatchedLineCount:row.matched?0:1});
    const existing=existingByPayout.get(row.payoutReference);
    if(existing&&(existing.settledOn!==row.settledOn||existing.payoutTotalMinor!==row.payoutTotalMinor))row.errors.push('รอบโอนนี้มีวันที่หรือยอดรวมต่างจากข้อมูลที่บันทึกไว้');
  }
  const payouts=[...grouped].map(([payoutReference,group])=>({payoutReference,...group,differenceMinor:group.allocatedMinor-group.payoutTotalMinor,lineCount:group.records.length}));
  for(const payout of payouts)if(payout.differenceMinor!==0){const first=rows[payout.records[0]-1];first?.warnings.push('ยอดจัดสรรในไฟล์ยังไม่เท่ายอดโอนรวม');}
  return {rows,payouts:payouts.map(({records:_,...payout})=>payout),total:rows.length,valid:rows.filter(row=>!row.errors.length).length,invalid:rows.filter(row=>row.errors.length).length,warnings:rows.filter(row=>row.warnings.length).length,payoutCount:payouts.length,balancedPayoutCount:payouts.filter(row=>row.differenceMinor===0&&!row.unmatchedLineCount).length,unmatchedLineCount:rows.filter(row=>!row.matched).length,sourceHash:createHash('sha256').update(input.csv).digest('hex'),mapping:input.mapping,filename:input.filename};
}

const canonicalMarketplaceMapping:SettlementImportMapping={
  payoutReference:'payout_reference',settledOn:'settled_on',payoutTotal:'payout_total',sourceLineId:'source_line_id',orderId:'order_id',amount:'allocation_amount',note:'note',
};
function csvCell(value:string){return /[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;}
function canonicalCsv(parsed:ParsedMarketplaceSettlement){
  const headers=['payout_reference','settled_on','payout_total','source_line_id','order_id','allocation_amount','note'];
  return `${headers.join(',')}\n${parsed.rows.map(row=>[row.payoutReference,row.settledOn,row.payoutTotal,row.sourceLineId,row.orderId,row.amount,row.note].map(csvCell).join(',')).join('\n')}\n`;
}
async function previewMarketplaceParsed(tx:Tx,ctx:Context,input:MarketplaceSettlementSource,parsed:ParsedMarketplaceSettlement){
  const preview=await analyze(tx,ctx,{shopId:input.shopId,filename:input.filename,csv:canonicalCsv(parsed),delimiter:',',mapping:canonicalMarketplaceMapping});
  for(const [index,row] of preview.rows.entries()){
    row.errors.unshift(...parsed.rows[index].errors);row.warnings.unshift(...parsed.rows[index].warnings);
  }
  preview.valid=preview.rows.filter(row=>!row.errors.length).length;
  preview.invalid=preview.rows.filter(row=>row.errors.length).length;
  preview.warnings=preview.rows.filter(row=>row.warnings.length).length;
  const marketplacePreview=Object.assign(preview,{sourceHash:parsed.sourceHash,adapterKey:parsed.adapterKey,adapterLabel:parsed.adapterLabel,schemaVersion:parsed.schemaVersion,sourceSheet:parsed.sheetName,notices:parsed.notices});
  return {detected:true as const,preview:marketplacePreview,parsed};
}
async function analyzeMarketplace(tx:Tx,ctx:Context,input:MarketplaceSettlementSource){
  const parsed=await parseMarketplaceSettlement(input);
  return 'adapterKey' in parsed?previewMarketplaceParsed(tx,ctx,input,parsed):parsed;
}

export async function inspectSettlementFile(ctx:Context,input:unknown){
  const data=fileSchema.parse(input);
  return withTenant(ctx,async(tx,role)=>{access(role);await assertShop(tx,ctx,data.shopId);const csv=readCsv(data);return {headers:csv.headers,sample:csv.records.slice(0,3),total:csv.records.length};});
}
export async function previewSettlementImport(ctx:Context,input:unknown){
  const data=mappedSchema.parse(input);
  return withTenant(ctx,async(tx,role)=>{access(role);return analyze(tx,ctx,data);});
}

export async function inspectMarketplaceSettlement(ctx:Context,input:unknown):Promise<MarketplaceSettlementInspection>{
  const data=marketplaceFileSchema.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,data.shopId);
    const result=await analyzeMarketplace(tx,ctx,data);
    return result.detected?{detected:true,preview:result.preview}:result;
  });
}

export async function commitMarketplaceSettlement(ctx:Context,input:unknown){
  const data=marketplaceCommitSchema.parse(input);
  try{return await withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,data.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${data.shopId}:settlement-write`]);
    const parsed=await parseMarketplaceSettlement(data);
    if(!('adapterKey' in parsed))throw new AppError(409,'MARKETPLACE_ADAPTER_NOT_FOUND','หัวคอลัมน์ไม่ตรงกับตัวอ่านของแพลตฟอร์มที่เลือก');
    const fingerprint=createHash('sha256').update(JSON.stringify([parsed.sourceHash,parsed.adapterKey,parsed.schemaVersion,parsed.sheetName,marketplaceParserVersion])).digest('hex');
    const [prior]=await tx.query<{id:string;lines:number;payouts:number;unmatchedLines:number}>(`SELECT id,(preview->>'total')::int AS lines,(preview->>'payoutCount')::int AS payouts,(preview->>'unmatchedLineCount')::int AS "unmatchedLines"
      FROM app.settlement_import_batches WHERE shop_id=$1 AND fingerprint=$2`,[data.shopId,fingerprint]);
    if(prior)return {...prior,duplicate:true};
    const {preview}=await previewMarketplaceParsed(tx,ctx,data,parsed);
    if(preview.invalid||preview.valid!==preview.total)throw new AppError(409,'SETTLEMENT_IMPORT_HAS_ERRORS','แก้รายการที่ไม่ผ่านการตรวจก่อนยืนยันนำเข้า');
    const batchId=randomUUID();
    const inserted=await tx.query<{id:string}>(`INSERT INTO app.settlement_import_batches(tenant_id,id,shop_id,actor_id,filename,content_type,byte_size,source_hash,fingerprint,delimiter,adapter_key,schema_version,parser_version,mapping,preview,content)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(tenant_id,shop_id,fingerprint) DO NOTHING RETURNING id`,[ctx.tenantId,batchId,data.shopId,ctx.userId,data.filename,parsed.contentType,parsed.sourceBytes.byteLength,parsed.sourceHash,fingerprint,parsed.delimiter,parsed.adapterKey,parsed.schemaVersion,marketplaceParserVersion,JSON.stringify({sheetName:parsed.sheetName,canonical:canonicalMarketplaceMapping}),JSON.stringify(preview),parsed.sourceBytes]);
    if(!inserted.length){
      const [existing]=await tx.query<{id:string}>('SELECT id FROM app.settlement_import_batches WHERE shop_id=$1 AND fingerprint=$2',[data.shopId,fingerprint]);
      if(!existing)throw new AppError(409,'SETTLEMENT_IMPORT_CONFLICT','ไม่สามารถยืนยันไฟล์นี้ได้ กรุณาลองใหม่');
      return {id:existing.id,duplicate:true,lines:preview.total,payouts:preview.payoutCount,unmatchedLines:preview.unmatchedLineCount};
    }
    const lines=preview.rows.map(row=>({id:randomUUID(),record:row.record,sourceLineId:row.sourceLineId,payoutReference:row.payoutReference,orderId:row.orderId,settledOn:row.settledOn,payoutTotalMinor:row.payoutTotalMinor,amountMinor:row.amountMinor,note:row.note}));
    await tx.query(`INSERT INTO app.settlement_lines(tenant_id,id,shop_id,source_line_id,payout_reference,order_id,settled_on,payout_total_minor,amount_minor,source_scope,note,actor_id,import_batch_id,source_record)
      SELECT $1,x.id,$2,x.source_line_id,x.payout_reference,x.order_id,x.settled_on,x.payout_total_minor,x.amount_minor,'settlement_statement',x.note,$3,$4,x.record
      FROM jsonb_to_recordset($5::jsonb) AS x(id uuid,record integer,source_line_id text,payout_reference text,order_id text,settled_on date,payout_total_minor integer,amount_minor integer,note text)`,[ctx.tenantId,data.shopId,ctx.userId,batchId,JSON.stringify(lines.map(row=>({id:row.id,record:row.record,source_line_id:row.sourceLineId,payout_reference:row.payoutReference,order_id:row.orderId,settled_on:row.settledOn,payout_total_minor:row.payoutTotalMinor,amount_minor:row.amountMinor,note:row.note})))]);
    await audit(tx,ctx,'settlement.marketplace_import.committed',batchId,{shopId:data.shopId,filename:data.filename,sourceHash:parsed.sourceHash,lines:preview.total,payouts:preview.payoutCount,unmatchedLines:preview.unmatchedLineCount,adapterKey:parsed.adapterKey,schemaVersion:parsed.schemaVersion,sourceSheet:parsed.sheetName});
    return {id:batchId,duplicate:false,lines:preview.total,payouts:preview.payoutCount,unmatchedLines:preview.unmatchedLineCount};
  });}catch(error){
    const databaseError=error as {code?:string;constraint?:string}|null;
    if(databaseError?.code==='23505'&&databaseError.constraint?.includes('source_line_id'))throw new AppError(409,'SETTLEMENT_SOURCE_CONFLICT','มีรหัสบรรทัดต้นทางถูกนำเข้าแล้ว กรุณาตรวจไฟล์ใหม่');
    throw error;
  }
}

export async function commitSettlementImport(ctx:Context,input:unknown){
  const data=commitSchema.parse(input);
  try{return await withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,data.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${data.shopId}:settlement-write`]);
    const sourceHash=createHash('sha256').update(data.csv).digest('hex');
    const fingerprint=createHash('sha256').update(JSON.stringify([sourceHash,data.delimiter,...settlementImportFields.map(field=>data.mapping[field]),data.mapping.note,parserVersion])).digest('hex');
    const [prior]=await tx.query<{id:string;lines:number;payouts:number;unmatchedLines:number}>(`SELECT id,(preview->>'total')::int AS lines,(preview->>'payoutCount')::int AS payouts,(preview->>'unmatchedLineCount')::int AS "unmatchedLines"
      FROM app.settlement_import_batches WHERE shop_id=$1 AND fingerprint=$2`,[data.shopId,fingerprint]);
    if(prior)return {...prior,duplicate:true};
    const preview=await analyze(tx,ctx,data);
    if(preview.invalid||preview.valid!==preview.total)throw new AppError(409,'SETTLEMENT_IMPORT_HAS_ERRORS','แก้รายการที่ไม่ผ่านการตรวจก่อนยืนยันนำเข้า');
    const batchId=randomUUID(),bytes=Buffer.from(data.csv,'utf8');
    const inserted=await tx.query<{id:string}>(`INSERT INTO app.settlement_import_batches(tenant_id,id,shop_id,actor_id,filename,byte_size,source_hash,fingerprint,delimiter,adapter_key,schema_version,parser_version,mapping,preview,content)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(tenant_id,shop_id,fingerprint) DO NOTHING RETURNING id`,[ctx.tenantId,batchId,data.shopId,ctx.userId,data.filename,bytes.byteLength,preview.sourceHash,fingerprint,data.delimiter,adapterKey,schemaVersion,parserVersion,JSON.stringify(data.mapping),JSON.stringify(preview),bytes]);
    if(!inserted.length){
      const [existing]=await tx.query<{id:string}>('SELECT id FROM app.settlement_import_batches WHERE shop_id=$1 AND fingerprint=$2',[data.shopId,fingerprint]);
      if(!existing)throw new AppError(409,'SETTLEMENT_IMPORT_CONFLICT','ไม่สามารถยืนยันไฟล์นี้ได้ กรุณาลองใหม่');
      return {id:existing.id,duplicate:true,lines:preview.total,payouts:preview.payoutCount,unmatchedLines:preview.unmatchedLineCount};
    }
    const lines=preview.rows.map(row=>({id:randomUUID(),record:row.record,sourceLineId:row.sourceLineId,payoutReference:row.payoutReference,orderId:row.orderId,settledOn:row.settledOn,payoutTotalMinor:row.payoutTotalMinor,amountMinor:row.amountMinor,note:row.note}));
    await tx.query(`INSERT INTO app.settlement_lines(tenant_id,id,shop_id,source_line_id,payout_reference,order_id,settled_on,payout_total_minor,amount_minor,source_scope,note,actor_id,import_batch_id,source_record)
      SELECT $1,x.id,$2,x.source_line_id,x.payout_reference,x.order_id,x.settled_on,x.payout_total_minor,x.amount_minor,'settlement_statement',x.note,$3,$4,x.record
      FROM jsonb_to_recordset($5::jsonb) AS x(id uuid,record integer,source_line_id text,payout_reference text,order_id text,settled_on date,payout_total_minor integer,amount_minor integer,note text)`,[ctx.tenantId,data.shopId,ctx.userId,batchId,JSON.stringify(lines.map(row=>({id:row.id,record:row.record,source_line_id:row.sourceLineId,payout_reference:row.payoutReference,order_id:row.orderId,settled_on:row.settledOn,payout_total_minor:row.payoutTotalMinor,amount_minor:row.amountMinor,note:row.note})))]);
    await audit(tx,ctx,'settlement.import.committed',batchId,{shopId:data.shopId,filename:data.filename,sourceHash:preview.sourceHash,lines:preview.total,payouts:preview.payoutCount,unmatchedLines:preview.unmatchedLineCount,adapterKey,schemaVersion});
    return {id:batchId,duplicate:false,lines:preview.total,payouts:preview.payoutCount,unmatchedLines:preview.unmatchedLineCount};
  });}catch(error){
    const databaseError=error as {code?:string;constraint?:string}|null;
    if(databaseError?.code==='23505'&&databaseError.constraint?.includes('source_line_id'))throw new AppError(409,'SETTLEMENT_SOURCE_CONFLICT','มีรหัสบรรทัดต้นทางถูกนำเข้าแล้ว กรุณาตรวจไฟล์ใหม่');
    throw error;
  }
}

export async function settlementImportBatches(ctx:Context,shopId:string):Promise<SettlementImportBatch[]>{
  return withTenant(ctx,async(tx,role)=>{
    access(role,false);await assertShop(tx,ctx,shopId);
    const rows=await tx.query<Omit<SettlementImportBatch,'committedAt'>&{committedAt:Date}>(`SELECT id,filename,byte_size AS "byteSize",source_hash AS "sourceHash",adapter_key AS "adapterKey",schema_version AS "schemaVersion",
      (preview->>'total')::int AS total,(preview->>'payoutCount')::int AS "payoutCount",(preview->>'unmatchedLineCount')::int AS "unmatchedLineCount",committed_at AS "committedAt"
      FROM app.settlement_import_batches WHERE shop_id=$1 ORDER BY committed_at DESC LIMIT 30`,[shopId]);
    return rows.map(row=>({...row,committedAt:row.committedAt.toISOString()}));
  });
}

export async function getSettlementImportSource(ctx:Context,batchId:string):Promise<SettlementImportDownload>{
  const id=uuid.parse(batchId);
  return withTenant(ctx,async(tx,role)=>{
    access(role,false);
    const [source]=await tx.query<SettlementImportDownload&{shopId:string}>(`SELECT shop_id AS "shopId",filename,content_type AS "contentType",byte_size AS "byteSize",source_hash AS "sourceHash",content
      FROM app.settlement_import_batches WHERE id=$1`,[id]);
    if(!source)throw new AppError(404,'SETTLEMENT_SOURCE_NOT_FOUND','ไม่พบไฟล์ statement ต้นฉบับในร้านนี้');
    await audit(tx,ctx,'settlement.import.source.downloaded',id,{shopId:source.shopId,sourceHash:source.sourceHash,byteSize:source.byteSize});
    return {filename:source.filename,contentType:source.contentType,byteSize:source.byteSize,sourceHash:source.sourceHash,content:source.content};
  });
}
