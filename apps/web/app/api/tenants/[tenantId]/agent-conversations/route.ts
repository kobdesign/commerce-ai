import {z} from 'zod';
import {uuid} from '@commerce/contracts';
import {apiContext,mutationInput,respond} from '../../../../../lib/server';
import {agentConversationClient,agentConversationError} from '../../../../../lib/agent-conversation-server';

type Params={params:Promise<{tenantId:string}>};
const inputSchema=z.object({shopId:uuid}).strict();

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId}=await params;const ctx=await apiContext(tenantId);
    const input=inputSchema.parse(await mutationInput(req,4096));
    try{return await (await agentConversationClient(req,ctx)).create([input.shopId]);}
    catch(error){return agentConversationError(error);}
  });
}
