import {revokeCommerceAgentSession} from '@commerce/agent-session';
import {apiContext,mutationInput,respond} from '../../../../../../../../lib/server';

type Params={params:Promise<{tenantId:string;sessionId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,sessionId}=await params;
    return revokeCommerceAgentSession(await apiContext(tenantId),sessionId,await mutationInput(req,4096));
  });
}
