import Link from 'next/link';
import { workspace } from '../../../../lib/server';
import { catalog } from '@commerce/domain';
import { ProductEditor } from '../../../../components/product-editor';
export const metadata={title:'เพิ่มสินค้า · Commerce'};
export default async function NewProduct(){
  const w=await workspace();
  if(!w.shop)return <div className="empty-state"><h1>เพิ่มร้านค้าก่อนเพิ่มสินค้า</h1><Link href="/">ไปที่ภาพรวม</Link></div>;
  const data=await catalog(w.ctx,w.shop.id);
  if(!data.canWrite)return <div className="empty-state"><h1>คุณไม่มีสิทธิ์เพิ่มสินค้า</h1><Link href="/catalog">กลับไปสินค้า</Link></div>;
  return <ProductEditor key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name} categories={[...new Set(data.items.map(i=>i.category))]}/>;
}
