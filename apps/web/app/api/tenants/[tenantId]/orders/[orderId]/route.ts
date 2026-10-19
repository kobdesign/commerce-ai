import { transitionCommerceOrder } from '@commerce/domain';
import { apiContext,mutationInput,respond } from '../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;orderId:string}>};
export async function PATCH(req:Request,{params}:Params){
  const p=await params;
  return respond(async()=>transitionCommerceOrder(await apiContext(p.tenantId),p.orderId,await mutationInput(req,16384)));
}
