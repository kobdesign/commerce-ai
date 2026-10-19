import { revokeServicePrincipal,rotateServicePrincipalCredential } from '@commerce/integrations';
import { apiContext,mutationInput,respond } from '../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;principalId:string}>};
export async function PATCH(req:Request,{params}:Params){
  return respond(async()=>{const {tenantId,principalId}=await params;return revokeServicePrincipal(await apiContext(tenantId),principalId,await mutationInput(req,8192));});
}
export async function POST(req:Request,{params}:Params){
  return respond(async()=>{const {tenantId,principalId}=await params;return rotateServicePrincipalCredential(await apiContext(tenantId),principalId,await mutationInput(req,8192));});
}
