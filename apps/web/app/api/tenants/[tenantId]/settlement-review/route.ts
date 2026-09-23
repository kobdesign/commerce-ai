import { executeSettlementReview,settlementReviewRuns } from '@commerce/ai';
import { apiContext,jsonInput,respond } from '../../../../../lib/server';

export const maxDuration=60;
type Params={params:Promise<{tenantId:string}>};

export async function GET(req:Request,{params}:Params){
  return respond(async()=>{
    const shopId=new URL(req.url).searchParams.get('shopId');
    if(!shopId)return [];
    return settlementReviewRuns(await apiContext((await params).tenantId),shopId);
  });
}

export async function POST(req:Request,{params}:Params){
  return respond(async()=>executeSettlementReview(await apiContext((await params).tenantId),await jsonInput(req)));
}
