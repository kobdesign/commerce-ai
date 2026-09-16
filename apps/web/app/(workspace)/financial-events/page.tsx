import { financialEvents } from '@commerce/finance';
import { workspace } from '../../../lib/server';
import { FinancialEventWorkspace } from '../../../components/financial-event-workspace';

export const metadata={title:'คืนเงินและปรับยอด · Commerce'};

export default async function FinancialEventsPage(){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูรายการปรับยอดในร้านนี้</h1></div>;
  const ledger=await financialEvents(w.ctx,w.shop.id);
  const today=new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10);
  return <FinancialEventWorkspace key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name} canWrite={w.ctx.role!=='auditor'} today={today} ledger={ledger}/>;
}
