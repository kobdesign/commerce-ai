import { createCommerceAgentSession,commerceAgentSessionConfiguration } from '@commerce/agent-session';
import { apiContext,jsonInput,respond } from '../../../../../lib/server';

type Params={params:Promise<{tenantId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>createCommerceAgentSession(await apiContext((await params).tenantId),await jsonInput(req,4096),commerceAgentSessionConfiguration(process.env)));
}
