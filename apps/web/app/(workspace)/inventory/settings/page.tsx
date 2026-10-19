import Link from 'next/link';
import { AppError } from '@commerce/contracts';
import { inventoryCompanyDistributionPolicy } from '@commerce/domain';
import { workspace } from '../../../../lib/server';
import { CompanyDistributionPolicyForm } from '../../../../components/inventory-distribution-policy';

export const metadata={title:'นโยบายกระจายสต็อก · Commerce'};
export default async function InventoryDistributionSettings(){
  const w=await workspace();
  try{return <CompanyDistributionPolicyForm tenantId={w.org.id} initialPolicy={await inventoryCompanyDistributionPolicy(w.ctx)}/>;}
  catch(error){if(error instanceof AppError&&error.status===403)return <div className="empty-state"><h1>คุณไม่มีสิทธิ์ดูนโยบายสต็อก</h1><Link href="/inventory">กลับไปสต็อกกลาง</Link></div>;throw error;}
}
