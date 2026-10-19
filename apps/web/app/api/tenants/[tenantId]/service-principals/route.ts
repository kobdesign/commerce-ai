import { createServicePrincipal } from '@commerce/integrations';
import { apiContext,mutationInput,respond } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function POST(req:Request,{params}:Params){
  return respond(async()=>createServicePrincipal(await apiContext((await params).tenantId),await mutationInput(req,16384)));
}
