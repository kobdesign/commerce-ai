import { getProductForEdit,updateProduct } from '@commerce/domain';
import { apiContext,respond,jsonInput } from '../../../../../../lib/server';
type Params={params:Promise<{tenantId:string;productId:string}>};
export async function GET(req:Request,{params}:Params){
  return respond(async()=>{const p=await params;return getProductForEdit(await apiContext(p.tenantId),new URL(req.url).searchParams.get('shopId')??'',p.productId);});
}
export async function PATCH(req:Request,{params}:Params){
  return respond(async()=>{const p=await params;return updateProduct(await apiContext(p.tenantId),p.productId,await jsonInput(req,131072));});
}
