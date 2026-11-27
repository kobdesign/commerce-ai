import {z} from 'zod';
import {apiContext,mutationInput,respond} from '../../../../../../../lib/server';
import {agentConversationClient,agentConversationError} from '../../../../../../../lib/agent-conversation-server';

type Params={params:Promise<{tenantId:string;sessionId:string}>};
const inputSchema=z.object({reason:z.string().trim().min(10).max(500)}).strict();

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,sessionId}=await params;await apiContext(tenantId);
    const input=inputSchema.parse(await mutationInput(req,4_096));
    try{return await agentConversationClient(req,tenantId).end(sessionId,input.reason);}
    catch(error){return agentConversationError(error);}
  });
}
