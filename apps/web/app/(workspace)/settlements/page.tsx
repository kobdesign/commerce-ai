import { settlementImportBatches,settlements } from '@commerce/finance';
import { workspace } from '../../../lib/server';
import { SettlementWorkspace } from '../../../components/settlement-workspace';

export const metadata={title:'กระทบยอดเงินโอน · Commerce'};

export default async function SettlementsPage(){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูกระทบยอดเงินโอนในร้านนี้</h1></div>;
  const [ledger,batches]=await Promise.all([settlements(w.ctx,w.shop.id),settlementImportBatches(w.ctx,w.shop.id)]);
  const today=new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10);
  return <SettlementWorkspace key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name} canWrite={w.ctx.role!=='auditor'} today={today} ledger={ledger} batches={batches}/>;
}
