import Link from 'next/link';
import { AppError } from '@commerce/contracts';
import { centralInventoryOverview } from '@commerce/domain';
import { workspace } from '../../../lib/server';
import { CentralInventoryView } from '../../../components/central-inventory-view';

export const metadata={title:'สต็อกกลาง · Commerce'};
export default async function CentralInventoryPage({searchParams}:{searchParams:Promise<{search?:string;status?:string;page?:string}>}){
 const w=await workspace(),params=await searchParams;
 try{
  const data=await centralInventoryOverview(w.ctx,{search:params.search,status:params.status,page:Number(params.page)||1});
  return <CentralInventoryView key={`${w.org.id}:${data.query.search}:${data.query.status}:${data.query.page}`} tenantId={w.org.id} currentShopId={w.shop?.id} data={data}/>;
 }catch(error){
  if(error instanceof AppError&&error.status===403)return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูข้อมูลสต็อก</h1><p>สต็อกกลางเปิดให้เจ้าของ ผู้ดูแลคลัง การเงิน และผู้ตรวจสอบ</p><Link href="/catalog">กลับไปสินค้า</Link></div>;
  throw error;
 }
}
