import { createHash,randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { AppError,uuid,type Context } from '@commerce/contracts';
import { withTenant,type Tx } from '@commerce/db';
import { assertShop,audit } from '@commerce/domain';

export const fields=['orderId','sku','quantity','date','netSales'] as const;
export type Field=typeof fields[number];
export type Mapping=Record<Field,string>&{sourceLineId?:string;platformFee?:string};
const mappingSchema=z.object({orderId:z.string().min(1),sourceLineId:z.string().default(''),sku:z.string().min(1),quantity:z.string().min(1),date:z.string().min(1),netSales:z.string().min(1),platformFee:z.string().default('')}).strict();
const fileInput=z.object({shopId:uuid,filename:z.string().trim().min(1).max(150),csv:z.string().min(1).max(1_048_576),delimiter:z.enum([',',';','\t'])}).strict();
const mappedInput=fileInput.extend({mapping:mappingSchema});
export type SourceFile=z.infer<typeof fileInput>;
export type ImportInput=z.infer<typeof mappedInput>;
export type PreviewRow={record:number;sourceLineId:string|null;orderId:string;sku:string;date:string;quantity:number|null;netSalesMinor:number|null;platformFeeMinor:number|null;errors:string[];warnings:string[]};
export type Preview={rows:PreviewRow[];total:number;valid:number;invalid:number;warnings:number;sourceHash:string;mapping:Mapping;filename:string};
export type ImportEvidence={filename:string;contentType:string;byteSize:number;sourceHash:string;adapterKey:string;schemaVersion:string;storageVersion:string;createdAt:string};
type StoredEvidence=Omit<ImportEvidence,'createdAt'>&{createdAt:Date};
const sourceAdapter='generic-order-lines',sourceSchemaVersion='generic-order-lines-v1',sourceStorageVersion='postgres-bytea-v1';
function evidenceDto(source:StoredEvidence):ImportEvidence{return {...source,createdAt:source.createdAt.toISOString()};}
function reject(message:string):never{throw new AppError(400,'INVALID_CSV',message);}
function readCsv(d:SourceFile){
  if(Buffer.byteLength(d.csv,'utf8')>1_048_576)reject('ไฟล์ต้องมีขนาดไม่เกิน 1 MB');
  if(d.csv.includes('\0')||d.csv.includes('\uFFFD'))reject('กรุณาบันทึกไฟล์เป็น CSV UTF-8');
  let records:string[][];
  try{records=parse(d.csv,{bom:true,delimiter:d.delimiter,skip_empty_lines:true,cast:false,max_record_size:16384,trim:true});}
  catch{reject('อ่าน CSV ไม่ได้ ตรวจตัวคั่น จำนวนคอลัมน์ และเครื่องหมายคำพูดในไฟล์');}
  if(records.length<2)reject('ไฟล์ต้องมีหัวคอลัมน์และข้อมูลอย่างน้อยหนึ่งรายการ');
  if(records.length>1001)reject('รองรับสูงสุด 1,000 รายการต่อไฟล์ กรุณาแบ่งไฟล์');
  const headers=records[0].map(h=>h.trim());
  if(headers.length>40||headers.some(h=>!h||h.length>100))reject('หัวคอลัมน์ต้องไม่ว่าง ยาวไม่เกิน 100 ตัวอักษร และไม่เกิน 40 คอลัมน์');
  if(new Set(headers.map(h=>h.normalize('NFKC').toLowerCase())).size!==headers.length)reject('ชื่อหัวคอลัมน์ซ้ำกัน กรุณาแก้ชื่อก่อนนำเข้า');
  return {headers,records:records.slice(1)};
}
function access(role:string,write=true){if(!(write?['owner','finance']:['owner','finance','auditor']).includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์จัดการรายงานการขาย');}
export async function inspectFile(ctx:Context,input:unknown){
  const d=fileInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{access(role);await assertShop(tx,ctx,d.shopId);const data=readCsv(d);return {headers:data.headers,sample:data.records.slice(0,3),total:data.records.length};});
}
function amount(value:string):number|null{
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,frac='']=value.replaceAll(',','').split('.');const n=Number(whole)*100+Number(frac.padEnd(2,'0'));
  return Number.isSafeInteger(n)&&n<=1_000_000_000?n:null;
}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
async function analyze(tx:Tx,ctx:Context,d:ImportInput):Promise<Preview>{
  await assertShop(tx,ctx,d.shopId);
  const {headers,records}=readCsv(d);
  const selected=[...fields.map(f=>d.mapping[f]),...(d.mapping.sourceLineId?[d.mapping.sourceLineId]:[]),...(d.mapping.platformFee?[d.mapping.platformFee]:[])];
  if(new Set(selected).size!==selected.length||fields.some(f=>!headers.includes(d.mapping[f]))||(d.mapping.sourceLineId&&!headers.includes(d.mapping.sourceLineId))||(d.mapping.platformFee&&!headers.includes(d.mapping.platformFee)))reject('เลือกคอลัมน์ให้ครบ โดยแต่ละข้อมูลใช้คนละคอลัมน์');
  const positions=Object.fromEntries(fields.map(f=>[f,headers.indexOf(d.mapping[f])])) as Record<Field,number>;
  const sourceLinePosition=d.mapping.sourceLineId?headers.indexOf(d.mapping.sourceLineId):-1;
  const feePosition=d.mapping.platformFee?headers.indexOf(d.mapping.platformFee):-1;
  type SourceRow=Record<Field,string>&{sourceLineId:string;platformFee:string};
  const source=records.map(values=>({...Object.fromEntries(fields.map(f=>[f,values[positions[f]].trim()])),sourceLineId:sourceLinePosition>=0?values[sourceLinePosition].trim():'',platformFee:feePosition>=0?values[feePosition].trim():''}) as SourceRow);
  const known=await tx.query<{sku:string;has_cost:boolean}>(`SELECT v.sku,(SELECT c.amount_minor FROM app.cost_versions c WHERE c.tenant_id=v.tenant_id AND c.variant_id=v.id AND c.effective_at<=clock_timestamp() ORDER BY c.effective_at DESC,c.created_at DESC LIMIT 1) IS NOT NULL AS has_cost
    FROM app.variants v JOIN app.shop_products s ON s.tenant_id=v.tenant_id AND s.product_id=v.product_id
    WHERE s.shop_id=$1 AND v.sku=ANY($2::text[])`,[d.shopId,[...new Set(source.map(r=>r.sku))]]);
  const committed=d.mapping.sourceLineId&&source.some(r=>r.sourceLineId)
    ?await tx.query<{source_line_id:string}>('SELECT source_line_id FROM app.sales_lines WHERE shop_id=$1 AND source_line_id=ANY($2::text[])',[d.shopId,[...new Set(source.map(r=>r.sourceLineId).filter(Boolean))]])
    :[];
  const committedIds=new Set(committed.map(r=>r.source_line_id));
  const bySku=new Map(known.map(k=>[k.sku,k]));const seen=new Set<string>(),seenSourceIds=new Set<string>();
  const rows=source.map((r,i):PreviewRow=>{
    const errors:string[]=[],warnings:string[]=[];
    if(d.mapping.sourceLineId){
      if(!r.sourceLineId||r.sourceLineId.length>150)errors.push('รหัสรายการต้นทางว่างหรือยาวเกิน 150 ตัวอักษร');
      else if(seenSourceIds.has(r.sourceLineId))errors.push('รหัสรายการต้นทางซ้ำในไฟล์นี้');
      else if(committedIds.has(r.sourceLineId))errors.push('รายการต้นทางนี้ถูกนำเข้าในร้านนี้แล้ว');
      seenSourceIds.add(r.sourceLineId);
    }
    if(!r.orderId||r.orderId.length>100)errors.push('เลขคำสั่งซื้อว่างหรือยาวเกิน 100 ตัวอักษร');
    if(!bySku.has(r.sku))errors.push('ไม่พบ SKU นี้ในร้านที่เลือก');
    else if(!bySku.get(r.sku)?.has_cost)warnings.push('ยังไม่มีต้นทุนสินค้า');
    const quantity=/^\d+$/.test(r.quantity)?Number(r.quantity):NaN;
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1_000_000)errors.push('จำนวนต้องเป็นจำนวนเต็ม 1–1,000,000');
    if(!validDate(r.date))errors.push('วันที่ต้องเป็น YYYY-MM-DD และเป็นวันที่จริง');
    const netSalesMinor=amount(r.netSales);if(netSalesMinor===null)errors.push('เงินรับสุทธิต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    const platformFeeMinor=r.platformFee?amount(r.platformFee):null;if(r.platformFee&&platformFeeMinor===null)errors.push('ค่าธรรมเนียมต้องเป็นจำนวนบวกและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
    const key=JSON.stringify([...fields.map(f=>r[f]),r.platformFee]);if(seen.has(key))warnings.push('ข้อมูลเหมือนรายการก่อนหน้า กรุณาตรวจว่าซ้ำหรือไม่');seen.add(key);
    return {record:i+1,sourceLineId:r.sourceLineId?r.sourceLineId.slice(0,150):null,orderId:r.orderId.slice(0,100),sku:r.sku.slice(0,100),date:r.date.slice(0,30),quantity:Number.isSafeInteger(quantity)?quantity:null,netSalesMinor,platformFeeMinor,errors,warnings};
  });
  return {rows,total:rows.length,valid:rows.filter(r=>!r.errors.length).length,invalid:rows.filter(r=>r.errors.length).length,warnings:rows.filter(r=>r.warnings.length).length,sourceHash:createHash('sha256').update(d.csv).digest('hex'),mapping:d.mapping,filename:d.filename};
}
export async function previewImport(ctx:Context,input:unknown){const d=mappedInput.parse(input);return withTenant(ctx,async(tx,role)=>{access(role);return analyze(tx,ctx,d);});}
export async function saveDraft(ctx:Context,input:unknown){
  const d=mappedInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    access(role);const preview=await analyze(tx,ctx,d);
    const parserVersion='orders-preview-v3';
    const fingerprint=createHash('sha256').update(JSON.stringify([preview.sourceHash,d.delimiter,[...fields.map(f=>d.mapping[f]),d.mapping.sourceLineId,d.mapping.platformFee],parserVersion])).digest('hex');
    const bytes=Buffer.from(d.csv,'utf8'),newSourceId=randomUUID();
    const insertedSources=await tx.query<{id:string}>(`INSERT INTO app.import_sources(tenant_id,id,shop_id,actor_id,filename,content_type,byte_size,source_hash,delimiter,adapter_key,schema_version,storage_version,content)
      VALUES($1,$2,$3,$4,$5,'text/csv',$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(tenant_id,shop_id,source_hash) DO NOTHING RETURNING id`,[ctx.tenantId,newSourceId,d.shopId,ctx.userId,d.filename,bytes.byteLength,preview.sourceHash,d.delimiter,sourceAdapter,sourceSchemaVersion,sourceStorageVersion,bytes]);
    const sourceId=insertedSources[0]?.id??(await tx.query<{id:string}>('SELECT id FROM app.import_sources WHERE shop_id=$1 AND source_hash=$2',[d.shopId,preview.sourceHash]))[0]?.id;
    if(!sourceId)throw new AppError(500,'SOURCE_STORE_FAILED','ไม่สามารถเก็บหลักฐานไฟล์ต้นฉบับได้');
    const rows=await tx.query<{id:string}>(`INSERT INTO app.import_drafts(tenant_id,id,shop_id,actor_id,filename,source_hash,fingerprint,mapping,preview,parser_version,source_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,shop_id,fingerprint) DO NOTHING RETURNING id`,[ctx.tenantId,randomUUID(),d.shopId,ctx.userId,d.filename,preview.sourceHash,fingerprint,JSON.stringify(d.mapping),JSON.stringify(preview),parserVersion,sourceId]);
    const id=rows[0]?.id??(await tx.query<{id:string}>('SELECT id FROM app.import_drafts WHERE shop_id=$1 AND fingerprint=$2',[d.shopId,fingerprint]))[0]?.id;
    if(!id)throw new AppError(500,'DRAFT_STORE_FAILED','ไม่สามารถบันทึกร่างนำเข้าได้');
    const [source]=await tx.query<StoredEvidence>(`SELECT $2::text AS filename,content_type AS "contentType",byte_size AS "byteSize",source_hash AS "sourceHash",adapter_key AS "adapterKey",schema_version AS "schemaVersion",storage_version AS "storageVersion",created_at AS "createdAt" FROM app.import_sources WHERE id=$1`,[sourceId,d.filename]);
    if(!source)throw new AppError(500,'SOURCE_STORE_FAILED','ไม่สามารถอ่านหลักฐานไฟล์ต้นฉบับที่บันทึกแล้วได้');
    if(!rows.length)return {id,duplicate:true,source:evidenceDto(source)};
    await audit(tx,ctx,'import.draft.created',id,{shopId:d.shopId,total:preview.total,invalid:preview.invalid,sourceId,sourceHash:preview.sourceHash,byteSize:bytes.byteLength,schemaVersion:sourceSchemaVersion});
    return {id,duplicate:false,source:evidenceDto(source)};
  });
}
export type Draft={id:string;filename:string;created_at:Date;preview:Preview;batch_id:string|null;committed_at:Date|null;source:ImportEvidence|null};
export async function importDrafts(ctx:Context,shopId:string){return withTenant(ctx,async(tx,role)=>{
  access(role,false);await assertShop(tx,ctx,shopId);
  return tx.query<{id:string;filename:string;created_at:Date;total:number;invalid:number;batch_id:string|null;committed_at:Date|null;source_hash:string|null;source_byte_size:number|null;source_schema_version:string|null}>(`SELECT d.id,d.filename,d.created_at,(d.preview->>'total')::int AS total,(d.preview->>'invalid')::int AS invalid,b.id AS batch_id,b.committed_at,s.source_hash,s.byte_size AS source_byte_size,s.schema_version AS source_schema_version
    FROM app.import_drafts d LEFT JOIN app.import_batches b ON b.tenant_id=d.tenant_id AND b.draft_id=d.id
    LEFT JOIN app.import_sources s ON s.tenant_id=d.tenant_id AND s.id=d.source_id
    WHERE d.shop_id=$1 ORDER BY d.created_at DESC LIMIT 30`,[shopId]);
});}
export async function getDraft(ctx:Context,shopId:string,id:string){uuid.parse(id);return withTenant(ctx,async(tx,role)=>{
  access(role,false);await assertShop(tx,ctx,shopId);
  type StoredDraft=Omit<Draft,'source'>&{sourceId:string|null;contentType:string|null;byteSize:number|null;sourceHash:string|null;adapterKey:string|null;schemaVersion:string|null;storageVersion:string|null;sourceCreatedAt:Date|null};
  const [draft]=await tx.query<StoredDraft>(`SELECT d.id,d.filename,d.created_at,d.preview,b.id AS batch_id,b.committed_at,
    s.id AS "sourceId",s.content_type AS "contentType",s.byte_size AS "byteSize",s.source_hash AS "sourceHash",s.adapter_key AS "adapterKey",s.schema_version AS "schemaVersion",s.storage_version AS "storageVersion",s.created_at AS "sourceCreatedAt"
    FROM app.import_drafts d LEFT JOIN app.import_batches b ON b.tenant_id=d.tenant_id AND b.draft_id=d.id
    LEFT JOIN app.import_sources s ON s.tenant_id=d.tenant_id AND s.id=d.source_id
    WHERE d.id=$1 AND d.shop_id=$2`,[id,shopId]);
  if(!draft)throw new AppError(404,'NOT_FOUND','ไม่พบร่างในร้านนี้');
  const {sourceId,contentType,byteSize,sourceHash,adapterKey,schemaVersion,storageVersion,sourceCreatedAt,...saved}=draft;
  const source=sourceId&&contentType&&byteSize!==null&&sourceHash&&adapterKey&&schemaVersion&&storageVersion&&sourceCreatedAt
    ?evidenceDto({filename:draft.filename,contentType,byteSize,sourceHash,adapterKey,schemaVersion,storageVersion,createdAt:sourceCreatedAt})
    :null;
  return {...saved,source};
});}

export type ImportSourceDownload={filename:string;contentType:string;byteSize:number;sourceHash:string;content:Buffer};
export async function getImportSource(ctx:Context,draftId:string):Promise<ImportSourceDownload>{uuid.parse(draftId);return withTenant(ctx,async(tx,role)=>{
  access(role,false);
  const [source]=await tx.query<ImportSourceDownload&{sourceId:string;shopId:string}>(`SELECT s.id AS "sourceId",d.shop_id AS "shopId",d.filename,s.content_type AS "contentType",s.byte_size AS "byteSize",s.source_hash AS "sourceHash",s.content
    FROM app.import_drafts d JOIN app.import_sources s ON s.tenant_id=d.tenant_id AND s.id=d.source_id WHERE d.id=$1`,[draftId]);
  if(!source)throw new AppError(404,'SOURCE_NOT_STORED','ร่างนี้ไม่มีไฟล์ต้นฉบับที่เก็บไว้');
  await audit(tx,ctx,'import.source.downloaded',source.sourceId,{draftId,shopId:source.shopId,sourceHash:source.sourceHash,byteSize:source.byteSize});
  return {filename:source.filename,contentType:source.contentType,byteSize:source.byteSize,sourceHash:source.sourceHash,content:source.content};
});}

const storedRowSchema=z.object({
  record:z.number().int().positive(),sourceLineId:z.string().min(1).max(150).nullable().default(null),orderId:z.string().min(1).max(100),sku:z.string().min(1).max(100),
  date:z.string().max(30),quantity:z.number().int().nullable(),
  netSalesMinor:z.number().int().nullable(),platformFeeMinor:z.number().int().nullable().default(null),
  errors:z.array(z.string()),warnings:z.array(z.string()),
});
const commitRowSchema=storedRowSchema.extend({date:z.string().refine(validDate),quantity:z.number().int().min(1).max(1_000_000),netSalesMinor:z.number().int().min(0).max(1_000_000_000),platformFeeMinor:z.number().int().min(0).max(1_000_000_000).nullable()});
const storedPreviewSchema=z.object({rows:z.array(storedRowSchema).min(1).max(1000),total:z.number().int().positive(),valid:z.number().int().nonnegative(),invalid:z.number().int().nonnegative(),warnings:z.number().int().nonnegative(),sourceHash:z.string().length(64),filename:z.string().min(1).max(150)}).passthrough();
const commitInput=z.object({shopId:uuid,draftId:uuid}).strict();
const duplicateSourceMessage='พบรายการต้นทางที่เคยนำเข้าแล้ว กรุณาสร้างร่างใหม่และนำรายการซ้ำออก';
function isSourceIdentityConflict(error:unknown){const e=error as {code?:string;constraint?:string}|null;return e?.code==='23505'&&e.constraint==='sales_lines_source_identity_idx';}

export async function commitDraft(ctx:Context,input:unknown){
  const d=commitInput.parse(input);
  try{return await withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,d.shopId);
    const [draft]=await tx.query<{id:string;filename:string;source_hash:string;parser_version:string;preview:unknown}>(`SELECT id,filename,source_hash,parser_version,preview FROM app.import_drafts WHERE id=$1 AND shop_id=$2`,[d.draftId,d.shopId]);
    if(!draft)throw new AppError(404,'NOT_FOUND','ไม่พบร่างในร้านนี้');
    const preview=storedPreviewSchema.parse(draft.preview);
    if(preview.total!==preview.rows.length||preview.valid+preview.invalid!==preview.total)throw new AppError(409,'IMPORT_CORRUPT','ข้อมูลร่างไม่สมบูรณ์ กรุณาสร้างร่างใหม่');
    if(preview.invalid||preview.valid!==preview.total||preview.rows.some(r=>r.errors.length))throw new AppError(409,'IMPORT_HAS_ERRORS','แก้รายการที่ไม่ผ่านการตรวจก่อนยืนยันนำเข้า');
    if(preview.rows.some(r=>r.warnings.includes('ข้อมูลเหมือนรายการก่อนหน้า กรุณาตรวจว่าซ้ำหรือไม่')))throw new AppError(409,'DUPLICATE_ROWS','ไฟล์มีแถวเหมือนกัน กรุณาตรวจและนำแถวซ้ำออกก่อนยืนยัน');
    const canonicalRows=z.array(commitRowSchema).parse(preview.rows);
    const sourceIds=canonicalRows.map(r=>r.sourceLineId).filter((id):id is string=>id!==null);
    if(sourceIds.length){
      const existing=await tx.query<{source_line_id:string}>('SELECT source_line_id FROM app.sales_lines WHERE shop_id=$1 AND source_line_id=ANY($2::text[]) LIMIT 1',[d.shopId,sourceIds]);
      if(existing.length)throw new AppError(409,'DUPLICATE_SOURCE_LINE',duplicateSourceMessage);
    }
    const batchId=randomUUID();
    const inserted=await tx.query<{id:string}>(`INSERT INTO app.import_batches(tenant_id,id,shop_id,draft_id,actor_id,filename,source_hash,parser_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,draft_id) DO NOTHING RETURNING id`,[ctx.tenantId,batchId,d.shopId,d.draftId,ctx.userId,draft.filename,draft.source_hash,draft.parser_version]);
    if(!inserted.length){
      const [existing]=await tx.query<{id:string}>('SELECT id FROM app.import_batches WHERE draft_id=$1 AND shop_id=$2',[d.draftId,d.shopId]);
      if(!existing)throw new AppError(409,'IMPORT_CONFLICT','ไม่สามารถยืนยันร่างนี้ได้ กรุณาลองใหม่');
      return {id:existing.id,duplicate:true,lines:canonicalRows.length};
    }
    const lookup=await tx.query<{record:number;variant_id:string;cost_minor:number|null}>(`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(record integer,sku text,sold_on date)
      ) SELECT x.record,v.id AS variant_id,c.amount_minor AS cost_minor
      FROM incoming x
      JOIN app.variants v ON v.tenant_id=$1 AND v.sku=x.sku
      JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id AND sp.shop_id=$2
      LEFT JOIN LATERAL (
        SELECT cv.amount_minor FROM app.cost_versions cv
        WHERE cv.tenant_id=v.tenant_id AND cv.variant_id=v.id
          AND cv.effective_at<((x.sold_on+1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        ORDER BY cv.effective_at DESC,cv.created_at DESC LIMIT 1
      ) c ON true`,[ctx.tenantId,d.shopId,JSON.stringify(canonicalRows.map(r=>({record:r.record,sku:r.sku,sold_on:r.date})))]);
    const byRecord=new Map(lookup.map(r=>[r.record,r]));
    if(byRecord.size!==canonicalRows.length)throw new AppError(409,'CATALOG_CHANGED','SKU ในร่างไม่ตรงกับสินค้าปัจจุบัน กรุณาสร้างร่างใหม่');
    for(const row of canonicalRows){
      const matched=byRecord.get(row.record)!;
      const cogs=matched.cost_minor===null?null:matched.cost_minor*row.quantity;
      const contribution=cogs===null?null:row.netSalesMinor-cogs;
      const lineId=randomUUID();
      await tx.query(`INSERT INTO app.sales_lines(tenant_id,id,batch_id,shop_id,source_record,source_line_id,order_id,variant_id,sold_on,quantity,net_receipt_minor,platform_fee_minor,unit_cost_minor,cogs_minor,contribution_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[ctx.tenantId,lineId,batchId,d.shopId,row.record,row.sourceLineId,row.orderId,matched.variant_id,row.date,row.quantity,row.netSalesMinor,row.platformFeeMinor,matched.cost_minor,cogs,contribution]);
      await tx.query(`INSERT INTO app.sales_line_calculations(tenant_id,id,sales_line_id,version,unit_cost_minor,basis,actor_id)
        VALUES($1,$2,$3,1,$4,'import',$5)`,[ctx.tenantId,randomUUID(),lineId,matched.cost_minor,ctx.userId]);
    }
    await audit(tx,ctx,'import.batch.committed',batchId,{shopId:d.shopId,draftId:d.draftId,lines:preview.total,missingCostLines:lookup.filter(r=>r.cost_minor===null).length,calculationVersion:'net-receipt-minus-cogs-v1'});
    return {id:batchId,duplicate:false,lines:preview.total};
  });}catch(error){if(isSourceIdentityConflict(error))throw new AppError(409,'DUPLICATE_SOURCE_LINE',duplicateSourceMessage);throw error;}
}

type SummaryTotal={lineCount:number;orderCount:number;netReceiptMinor:number;platformFeeMinor:number;feeLineCount:number;missingCostLines:number;manualCostLines:number;cogsMinor:number|null;contributionMinor:number|null};
type SummaryRow={lineCount:number;netReceiptMinor:number;platformFeeMinor:number;feeLineCount:number;missingCostLines:number;manualCostLines:number;cogsMinor:number|null;contributionMinor:number|null};
export type FinancialSummary={total:SummaryTotal;bySku:({variantId:string;sku:string;name:string;quantity:number}&SummaryRow)[];orders:({orderId:string;soldOn:string;draftId:string|null}&SummaryRow)[];batchCount:number;asOf:string;calculationVersion:string};
function integer(value:string|number|null){return value===null?null:Number(value);}
export async function financialSummary(ctx:Context,shopId:string):Promise<FinancialSummary>{
  return withTenant(ctx,async(tx,role)=>{
    access(role,false);await assertShop(tx,ctx,shopId);
    type RawTotal={lineCount:number;orderCount:number;netReceiptMinor:string;platformFeeMinor:string;feeLineCount:number;missingCostLines:number;manualCostLines:number;cogsMinor:string|null;contributionMinor:string|null};
    const [rawTotal]=await tx.query<RawTotal>(`SELECT count(*)::int AS "lineCount",count(DISTINCT (order_id,sold_on))::int AS "orderCount",
      coalesce(sum(l.net_receipt_minor),0)::text AS "netReceiptMinor",coalesce(sum(l.platform_fee_minor),0)::text AS "platformFeeMinor",
      count(l.platform_fee_minor)::int AS "feeLineCount",count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)::int AS "missingCostLines",
      count(*) FILTER(WHERE calc.basis='manual_missing_cost')::int AS "manualCostLines",
      CASE WHEN count(*)>0 AND count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)=0 THEN sum(calc.unit_cost_minor::bigint*l.quantity)::text END AS "cogsMinor",
      CASE WHEN count(*)>0 AND count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)=0 THEN sum(l.net_receipt_minor::bigint-calc.unit_cost_minor::bigint*l.quantity)::text END AS "contributionMinor"
      FROM app.sales_lines l JOIN LATERAL (
        SELECT c.unit_cost_minor,c.basis FROM app.sales_line_calculations c
        WHERE c.tenant_id=l.tenant_id AND c.sales_line_id=l.id ORDER BY c.version DESC LIMIT 1
      ) calc ON true WHERE l.shop_id=$1`,[shopId]);
    type RawSku={variantId:string;sku:string;name:string;quantity:string;lineCount:number;netReceiptMinor:string;platformFeeMinor:string;feeLineCount:number;missingCostLines:number;manualCostLines:number;cogsMinor:string|null;contributionMinor:string|null};
    const rawSku=await tx.query<RawSku>(`SELECT v.id AS "variantId",v.sku,p.name,sum(l.quantity)::text AS quantity,count(*)::int AS "lineCount",
      sum(l.net_receipt_minor)::text AS "netReceiptMinor",coalesce(sum(l.platform_fee_minor),0)::text AS "platformFeeMinor",count(l.platform_fee_minor)::int AS "feeLineCount",
      count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)::int AS "missingCostLines",count(*) FILTER(WHERE calc.basis='manual_missing_cost')::int AS "manualCostLines",
      CASE WHEN count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)=0 THEN sum(calc.unit_cost_minor::bigint*l.quantity)::text END AS "cogsMinor",
      CASE WHEN count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)=0 THEN sum(l.net_receipt_minor::bigint-calc.unit_cost_minor::bigint*l.quantity)::text END AS "contributionMinor"
      FROM app.sales_lines l JOIN app.variants v ON v.tenant_id=l.tenant_id AND v.id=l.variant_id
      JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      JOIN LATERAL (SELECT c.unit_cost_minor,c.basis FROM app.sales_line_calculations c WHERE c.tenant_id=l.tenant_id AND c.sales_line_id=l.id ORDER BY c.version DESC LIMIT 1) calc ON true
      WHERE l.shop_id=$1 GROUP BY v.id,v.sku,p.name ORDER BY sum(l.net_receipt_minor) DESC,v.sku LIMIT 100`,[shopId]);
    type RawOrder={orderId:string;soldOn:Date;lineCount:number;netReceiptMinor:string;platformFeeMinor:string;feeLineCount:number;missingCostLines:number;manualCostLines:number;cogsMinor:string|null;contributionMinor:string|null;draftId:string|null};
    const rawOrders=await tx.query<RawOrder>(`SELECT l.order_id AS "orderId",l.sold_on AS "soldOn",count(*)::int AS "lineCount",sum(l.net_receipt_minor)::text AS "netReceiptMinor",
      coalesce(sum(l.platform_fee_minor),0)::text AS "platformFeeMinor",count(l.platform_fee_minor)::int AS "feeLineCount",count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)::int AS "missingCostLines",
      count(*) FILTER(WHERE calc.basis='manual_missing_cost')::int AS "manualCostLines",
      CASE WHEN count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)=0 THEN sum(calc.unit_cost_minor::bigint*l.quantity)::text END AS "cogsMinor",
      CASE WHEN count(*) FILTER(WHERE calc.unit_cost_minor IS NULL)=0 THEN sum(l.net_receipt_minor::bigint-calc.unit_cost_minor::bigint*l.quantity)::text END AS "contributionMinor",
      CASE WHEN count(DISTINCT b.draft_id)=1 THEN min(b.draft_id::text) END AS "draftId"
      FROM app.sales_lines l JOIN app.import_batches b ON b.tenant_id=l.tenant_id AND b.id=l.batch_id
      JOIN LATERAL (SELECT c.unit_cost_minor,c.basis FROM app.sales_line_calculations c WHERE c.tenant_id=l.tenant_id AND c.sales_line_id=l.id ORDER BY c.version DESC LIMIT 1) calc ON true
      WHERE l.shop_id=$1 GROUP BY l.order_id,l.sold_on ORDER BY l.sold_on DESC,l.order_id DESC LIMIT 50`,[shopId]);
    const [{batchCount}]=await tx.query<{batchCount:number}>('SELECT count(*)::int AS "batchCount" FROM app.import_batches WHERE shop_id=$1',[shopId]);
    const convert=<T extends {netReceiptMinor:string;platformFeeMinor:string;cogsMinor:string|null;contributionMinor:string|null}>(r:T)=>({...r,netReceiptMinor:Number(r.netReceiptMinor),platformFeeMinor:Number(r.platformFeeMinor),cogsMinor:integer(r.cogsMinor),contributionMinor:integer(r.contributionMinor)});
    return {total:convert(rawTotal) as SummaryTotal,bySku:rawSku.map(r=>({...convert(r),quantity:Number(r.quantity)})),orders:rawOrders.map(r=>({...convert(r),soldOn:new Date(r.soldOn).toISOString().slice(0,10)})),batchCount,asOf:new Date().toISOString(),calculationVersion:'net-receipt-minus-cogs-v1'};
  });
}

export type CostReviewItem={lineId:string;version:number;orderId:string;sku:string;productName:string;soldOn:string;quantity:number;netReceiptMinor:number;currentCostMinor:number|null;draftId:string};
export type CostReviewInbox={total:number;items:CostReviewItem[];limit:number};
export async function reviewItems(ctx:Context,shopId:string):Promise<CostReviewInbox>{
  return withTenant(ctx,async(tx,role)=>{
    access(role,false);await assertShop(tx,ctx,shopId);
    const [{total}]=await tx.query<{total:number}>(`SELECT count(*)::int AS total FROM app.sales_lines l
      JOIN LATERAL (SELECT c.unit_cost_minor FROM app.sales_line_calculations c WHERE c.tenant_id=l.tenant_id AND c.sales_line_id=l.id ORDER BY c.version DESC LIMIT 1) calc ON true
      WHERE l.shop_id=$1 AND calc.unit_cost_minor IS NULL`,[shopId]);
    const rows=await tx.query<Omit<CostReviewItem,'soldOn'>&{soldOn:Date}>(`SELECT l.id AS "lineId",calc.version,l.order_id AS "orderId",v.sku,p.name AS "productName",l.sold_on AS "soldOn",l.quantity,
      l.net_receipt_minor AS "netReceiptMinor",current_cost.amount_minor AS "currentCostMinor",b.draft_id AS "draftId"
      FROM app.sales_lines l
      JOIN app.import_batches b ON b.tenant_id=l.tenant_id AND b.id=l.batch_id
      JOIN app.variants v ON v.tenant_id=l.tenant_id AND v.id=l.variant_id
      JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      JOIN LATERAL (SELECT c.version,c.unit_cost_minor FROM app.sales_line_calculations c WHERE c.tenant_id=l.tenant_id AND c.sales_line_id=l.id ORDER BY c.version DESC LIMIT 1) calc ON true
      LEFT JOIN LATERAL (SELECT cv.amount_minor FROM app.cost_versions cv WHERE cv.tenant_id=l.tenant_id AND cv.variant_id=l.variant_id AND cv.effective_at<=clock_timestamp() ORDER BY cv.effective_at DESC,cv.created_at DESC LIMIT 1) current_cost ON true
      WHERE l.shop_id=$1 AND calc.unit_cost_minor IS NULL ORDER BY l.sold_on DESC,l.created_at DESC LIMIT 100`,[shopId]);
    return {total,limit:100,items:rows.map(r=>({...r,soldOn:new Date(r.soldOn).toISOString().slice(0,10)}))};
  });
}

const resolveCostInput=z.object({shopId:uuid,lineId:uuid,version:z.number().int().positive(),costMinor:z.number().int().min(0).max(1_000_000_000),reason:z.string().trim().min(3).max(500)}).strict();
export async function resolveMissingCost(ctx:Context,input:unknown){
  const d=resolveCostInput.parse(input);
  return withTenant(ctx,async(tx,role)=>{
    access(role);await assertShop(tx,ctx,d.shopId);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.tenantId}:${d.lineId}`]);
    const [line]=await tx.query<{version:number;unitCostMinor:number|null;orderId:string}>(`SELECT calc.version,calc.unit_cost_minor AS "unitCostMinor",l.order_id AS "orderId"
      FROM app.sales_lines l JOIN LATERAL (
        SELECT c.version,c.unit_cost_minor FROM app.sales_line_calculations c
        WHERE c.tenant_id=l.tenant_id AND c.sales_line_id=l.id ORDER BY c.version DESC LIMIT 1
      ) calc ON true WHERE l.id=$1 AND l.shop_id=$2`,[d.lineId,d.shopId]);
    if(!line)throw new AppError(404,'NOT_FOUND','ไม่พบรายการที่ต้องตรวจในร้านนี้');
    if(line.version!==d.version)throw new AppError(409,'STALE_REVIEW','รายการนี้ถูกดำเนินการแล้ว กรุณาโหลดข้อมูลล่าสุด');
    if(line.unitCostMinor!==null)throw new AppError(409,'ALREADY_RESOLVED','รายการนี้มีต้นทุนที่ยืนยันแล้ว');
    const id=randomUUID(),nextVersion=line.version+1;
    await tx.query(`INSERT INTO app.sales_line_calculations(tenant_id,id,sales_line_id,version,unit_cost_minor,basis,reason,actor_id)
      VALUES($1,$2,$3,$4,$5,'manual_missing_cost',$6,$7)`,[ctx.tenantId,id,d.lineId,nextVersion,d.costMinor,d.reason,ctx.userId]);
    await audit(tx,ctx,'sales_line.cost_resolved',d.lineId,{shopId:d.shopId,orderId:line.orderId,version:nextVersion,basis:'manual_missing_cost'});
    return {id,lineId:d.lineId,version:nextVersion,costMinor:d.costMinor};
  });
}
