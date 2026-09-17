import { reverseSettlementLine } from '@commerce/finance';
import { apiContext,jsonInput,respond } from '../../../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string;lineId:string}>}){
  const {tenantId,lineId}=await params;
  return respond(async()=>reverseSettlementLine(await apiContext(tenantId),lineId,await jsonInput(req)));
}
