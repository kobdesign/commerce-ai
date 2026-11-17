import {commerceAgentSessionConfiguration,createCommerceAgentSessionEndIntent} from '@commerce/agent-session';
import {apiContext,jsonInput,respond} from '../../../../../../../../lib/server';

type Params={params:Promise<{tenantId:string;sessionId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,sessionId}=await params;
    return createCommerceAgentSessionEndIntent(
      await apiContext(tenantId),sessionId,await jsonInput(req,8192),commerceAgentSessionConfiguration(process.env),
    );
  });
}
