import {z} from 'zod';
import {apiContext,mutationInput,respond} from '../../../../../../../lib/server';
import {agentConversationClient,agentConversationError} from '../../../../../../../lib/agent-conversation-server';

type Params={params:Promise<{tenantId:string;sessionId:string}>};
const inputSchema=z.object({message:z.string().trim().min(1).max(2_000),streamIndex:z.number().int().min(0).max(1_000_000)}).strict();

export const maxDuration=60;
export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,sessionId}=await params;const ctx=await apiContext(tenantId);
    const input=inputSchema.parse(await mutationInput(req,8_192));
    try{return await (await agentConversationClient(req,ctx)).send(sessionId,input.message,input.streamIndex);}
    catch(error){return agentConversationError(error);}
  });
}
