import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppError,uuid } from '@commerce/contracts';
import { inventorySkuDistributionPolicy } from '@commerce/domain';
import { workspace } from '../../../../../lib/server';
import { SkuDistributionPolicyForm } from '../../../../../components/inventory-distribution-policy';

export const metadata={title:'ตั้งค่าช่องทางขาย · Commerce'};
export default async function SkuDistributionPage({params}:{params:Promise<{variantId:string}>}){
  const w=await workspace(),{variantId}=await params;if(!uuid.safeParse(variantId).success)notFound();
  try{return <SkuDistributionPolicyForm tenantId={w.org.id} initialOverview={await inventorySkuDistributionPolicy(w.ctx,variantId)}/>;}
  catch(error){if(error instanceof AppError&&[403,404].includes(error.status))return <div className="empty-state"><h1>{error.message}</h1><Link href="/inventory">กลับไปสต็อกกลาง</Link></div>;throw error;}
}
