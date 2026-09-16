import { reviewItems } from '@commerce/imports';
import { workspace } from '../../../lib/server';
import { ReviewInbox } from '../../../components/review-inbox';

export const metadata={title:'รายการที่ต้องตรวจ · Commerce'};

export default async function ReviewsPage(){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูรายการที่ต้องตรวจในร้านนี้</h1></div>;
  const inbox=await reviewItems(w.ctx,w.shop.id);
  return <ReviewInbox key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name} canWrite={w.ctx.role!=='auditor'} inbox={inbox}/>;
}
