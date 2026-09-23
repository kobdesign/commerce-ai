import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { basename,dirname,extname,resolve } from 'node:path';
import {
  marketplaceSettlementAdapters,reviewSanitizedSettlementSample,sanitizeMarketplaceSettlementCsv,
  type MarketplaceSettlementAdapterKey,
} from '@commerce/finance';

function argument(name:string){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;}
function fail(message:string):never{throw new Error(message);}

const inputArg=argument('--input')??fail('กรุณาระบุ --input ไฟล์ CSV ต้นฉบับ');
const outputArg=argument('--output')??fail('กรุณาระบุ --output สำหรับไฟล์ที่ปกปิดแล้ว');
const platformArg=argument('--platform')??fail(`กรุณาระบุ --platform ${marketplaceSettlementAdapters.join('|')}`);
if(!marketplaceSettlementAdapters.includes(platformArg as MarketplaceSettlementAdapterKey))fail('platform ไม่อยู่ในรายการที่รองรับ');
const delimiterArg=argument('--delimiter')??',';if(![',',';','tab'].includes(delimiterArg))fail('delimiter ต้องเป็น comma, ; หรือ tab');
const delimiter=delimiterArg==='tab'?'\t':delimiterArg as ','|';';
const input=resolve(inputArg),output=resolve(outputArg);if(input===output)fail('ห้ามเขียนทับไฟล์ต้นฉบับ');
if(extname(input).toLowerCase()!=='.csv'||extname(output).toLowerCase()!=='.csv')fail('คำสั่งเตรียมไฟล์รองรับ CSV เท่านั้น; XLSX ต้องปกปิดใน secure workspace แล้วใช้ flow ตรวจรับ');
const redactionKey=process.env.DATA_REDACTION_KEY??fail('ยังไม่มี DATA_REDACTION_KEY สำหรับแทนรหัสแบบคงที่');
const adapterKey=platformArg as MarketplaceSettlementAdapterKey,source=await readFile(input,'utf8'),prepared=sanitizeMarketplaceSettlementCsv({csv:source,delimiter,redactionKey,adapterKey});
const review=await reviewSanitizedSettlementSample({
  shopId:'00000000-0000-4000-8000-000000000000',filename:basename(output),contentBase64:Buffer.from(prepared.csv).toString('base64'),
  contentType:'text/csv',delimiter,adapterKey,
});
const reportPath=`${output}.review.local.json`;await mkdir(dirname(output),{recursive:true});
await writeFile(output,prepared.csv,{encoding:'utf8',flag:'wx'});await writeFile(reportPath,`${JSON.stringify({manifest:prepared.manifest,review},null,2)}\n`,{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({status:review.status,adapter:review.adapter?.key??null,rows:review.semantics?.rows??0,payouts:review.semantics?.payouts??0,
  findings:review.redaction.findings.length,invalidRows:review.semantics?.invalidRows??0,output:basename(output),report:basename(reportPath)},null,2));
if(review.status==='blocked')process.exitCode=2;
