import { confirmFinancialReviewTask } from '@commerce/ai';
import { apiContext,jsonInput,respond } from '../../../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string;draftId:string}>}){
  const {tenantId,draftId}=await params,input=await jsonInput(req);
  return respond(async()=>confirmFinancialReviewTask(await apiContext(tenantId),{...(input as Record<string,unknown>),draftId}));
}
