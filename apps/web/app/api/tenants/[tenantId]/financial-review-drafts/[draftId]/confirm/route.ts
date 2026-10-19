import { confirmFinancialReviewTask } from '@commerce/ai';
import { apiContext,mutationInput,respond } from '../../../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string;draftId:string}>}){
  const {tenantId,draftId}=await params,input=await mutationInput(req);
  return respond(async()=>confirmFinancialReviewTask(await apiContext(tenantId),{...(input as Record<string,unknown>),draftId}));
}
