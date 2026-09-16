'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { login,logout,organizations,shops,createOrganization } from '@commerce/domain';
import { resolveContext } from '@commerce/db';
import { AppError } from '@commerce/contracts';
import { requireUser } from '../lib/server';
const options={httpOnly:true,sameSite:'lax' as const,secure:process.env.APP_ORIGIN?.startsWith('https:')??false,path:'/',maxAge:28800};
export async function signIn(data:FormData){
  let token:string;
  try{token=await login(String(data.get('email')??''),String(data.get('password')??''));}
  catch(e){if(e instanceof AppError)redirect('/login?error='+encodeURIComponent(e.message));throw e;}
  const jar=await cookies();jar.set('commerce_session',token,options);jar.delete('commerce_tenant');jar.delete('commerce_shop');redirect('/');
}
export async function signOut(){const jar=await cookies();await logout(jar.get('commerce_session')?.value);jar.delete('commerce_session');jar.delete('commerce_tenant');jar.delete('commerce_shop');redirect('/login');}
export async function switchOrganization(data:FormData){
  const u=await requireUser(),id=String(data.get('tenantId')??'');
  if(!(await organizations(u.id)).some(o=>o.id===id))throw new AppError(403,'FORBIDDEN','ไม่มีสิทธิ์บริษัทนี้');
  const jar=await cookies();jar.set('commerce_tenant',id,options);jar.delete('commerce_shop');redirect('/');
}
export async function switchShop(data:FormData){
  const u=await requireUser(),tenant=String(data.get('tenantId')??''),id=String(data.get('shopId')??'');
  const ctx=await resolveContext(u.id,tenant);if(!(await shops(ctx)).some(s=>s.id===id))throw new AppError(403,'FORBIDDEN','ไม่มีสิทธิ์ร้านนี้');
  const jar=await cookies();jar.set('commerce_tenant',tenant,options);jar.set('commerce_shop',id,options);redirect('/catalog');
}
export async function newOrganization(data:FormData){
  const u=await requireUser(),id=await createOrganization(u.id,data.get('name'));
  const jar=await cookies();jar.set('commerce_tenant',id,options);jar.delete('commerce_shop');redirect('/');
}
