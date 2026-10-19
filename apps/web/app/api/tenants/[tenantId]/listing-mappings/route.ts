import { channelListingMappings,createChannelListingMapping } from '@commerce/domain';
import { apiContext,mutationInput,respond } from '../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
export async function GET(req:Request,{params}:Params){
  return respond(async()=>{
    const {tenantId}=await params,search=new URL(req.url).searchParams;
    return channelListingMappings(await apiContext(tenantId),search.get('shopId')??'',search.get('productId')??'');
  });
}
export async function POST(req:Request,{params}:Params){
  return respond(async()=>createChannelListingMapping(await apiContext((await params).tenantId),await mutationInput(req,16384)));
}
