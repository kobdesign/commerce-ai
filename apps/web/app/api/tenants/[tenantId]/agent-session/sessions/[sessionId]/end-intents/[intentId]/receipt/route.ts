import {recordCommerceAgentSessionEveReceipt} from '@commerce/agent-session';
import {apiContext,jsonInput,respond} from '../../../../../../../../../../lib/server';

type Params={params:Promise<{tenantId:string;sessionId:string;intentId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,intentId}=await params;
    return recordCommerceAgentSessionEveReceipt(await apiContext(tenantId),intentId,await jsonInput(req,4096));
  });
}
