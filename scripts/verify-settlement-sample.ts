import { readFile } from 'node:fs/promises';
import { basename,extname,resolve } from 'node:path';
import { marketplaceSettlementAdapters,reviewSanitizedSettlementSample,verifySettlementSampleAcceptance,type MarketplaceSettlementAdapterKey } from '@commerce/finance';

function argument(name:string){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;}
function fail(message:string):never{throw new Error(message);}
const sample=resolve(argument('--sample')??fail('กรุณาระบุ --sample ไฟล์ที่ปกปิดแล้ว'));
const acceptancePath=resolve(argument('--acceptance')??fail('กรุณาระบุ --acceptance ไฟล์ผลตรวจจากฝ่ายการเงิน'));
const platformArg=argument('--platform')??fail(`กรุณาระบุ --platform ${marketplaceSettlementAdapters.join('|')}`);
if(!marketplaceSettlementAdapters.includes(platformArg as MarketplaceSettlementAdapterKey))fail('platform ไม่อยู่ในรายการที่รองรับ');
const delimiterArg=argument('--delimiter')??',';if(![',',';','tab'].includes(delimiterArg))fail('delimiter ต้องเป็น comma, ; หรือ tab');const delimiter=delimiterArg==='tab'?'\t':delimiterArg as ','|';';
const extension=extname(sample).toLowerCase(),contentType=extension==='.csv'?'text/csv':extension==='.xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':fail('sample ต้องเป็น CSV หรือ XLSX');
const bytes=await readFile(sample),acceptance=JSON.parse(await readFile(acceptancePath,'utf8')) as unknown,adapterKey=platformArg as MarketplaceSettlementAdapterKey;
const review=await reviewSanitizedSettlementSample({shopId:'00000000-0000-4000-8000-000000000000',filename:basename(sample),contentBase64:bytes.toString('base64'),contentType,...(contentType==='text/csv'?{delimiter}:{}),adapterKey});
const verification=verifySettlementSampleAcceptance(review,acceptance);
console.log(JSON.stringify({passed:verification.passed,adapter:review.adapter?.key??null,status:review.status,checks:verification.checks},null,2));
if(!verification.passed)process.exitCode=2;
