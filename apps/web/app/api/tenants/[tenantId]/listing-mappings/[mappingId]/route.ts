import { setChannelListingLifecycle } from '@commerce/domain';
import { apiContext,mutationInput,respond } from '../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;mappingId:string}>};
export async function PATCH(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,mappingId}=await params;
    return setChannelListingLifecycle(await apiContext(tenantId),mappingId,await mutationInput(req,8192));
  });
}
