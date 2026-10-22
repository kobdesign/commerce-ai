import { NextResponse } from 'next/server';
import { exchangeTikTokSellerCode,saveTikTokSellerAuthorization,tiktokShopConfiguration,verifyTikTokAuthorizationState } from '@commerce/connectors';
import { resolveContext } from '@commerce/db';
import { applicationOrigin } from '../../../../../lib/environment';
import { user } from '../../../../../lib/server';

function destination(status:string){
  const origin=applicationOrigin();if(!origin)throw new Error('APP_ORIGIN_REQUIRED');
  const url=new URL('/integrations/marketplaces',origin);url.searchParams.set('tiktok',status);return url;
}

export async function GET(req:Request){
  const configuration=tiktokShopConfiguration(),url=new URL(req.url),stateValue=url.searchParams.get('state'),code=url.searchParams.get('code');
  try{
    if(!configuration.ready||!configuration.oauthStateSecret)throw new Error('TIKTOK_CONFIGURATION_INCOMPLETE');
    if(!stateValue||!code)throw new Error('TIKTOK_CALLBACK_MISSING');
    const state=verifyTikTokAuthorizationState(stateValue,configuration.oauthStateSecret),session=await user();
    if(!session||session.id!==state.userId)throw new Error('TIKTOK_CALLBACK_SESSION_MISMATCH');
    const ctx=await resolveContext(session.id,state.tenantId),token=await exchangeTikTokSellerCode(configuration,code);
    await saveTikTokSellerAuthorization(ctx,state.shopId,token,configuration);
    return NextResponse.redirect(destination('authorized'));
  }catch(error){
    console.error('TikTok authorization callback failed:',error instanceof Error?error.message.split(':')[0]:'Unknown');
    return NextResponse.redirect(destination('failed'));
  }
}
