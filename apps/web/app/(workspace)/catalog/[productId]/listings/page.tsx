import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppError,uuid } from '@commerce/contracts';
import { channelListingMappings,getProductForEdit } from '@commerce/domain';
import { workspace } from '../../../../../lib/server';
import { ListingMappingWorkspace } from '../../../../../components/listing-mapping-workspace';
export const metadata={title:'เชื่อมช่องทางขาย · Commerce'};
export default async function ProductListings({params}:{params:Promise<{productId:string}>}){
  const w=await workspace(),{productId}=await params;
  if(!uuid.safeParse(productId).success)notFound();
  if(!w.shop)return <div className="empty-state"><h1>เลือกร้านค้าก่อนเชื่อมสินค้า</h1><Link href="/catalog">กลับไปสินค้า</Link></div>;
  try{
    const [product,mappings]=await Promise.all([getProductForEdit(w.ctx,w.shop.id,productId),channelListingMappings(w.ctx,w.shop.id,productId)]);
    return <ListingMappingWorkspace key={`${w.org.id}:${w.shop.id}:${product.id}`} tenantId={w.org.id} shop={w.shop} product={product} initialMappings={mappings}/>;
  }catch(error){
    if(error instanceof AppError&&[403,404].includes(error.status))return <div className="empty-state"><h1>{error.message}</h1><p>การเชื่อมรหัสต้องมีสิทธิ์แก้ไขสินค้านี้และร้านที่เลือก</p><Link href="/catalog">กลับไปสินค้า</Link></div>;
    throw error;
  }
}
