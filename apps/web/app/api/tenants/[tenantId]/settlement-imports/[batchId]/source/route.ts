import { ZodError } from 'zod';
import { AppError } from '@commerce/contracts';
import { getSettlementImportSource } from '@commerce/finance';
import { apiContext } from '../../../../../../../lib/server';

function contentDisposition(filename:string){
  const fallback=filename.replace(/[^\x20-\x7E]/g,'_').replace(/["\\]/g,'_').replace(/[\r\n]/g,'_')||'settlement.csv';
  const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req:Request,{params}:{params:Promise<{tenantId:string;batchId:string}>}){
  try{
    const {tenantId,batchId}=await params,ctx=await apiContext(tenantId),source=await getSettlementImportSource(ctx,batchId);
    return new Response(new Uint8Array(source.content),{headers:{
      'Cache-Control':'private, no-store','Content-Disposition':contentDisposition(source.filename),'Content-Length':String(source.byteSize),
      'Content-Type':source.contentType==='text/csv'?`${source.contentType}; charset=utf-8`:source.contentType,'ETag':`"${source.sourceHash}"`,'X-Content-SHA256':source.sourceHash,'X-Content-Type-Options':'nosniff',
    }});
  }catch(error){
    if(error instanceof AppError)return Response.json({error:error.message,code:error.code},{status:error.status,headers:{'Cache-Control':'private, no-store'}});
    if(error instanceof ZodError)return Response.json({error:'รหัสชุดนำเข้าไม่ถูกต้อง',code:'VALIDATION'},{status:400,headers:{'Cache-Control':'private, no-store'}});
    console.error('Settlement source download failed:',error instanceof Error?error.name:'Unknown');
    return Response.json({error:'ไม่สามารถดาวน์โหลดไฟล์ statement ได้ในขณะนี้',code:'INTERNAL'},{status:500,headers:{'Cache-Control':'private, no-store'}});
  }
}
