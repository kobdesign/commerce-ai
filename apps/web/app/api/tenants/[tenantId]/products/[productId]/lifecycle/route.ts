import { setProductLifecycle } from '@commerce/domain';
import { apiContext,respond,mutationInput } from '../../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;productId:string}>};
export async function PATCH(req:Request,{params}:Params){
  return respond(async()=>{const p=await params;return setProductLifecycle(await apiContext(p.tenantId),p.productId,await mutationInput(req,4096));});
}
