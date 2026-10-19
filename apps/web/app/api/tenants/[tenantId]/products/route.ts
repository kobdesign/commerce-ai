import { createProductFamily } from '@commerce/domain';
import { apiContext,respond,mutationInput } from '../../../../../lib/server';
export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>createProductFamily(await apiContext((await params).tenantId),await mutationInput(req,131072)));
}
