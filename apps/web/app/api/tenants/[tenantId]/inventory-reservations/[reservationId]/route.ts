import { transitionInventoryReservation } from '@commerce/domain';
import { apiContext,mutationInput,respond } from '../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;reservationId:string}>};
export async function PATCH(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId,reservationId}=await params;
    return transitionInventoryReservation(await apiContext(tenantId),reservationId,await mutationInput(req,16384));
  });
}
