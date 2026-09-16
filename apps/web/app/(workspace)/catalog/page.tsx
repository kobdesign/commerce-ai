import { workspace } from '../../../lib/server';
import { catalog } from '@commerce/domain';
import { CatalogView } from '../../../components/catalog-view';
export default async function CatalogPage({searchParams}:{searchParams:Promise<{saved?:string;focus?:string}>}){const w=await workspace();if(!w.shop)return <div className="empty-state"><h1>เพิ่มร้านค้าเพื่อเริ่มจัดการสินค้า</h1><a href="/">กลับไปเพิ่มร้านค้า</a></div>;const data=await catalog(w.ctx,w.shop.id);return <CatalogView key={w.org.id+':'+w.shop.id} tenantId={w.org.id} shopId={w.shop.id} saved={(await searchParams).saved} focused={(await searchParams).focus} {...data}/>;}
