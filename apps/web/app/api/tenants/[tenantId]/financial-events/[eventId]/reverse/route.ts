import { reverseFinancialEvent } from '@commerce/finance';
import { apiContext,jsonInput,respond } from '../../../../../../../lib/server';

type Params={params:Promise<{tenantId:string;eventId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{const {tenantId,eventId}=await params;return reverseFinancialEvent(await apiContext(tenantId),eventId,await jsonInput(req));});
}
