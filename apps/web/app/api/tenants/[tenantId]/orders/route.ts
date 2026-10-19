import { createCommerceOrder } from '@commerce/domain';
import { apiContext,mutationInput,respond } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function POST(req:Request,{params}:Params){
  return respond(async()=>createCommerceOrder(await apiContext((await params).tenantId),await mutationInput(req,65536)));
}
