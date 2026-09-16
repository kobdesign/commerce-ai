import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { sessionUser,organizations,shops } from '@commerce/domain';
import { resolveContext } from '@commerce/db';
import { AppError,uuid } from '@commerce/contracts';
import { cache } from 'react';
export async function user(){return sessionUser((await cookies()).get('commerce_session')?.value);}
export async function requireUser(){const u=await user();if(!u)throw new AppError(401,'UNAUTHENTICATED','กรุณาเข้าสู่ระบบ');return u;}
export async function apiContext(tenantId:string){uuid.parse(tenantId);const u=await requireUser();return resolveContext(u.id,tenantId);}
export const workspace=cache(async function workspace(){
  const u=await user();if(!u)redirect('/login');
  const orgs=await organizations(u.id);const jar=await cookies();
  const org=orgs.find(t=>t.id===jar.get('commerce_tenant')?.value)??orgs[0];
  if(!org)redirect('/onboarding');
  const ctx=await resolveContext(u.id,org.id),allowedShops=await shops(ctx);
  const shop=allowedShops.find(s=>s.id===jar.get('commerce_shop')?.value)??allowedShops[0]??null;
  return {user:u,org,orgs,ctx,shops:allowedShops,shop};
});
export function checkOrigin(req:Request){
  const configured=process.env.APP_ORIGIN;
  if(!configured||req.headers.get('origin')!==new URL(configured).origin)throw new AppError(403,'ORIGIN_REJECTED','คำขอนี้ไม่ได้มาจากแอปที่อนุญาต');
}
export async function jsonInput(req:Request,maxBytes=32768){
  checkOrigin(req);
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError(415,'CONTENT_TYPE','ต้องส่งข้อมูล JSON');
  const reader=req.body?.getReader();if(!reader)throw new AppError(400,'EMPTY','ไม่มีข้อมูล');
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new AppError(413,'TOO_LARGE','ข้อมูลมีขนาดใหญ่เกินกำหนด');}chunks.push(value);}}finally{reader.releaseLock();}
  const text=Buffer.concat(chunks).toString('utf8');
  try{return JSON.parse(text) as unknown;}catch{throw new AppError(400,'INVALID_JSON','รูปแบบข้อมูลไม่ถูกต้อง');}
}
export async function respond(fn:()=>Promise<unknown>){
  try{return NextResponse.json(await fn(),{headers:{'Cache-Control':'private, no-store'}});}
  catch(e){
    if(e instanceof AppError)return NextResponse.json({error:e.message,code:e.code},{status:e.status});
    if(e instanceof ZodError)return NextResponse.json({error:'กรุณาตรวจข้อมูลที่กรอก',code:'VALIDATION'},{status:400});
    if(typeof e==='object'&&e&&'code'in e&&e.code==='23505')return NextResponse.json({error:'รหัสนี้มีอยู่แล้ว กรุณาใช้รหัสใหม่',code:'DUPLICATE'},{status:409});
    console.error('Request failed:',e instanceof Error?e.name:'Unknown');
    return NextResponse.json({error:'ไม่สามารถดำเนินการได้ในขณะนี้',code:'INTERNAL'},{status:500});
  }
}
