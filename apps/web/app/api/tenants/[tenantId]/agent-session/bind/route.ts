import {bindCommerceAgentSession,commerceAgentSessionConfiguration} from '@commerce/agent-session';
import {apiContext,jsonInput,respond} from '../../../../../../lib/server';

type Params={params:Promise<{tenantId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>bindCommerceAgentSession(
    await apiContext((await params).tenantId),await jsonInput(req,8192),commerceAgentSessionConfiguration(process.env),
  ));
}
