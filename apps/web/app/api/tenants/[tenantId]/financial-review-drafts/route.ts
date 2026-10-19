import { draftFinancialReviewTask } from '@commerce/ai';
import { apiContext,mutationInput,respond } from '../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>draftFinancialReviewTask(await apiContext((await params).tenantId),await mutationInput(req)));
}
