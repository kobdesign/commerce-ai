import { randomUUID } from 'node:crypto';
import { shopExpenses } from '@commerce/finance';
import { workspace } from '../../../lib/server';
import { ExpenseWorkspace } from '../../../components/expense-workspace';

export const metadata={title:'ค่าใช้จ่ายร้าน · Commerce'};

export default async function ExpensesPage(){
  const w=await workspace();
  if(!w.shop||!['owner','finance','auditor'].includes(w.ctx.role))return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูค่าใช้จ่ายของร้านนี้</h1></div>;
  const ledger=await shopExpenses(w.ctx,w.shop.id);
  const today=new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10);
  return <ExpenseWorkspace key={`${w.org.id}:${w.shop.id}`} tenantId={w.org.id} shopId={w.shop.id} shopName={w.shop.name} canWrite={w.ctx.role!=='auditor'} today={today} initialReference={`EXP-${randomUUID()}`} ledger={ledger}/>;
}
