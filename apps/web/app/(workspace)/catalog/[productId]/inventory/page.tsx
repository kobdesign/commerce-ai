import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppError,uuid } from '@commerce/contracts';
import { inventoryOverview } from '@commerce/domain';
import { workspace } from '../../../../../lib/server';
import { InventoryWorkspace } from '../../../../../components/inventory-workspace';
export const metadata={title:'สต็อกสินค้า · Commerce'};
export default async function ProductInventory({params}:{params:Promise<{productId:string}>}){
  const w=await workspace(),{productId}=await params;
  if(!uuid.safeParse(productId).success)notFound();
  if(!w.shop)return <div className="empty-state"><h1>เลือกร้านค้าก่อนจัดการสต็อก</h1><Link href="/catalog">กลับไปสินค้า</Link></div>;
  try{
    const overview=await inventoryOverview(w.ctx,w.shop.id,productId);
    return <InventoryWorkspace key={`${w.org.id}:${w.shop.id}:${productId}`} tenantId={w.org.id} shopId={w.shop.id} initialOverview={overview}/>;
  }catch(error){
    if(error instanceof AppError&&[403,404].includes(error.status))return <div className="empty-state"><h1>{error.message}</h1><p>สต็อกเป็นข้อมูลระดับบริษัทและเปิดให้ผู้ดูแลคลัง การเงิน เจ้าของ และผู้ตรวจสอบ</p><Link href="/catalog">กลับไปสินค้า</Link></div>;
    throw error;
  }
}
