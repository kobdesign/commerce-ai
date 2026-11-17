import {
  commerceCleanupTokenPrefix,
  verifyCommerceCleanupGrant,
  type CommerceSessionEnvironment,
} from '@commerce/agent-session-auth';
import {ForbiddenError,extractBearerToken,type AuthFn} from 'eve/channels/auth';

type Environment=Readonly<Record<string,string|undefined>>;

function configuration(env:Environment){
  const environment:CommerceSessionEnvironment=env.COMMERCE_AGENT_ENV==='local'?'development':'staging';
  let publicKeys:Record<string,string>;
  try{
    const parsed=JSON.parse(env.COMMERCE_CLEANUP_PUBLIC_KEYS_JSON?.trim()??'{}') as unknown;
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
    publicKeys=Object.fromEntries(Object.entries(parsed).filter((entry):entry is [string,string]=>
      /^[A-Za-z0-9._-]{1,80}$/.test(entry[0])&&typeof entry[1]==='string'&&/^[A-Za-z0-9_-]{40,}$/.test(entry[1]),
    ));
  }catch{return null;}
  if(Object.keys(publicKeys).length<1||Object.keys(publicKeys).length>3)return null;
  const revokedKeyIds=(env.COMMERCE_CLEANUP_REVOKED_KEY_IDS??'').split(',').map(value=>value.trim()).filter(Boolean);
  return {environment,publicKeys,revokedKeyIds};
}

/** Authorizes only an exact session end control from the Commerce lifecycle worker. */
export function commerceCleanupAuth(env:Environment=process.env,now:()=>Date=()=>new Date()):AuthFn<Request>{
  return request=>{
    const token=extractBearerToken(request.headers.get('authorization'));
    if(!token?.startsWith(commerceCleanupTokenPrefix))return null;
    const configured=configuration(env);
    if(!configured)throw new ForbiddenError({code:'cleanup_identity_not_configured',message:'Commerce cleanup identity is not configured.'});
    try{
      const claims=verifyCommerceCleanupGrant(token,{...configured,now:now()});
      const path=new URL(request.url).pathname.replace(/\/+$/,'');
      const expected=`/eve/v1/session/${encodeURIComponent(claims.sessionId)}/end`;
      if(request.method!=='POST'||path!==expected)throw new Error('cleanup route mismatch');
      return {
        authenticator:'commerce-cleanup-eddsa',issuer:claims.issuer,
        principalId:claims.subject,principalType:'service',subject:claims.subject,
        attributes:{tenantId:claims.tenantId,sessionId:claims.sessionId,intentId:claims.intentId,capability:claims.capability},
      };
    }catch{
      throw new ForbiddenError({code:'invalid_cleanup_identity',message:'Commerce cleanup identity is invalid, expired, revoked or outside the exact session scope.'});
    }
  };
}
