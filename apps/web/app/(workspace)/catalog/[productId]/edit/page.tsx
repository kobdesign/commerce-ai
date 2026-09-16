import Link from 'next/link';
import { AppError,uuid } from '@commerce/contracts';
import { notFound } from 'next/navigation';
import { getProductForEdit } from '@commerce/domain';
import { workspace } from '../../../../../lib/server';
import { ProductUpdateForm } from '../../../../../components/product-update-form';
export const metadata={title:'แก้ไขสินค้า · Commerce'};
export default async function EditProduct({params}:{params:Promise<{productId:string}>}){
  const w=await workspace();
  const {productId}=await params;if(!uuid.safeParse(productId).success)notFound();
  if(!w.shop)return <div className="empty-state"><h1>เลือกร้านค้าก่อนแก้ไขสินค้า</h1><Link href="/catalog">กลับไปสินค้า</Link></div>;
  try{
    const product=await getProductForEdit(w.ctx,w.shop.id,productId);
    return <ProductUpdateForm key={`${w.org.id}:${w.shop.id}:${product.id}:${product.version}`} product={product} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name}/>;
  }catch(e){
    if(e instanceof AppError&&[403,404].includes(e.status))return <div className="empty-state"><h1>{e.message}</h1><p>การแก้ไขสินค้าที่ใช้ร่วมกันต้องมีสิทธิ์ในทุกร้านที่เชื่อมกับสินค้านั้น</p><Link href="/catalog">กลับไปสินค้า</Link></div>;
    throw e;
  }
}
