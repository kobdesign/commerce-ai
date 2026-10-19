import { commerceOrdersWorkspace } from '@commerce/domain';
import { workspace } from '../../../lib/server';
import { OrdersWorkspace } from '../../../components/orders-workspace';
export const metadata={title:'คำสั่งซื้อ · Commerce'};
export default async function OrdersPage(){
  const w=await workspace();
  if(!w.shop||!['owner','finance','operator','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูคำสั่งซื้อในร้านนี้</h1></div>;
  const data=await commerceOrdersWorkspace(w.ctx,w.shop.id);
  return <OrdersWorkspace key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shop={w.shop} workspace={data}/>;
}
