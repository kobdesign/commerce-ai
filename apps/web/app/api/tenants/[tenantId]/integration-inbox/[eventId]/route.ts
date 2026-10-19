import { transitionIntegrationInboxEvent } from '@commerce/integrations';
import { apiContext,mutationInput,respond } from '../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;eventId:string}>};
export async function PATCH(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,eventId}=await params;
    return transitionIntegrationInboxEvent(await apiContext(tenantId),eventId,await mutationInput(req,8192));
  });
}
