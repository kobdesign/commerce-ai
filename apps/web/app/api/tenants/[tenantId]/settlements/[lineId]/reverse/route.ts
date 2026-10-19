import { reverseSettlementLine } from '@commerce/finance';
import { apiContext,mutationInput,respond } from '../../../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string;lineId:string}>}){
  const {tenantId,lineId}=await params;
  return respond(async()=>reverseSettlementLine(await apiContext(tenantId),lineId,await mutationInput(req)));
}
