import { changeFinancialReviewTaskStatus } from '@commerce/ai';
import { apiContext,jsonInput,respond } from '../../../../../../lib/server';

export async function PATCH(req:Request,{params}:{params:Promise<{tenantId:string;taskId:string}>}){
  const {tenantId,taskId}=await params;
  return respond(async()=>changeFinancialReviewTaskStatus(await apiContext(tenantId),taskId,await jsonInput(req)));
}
