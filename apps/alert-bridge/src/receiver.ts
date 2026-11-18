import { AlertVerificationError,verifySignedAlert,type AlertReplayStore } from '@commerce/operations';
import type { AlertBridgeConfig } from './config';

type ReceiverDependencies={config:AlertBridgeConfig;replayStore:AlertReplayStore;now?:()=>Date};
const statusByCode:Record<AlertVerificationError['code'],number>={INVALID_SECRET:503,BODY_TOO_LARGE:413,MISSING_HEADER:400,
  INVALID_TIMESTAMP:400,STALE_REQUEST:401,FUTURE_REQUEST:401,INVALID_SIGNATURE:401,INVALID_JSON:400,INVALID_ALERT:400,
  HEADER_MISMATCH:400,SCOPE_MISMATCH:403,REPLAYED_EVENT:409};
function json(status:number,body:Record<string,unknown>){return Response.json(body,{status,headers:{'cache-control':'no-store'}});}

export async function receiveSignedAlert(request:Request,dependencies:ReceiverDependencies):Promise<Response>{
  const declaredLength=request.headers.get('content-length');
  if(declaredLength!==null){
    const bytes=Number(declaredLength);
    if(!Number.isSafeInteger(bytes)||bytes<0)return json(400,{status:'rejected',code:'INVALID_CONTENT_LENGTH'});
    if(bytes>dependencies.config.maxBodyBytes)return json(413,{status:'rejected',code:'BODY_TOO_LARGE'});
  }
  let rawBody:string;
  try{rawBody=await request.text();}catch{return json(400,{status:'rejected',code:'INVALID_BODY'});}
  try{
    const alert=await verifySignedAlert({rawBody,headers:request.headers,secret:dependencies.config.signingSecret,replayStore:dependencies.replayStore,
      expectedEnvironment:dependencies.config.environment,allowedSources:dependencies.config.allowedSources,now:dependencies.now?.(),
      maxBodyBytes:dependencies.config.maxBodyBytes,maxAgeMs:dependencies.config.maxAgeMs,maxFutureSkewMs:dependencies.config.maxFutureSkewMs});
    return json(202,{status:'verified',eventId:alert.eventId,source:alert.source,environment:alert.environment,alertStatus:alert.status,
      observedAt:alert.observedAt,tenantId:alert.tenantId,contentCaptured:false,incidentDelivery:'pending-provider-adapter'});
  }catch(error){
    if(error instanceof AlertVerificationError)return json(statusByCode[error.code],{status:'rejected',code:error.code});
    return json(503,{status:'unavailable',code:'REPLAY_STORE_UNAVAILABLE'});
  }
}
