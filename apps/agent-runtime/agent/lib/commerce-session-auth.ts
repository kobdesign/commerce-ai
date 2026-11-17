import { commerceSessionTokenPrefix,verifyCommerceSessionGrant,type CommerceSessionEnvironment } from '@commerce/agent-session-auth';
import { ForbiddenError,extractBearerToken,type AuthFn } from 'eve/channels/auth';

type Environment=Readonly<Record<string,string|undefined>>;

function configuration(env:Environment){
  const environment:CommerceSessionEnvironment=env.COMMERCE_AGENT_ENV==='local'?'development':'staging';
  const keyId=env.COMMERCE_SESSION_KEY_ID?.trim(),publicKey=env.COMMERCE_SESSION_PUBLIC_KEY?.trim();
  if(!keyId||!publicKey)return null;
  return {environment,keyId,publicKey};
}

/** Authenticates only Commerce grants. Other bearer formats continue to the next Eve authenticator. */
export function commerceSessionAuth(env:Environment=process.env):AuthFn<Request>{
  return request=>{
    const token=extractBearerToken(request.headers.get('authorization'));
    if(!token?.startsWith(commerceSessionTokenPrefix))return null;
    const configured=configuration(env);
    if(!configured)throw new ForbiddenError({code:'commerce_session_not_configured',message:'Commerce session verification is not configured.'});
    try{
      const claims=verifyCommerceSessionGrant(token,configured);
      const path=new URL(request.url).pathname.replace(/\/+$/,'');
      if(request.method!=='POST'||claims.capability!=='create'||path!=='/eve/v1/session'){
        throw new Error('Commerce grant cannot access an existing Eve session.');
      }
      return {
        authenticator:'jwt-ecdsa',
        issuer:claims.issuer,
        principalId:claims.subject,
        principalType:'user',
        subject:claims.subject,
        attributes:{tenantId:claims.tenantId,shopIds:claims.shopIds,role:claims.role,grantId:claims.grantId,capability:claims.capability},
      };
    }catch{
      throw new ForbiddenError({code:'invalid_commerce_session',message:'Commerce session grant is invalid or expired.'});
    }
  };
}
