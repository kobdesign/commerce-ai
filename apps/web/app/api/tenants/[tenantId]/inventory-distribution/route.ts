import { AppError } from '@commerce/contracts';
import { inventoryCompanyDistributionPolicy,inventorySkuDistributionPolicy,updateInventoryCompanyDistributionPolicy,updateInventorySkuDistributionPolicy } from '@commerce/domain';
import { apiContext,mutationInput,respond } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};

export async function GET(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId}=await params,variantId=new URL(req.url).searchParams.get('variantId'),ctx=await apiContext(tenantId);
    return variantId?inventorySkuDistributionPolicy(ctx,variantId):inventoryCompanyDistributionPolicy(ctx);
  });
}

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const ctx=await apiContext((await params).tenantId),input=await mutationInput(req,32768);
    if(!input||typeof input!=='object'||Array.isArray(input)||!('scope' in input))throw new AppError(400,'INVALID_SCOPE','ระบุระดับนโยบายสต็อกไม่ถูกต้อง');
    const {scope,...payload}=input as Record<string,unknown>;
    if(scope==='company')return updateInventoryCompanyDistributionPolicy(ctx,payload);
    if(scope==='sku')return updateInventorySkuDistributionPolicy(ctx,payload);
    throw new AppError(400,'INVALID_SCOPE','ระบุระดับนโยบายสต็อกไม่ถูกต้อง');
  });
}
