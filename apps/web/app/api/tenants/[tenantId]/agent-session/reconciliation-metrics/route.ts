import {commerceAgentSessionReconciliationMetrics} from '@commerce/agent-session';
import {apiContext,respond} from '../../../../../../lib/server';

type Params={params:Promise<{tenantId:string}>};

export async function GET(_req:Request,{params}:Params){
  return respond(async()=>commerceAgentSessionReconciliationMetrics(await apiContext((await params).tenantId)));
}
