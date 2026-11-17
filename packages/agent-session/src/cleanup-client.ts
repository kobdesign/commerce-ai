import {issueCommerceCleanupGrant,type CommerceSessionEnvironment} from '@commerce/agent-session-auth';
import {z} from 'zod';

const deliverySchema=z.object({
  sessionId:z.string().min(8).max(200),
  deliveryId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/),
}).passthrough();

export type CommerceCleanupDispatch={tenantId:string;intentId:string;sessionId:string};
export type CommerceCleanupDispatcherConfiguration={
  eveBaseUrl:string;environment:CommerceSessionEnvironment;keyId:string;privateKey:string;now?:Date;
};

export class CommerceCleanupDispatchError extends Error{
  constructor(public readonly code:'EVE_CLEANUP_UNAVAILABLE'|'EVE_CLEANUP_REJECTED'|'EVE_CLEANUP_INVALID_RECEIPT',public readonly status:number|null){
    super(code);this.name='CommerceCleanupDispatchError';
  }
}

export function commerceCleanupDispatcherConfiguration(env:Readonly<Record<string,string|undefined>>):CommerceCleanupDispatcherConfiguration|null{
  const enabled=env.COMMERCE_AGENT_CLEANUP_ENABLED?.trim()||'false';
  if(enabled==='false')return null;
  if(enabled!=='true')throw new Error('COMMERCE_AGENT_CLEANUP_ENABLED must be true or false.');
  const environment=env.APP_MODE==='local-demo'?'development':env.APP_MODE==='staging-demo'?'staging':null;
  const eveBaseUrl=env.COMMERCE_AGENT_EVE_URL?.trim(),keyId=env.COMMERCE_AGENT_CLEANUP_KEY_ID?.trim(),privateKey=env.COMMERCE_AGENT_CLEANUP_PRIVATE_KEY?.trim();
  if(!environment||!eveBaseUrl||!keyId||!privateKey)throw new Error('Commerce cleanup dispatcher configuration is incomplete.');
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(keyId)||!/^[A-Za-z0-9_-]{40,}$/.test(privateKey))throw new Error('Commerce cleanup signing configuration is invalid.');
  baseUrl(eveBaseUrl);
  return {eveBaseUrl,environment,keyId,privateKey};
}

function baseUrl(value:string){
  const parsed=new URL(value),local=parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname);
  if(parsed.protocol!=='https:'&&!local)throw new Error('Eve cleanup URL must use HTTPS outside local development.');
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Eve cleanup URL must not contain credentials, query or fragment.');
  return parsed.toString().replace(/\/$/,'');
}

export async function dispatchCommerceSessionCleanup(
  input:CommerceCleanupDispatch,configuration:CommerceCleanupDispatcherConfiguration,fetchImpl:typeof fetch=fetch,
){
  const base=baseUrl(configuration.eveBaseUrl);
  const issued=issueCommerceCleanupGrant({...input,environment:configuration.environment,ttlSeconds:60},{
    keyId:configuration.keyId,privateKey:configuration.privateKey,now:configuration.now,
  });
  let response:Response;
  try{
    response=await fetchImpl(`${base}/eve/v1/session/${encodeURIComponent(input.sessionId)}/end`,{
      method:'POST',headers:{authorization:`Bearer ${issued.token}`,'content-type':'application/json'},
      body:JSON.stringify({reason:'Commerce Core emergency revocation cleanup.'}),redirect:'error',signal:AbortSignal.timeout(5_000),
    });
  }catch{throw new CommerceCleanupDispatchError('EVE_CLEANUP_UNAVAILABLE',null);}
  if(response.status!==202)throw new CommerceCleanupDispatchError('EVE_CLEANUP_REJECTED',response.status);
  const parsed=deliverySchema.safeParse(await response.json().catch(()=>null));
  if(!parsed.success||parsed.data.sessionId!==input.sessionId){
    throw new CommerceCleanupDispatchError('EVE_CLEANUP_INVALID_RECEIPT',response.status);
  }
  return {intentId:input.intentId,sessionId:input.sessionId,deliveryId:parsed.data.deliveryId};
}
