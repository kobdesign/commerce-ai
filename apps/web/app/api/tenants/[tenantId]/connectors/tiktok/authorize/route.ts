import { assertTikTokAuthorizationTarget,createTikTokAuthorizationState,tiktokSellerAuthorizationUrl,tiktokShopConfiguration } from '@commerce/connectors';
import { z } from 'zod';
import { apiContext,mutationInput,respond } from '../../../../../../../lib/server';
type Params={params:Promise<{tenantId:string}>};
const inputSchema=z.object({shopId:z.string().uuid()}).strict();
export async function POST(req:Request,{params}:Params){
  return respond(async()=>{
    const ctx=await apiContext((await params).tenantId),input=inputSchema.parse(await mutationInput(req,4096)),configuration=tiktokShopConfiguration();
    if(!configuration.ready||!configuration.oauthStateSecret)throw new Error(`TIKTOK_CONFIGURATION_INCOMPLETE:${configuration.blockers.join(',')}`);
    await assertTikTokAuthorizationTarget(ctx,input.shopId);
    const state=createTikTokAuthorizationState({tenantId:ctx.tenantId,shopId:input.shopId,userId:ctx.userId},configuration.oauthStateSecret);
    return {authorizationUrl:tiktokSellerAuthorizationUrl(configuration,state)};
  });
}
