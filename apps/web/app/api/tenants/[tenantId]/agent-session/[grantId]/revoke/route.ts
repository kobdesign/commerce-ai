import {revokeCommerceAgentSessionGrant} from '@commerce/agent-session';
import {apiContext,mutationInput,respond} from '../../../../../../../lib/server';

type Params={params:Promise<{tenantId:string;grantId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,grantId}=await params;
    return revokeCommerceAgentSessionGrant(await apiContext(tenantId),grantId,await mutationInput(req,4096));
  });
}
