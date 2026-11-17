import {commerceAgentSessionGrantMetrics} from '@commerce/agent-session';
import {apiContext,respond} from '../../../../../../lib/server';

type Params={params:Promise<{tenantId:string}>};

export async function GET(req:Request,{params}:Params){
  return respond(async()=>{
    const raw=new URL(req.url).searchParams.get('windowMinutes')??'60';
    if(!/^\d{1,5}$/.test(raw))return commerceAgentSessionGrantMetrics(await apiContext((await params).tenantId),Number.NaN);
    return commerceAgentSessionGrantMetrics(await apiContext((await params).tenantId),Number(raw));
  });
}
