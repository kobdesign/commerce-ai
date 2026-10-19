import { recordFinancialEvent } from '@commerce/finance';
import { apiContext,mutationInput,respond } from '../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>recordFinancialEvent(await apiContext((await params).tenantId),await mutationInput(req)));
}
