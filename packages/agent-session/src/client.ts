export type CommerceEveSessionClientConfig={
  coreBaseUrl:string;
  eveBaseUrl:string;
  tenantId:string;
  vercelOidcToken?:string;
  fetch?:typeof fetch;
  origin?:string;
  idempotencyKey?:()=>string;
};

export type CommerceEveSession={sessionId:string;expiresAt:string};
export type CommerceEveTurnResult={
  sessionId:string;
  deliveryId:string;
  status:'completed'|'awaiting_input';
  answer:string;
  delegatedAgents:string[];
  toolNames:string[];
  usage:{inputTokens:number;outputTokens:number;costUsd:number|null};
  nextStreamIndex:number;
};
type CoreGrant={engine:'eve';token:string;capability:'create'|'continue';sessionId:string|null;expiresAt:string};

export class CommerceEveLifecycleError extends Error{
  constructor(
    public readonly code:'CORE_GRANT_FAILED'|'EVE_CREATE_FAILED'|'CORE_BIND_FAILED'|'CORE_ABANDON_FAILED'
      |'EVE_MESSAGE_FAILED'|'EVE_STREAM_FAILED'|'EVE_RESPONSE_INVALID'
      |'CORE_END_INTENT_FAILED'|'EVE_END_FAILED'|'CORE_END_RECEIPT_FAILED'|'CORE_END_RECONCILIATION_PENDING',
    public readonly status:number|null,
  ){super(code);this.name='CommerceEveLifecycleError';}
}

function baseUrl(value:string,label:string){
  const parsed=new URL(value);
  const local=parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname);
  if(parsed.protocol!=='https:'&&!local)throw new Error(`${label} must use HTTPS outside local development`);
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error(`${label} must not contain credentials, query or fragment`);
  return parsed.toString().replace(/\/$/,'');
}
function validTenant(value:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error('tenantId must be a UUID');
  return value;
}
function object(value:unknown):Record<string,unknown>|null{return typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;}
async function json(response:Response){return response.json().catch(()=>null) as Promise<unknown>;}
const sessionIdPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const deliveryIdPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

function string(value:unknown){return typeof value==='string'?value:null;}
function number(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;}
function eventData(value:unknown){const event=object(value);return event?{event,data:object(event.data),scope:object(event.scope)}:null;}

async function readTurnStream(response:Response,input:{sessionId:string;deliveryId:string;startIndex:number;signal:AbortSignal}):Promise<CommerceEveTurnResult>{
  if(!response.ok||!response.body)throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',response.status);
  const reader=response.body.getReader(),decoder=new TextDecoder();
  const replyParts=new Map<string,string[]>(),delegatedAgents=new Set<string>(),toolNames=new Set<string>();
  let buffered='',bytes=0,records=0,storedLines=0,nextStreamIndex=input.startIndex,targetTurnId:string|null=null;
  let deliveryOutcome:string|null=null,inputTokens=0,outputTokens=0,costUsd=0,costKnown=false;
  const processLine=(line:string)=>{
    if(!line.trim())return;
    records+=1;
    if(records>1_000||line.length>65_536)throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',null);
    let record:unknown;
    try{record=JSON.parse(line);}catch{throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',null);}
    const envelope=object(record);
    if(!Array.isArray(envelope?.facts))return;
    storedLines+=1;nextStreamIndex=input.startIndex+storedLines;
    const facts=envelope.facts;
    for(const raw of facts){
      const parsed=eventData(raw);if(!parsed)continue;
      const type=string(parsed.event.type),turnId=string(parsed.scope?.turnId);
      if(type==='content.completed'&&turnId&&parsed.data?.phase==='reply'&&parsed.data.kind==='text'){
        const value=string(parsed.data.value);if(value)replyParts.set(turnId,[...(replyParts.get(turnId)??[]),value]);
      }else if(type==='child.opened'){
        const name=string(parsed.data?.name);if(name)delegatedAgents.add(name);
      }else if(type==='call.requested'){
        const capability=object(parsed.data?.capability),name=string(capability?.name);if(name)toolNames.add(name);
      }else if(type==='usage.recorded'){
        const usage=object(parsed.data?.usage);if(usage){
          inputTokens+=number(usage.inputTokens);outputTokens+=number(usage.outputTokens);
          if(typeof usage.costUsd==='number'&&Number.isFinite(usage.costUsd)&&usage.costUsd>=0){costUsd+=usage.costUsd;costKnown=true;}
        }
      }else if(type==='delivery.settled'&&parsed.data?.deliveryId===input.deliveryId){
        targetTurnId=string(parsed.data.turnId);deliveryOutcome=string(parsed.data.outcome);
      }
    }
  };
  try{
    while(deliveryOutcome===null){
      if(input.signal.aborted)throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',null);
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;if(bytes>524_288)throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',null);
      buffered+=decoder.decode(value,{stream:true});
      let newline=buffered.indexOf('\n');
      while(newline>=0){processLine(buffered.slice(0,newline));buffered=buffered.slice(newline+1);if(deliveryOutcome!==null)break;newline=buffered.indexOf('\n');}
    }
    if(deliveryOutcome===null&&buffered.trim())processLine(buffered);
  }catch(error){
    if(error instanceof CommerceEveLifecycleError)throw error;
    throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',null);
  }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  if(!deliveryOutcome||!['handled','awaiting-input'].includes(deliveryOutcome))throw new CommerceEveLifecycleError('EVE_RESPONSE_INVALID',null);
  const answer=targetTurnId?(replyParts.get(targetTurnId)??[]).join('\n\n').trim():'';
  if(deliveryOutcome==='handled'&&!answer)throw new CommerceEveLifecycleError('EVE_RESPONSE_INVALID',null);
  return {sessionId:input.sessionId,deliveryId:input.deliveryId,status:deliveryOutcome==='awaiting-input'?'awaiting_input':'completed',answer,
    delegatedAgents:[...delegatedAgents],toolNames:[...toolNames],usage:{inputTokens,outputTokens,costUsd:costKnown?costUsd:null},nextStreamIndex};
}

/**
 * Coordinates the Core/Eve lifecycle without sending a model message.
 * Core owns authorization state; Eve owns the durable conversation.
 */
export function createCommerceEveSessionClient(config:CommerceEveSessionClientConfig){
  const core=baseUrl(config.coreBaseUrl,'Commerce Core URL');
  const eve=baseUrl(config.eveBaseUrl,'Eve URL');
  const tenantId=validTenant(config.tenantId);
  const fetchImpl=config.fetch??fetch;
  const idempotencyKey=config.idempotencyKey??(()=>globalThis.crypto.randomUUID());
  const vercelOidcToken=config.vercelOidcToken?.trim();
  if(vercelOidcToken&&(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(vercelOidcToken)||vercelOidcToken.length>8192)){
    throw new Error('Vercel trusted OIDC token is invalid');
  }
  const eveHeaders=():Record<string,string>=>vercelOidcToken?{'x-vercel-trusted-oidc-idp-token':vercelOidcToken}:{};
  const coreHeaders=()=>({'content-type':'application/json',...(config.origin?{origin:config.origin}:{})});
  const corePath=(suffix='')=>`${core}/api/tenants/${encodeURIComponent(tenantId)}/agent-session${suffix}`;

  async function corePost(path:string,body:unknown,code:CommerceEveLifecycleError['code']){
    let response:Response;
    try{response=await fetchImpl(path,{method:'POST',credentials:'include',headers:coreHeaders(),body:JSON.stringify(body),redirect:'error'});}
    catch{throw new CommerceEveLifecycleError(code,null);}
    if(!response.ok)throw new CommerceEveLifecycleError(code,response.status);
    return json(response);
  }
  async function retryableCorePost(path:string,body:unknown,code:CommerceEveLifecycleError['code']){
    try{return await corePost(path,body,code);}
    catch(error){
      if(!(error instanceof CommerceEveLifecycleError)
        ||(error.status!==null&&error.status<500&&error.status!==429))throw error;
      return corePost(path,body,code);
    }
  }
  async function grant(input:{shopIds:string[]}|{sessionId:string}):Promise<CoreGrant>{
    const payload=object(await corePost(corePath(),input,'CORE_GRANT_FAILED'));
    if(!payload||payload.engine!=='eve'||typeof payload.token!=='string'||typeof payload.expiresAt!=='string'
      ||(payload.capability!=='create'&&payload.capability!=='continue')
      ||(payload.sessionId!==null&&typeof payload.sessionId!=='string')){
      throw new CommerceEveLifecycleError('CORE_GRANT_FAILED',null);
    }
    return payload as unknown as CoreGrant;
  }
  async function bind(sessionId:string,grantToken:string){
    const payload=object(await corePost(corePath('/bind'),{sessionId,grantToken,confirmed:true},'CORE_BIND_FAILED'));
    if(!payload||payload.sessionId!==sessionId||payload.status!=='active'||typeof payload.expiresAt!=='string'){
      throw new CommerceEveLifecycleError('CORE_BIND_FAILED',null);
    }
    return {sessionId,expiresAt:payload.expiresAt};
  }
  async function abandon(sessionId:string,grantToken:string){
    return corePost(corePath('/abandon'),{
      sessionId,grantToken,confirmed:true,reason:'Eve session creation completed but the Core bind handshake failed.',
    },'CORE_ABANDON_FAILED');
  }

  return {
    async create(shopIds:string[]):Promise<CommerceEveSession>{
      const issued=await grant({shopIds});
      if(issued.capability!=='create'||issued.sessionId!==null)throw new CommerceEveLifecycleError('CORE_GRANT_FAILED',null);
      let accepted:Response;
      try{accepted=await fetchImpl(`${eve}/eve/v1/session`,{method:'POST',headers:{...eveHeaders(),authorization:`Bearer ${issued.token}`},redirect:'error'});}
      catch{throw new CommerceEveLifecycleError('EVE_CREATE_FAILED',null);}
      const acceptedBody=object(await json(accepted));
      const sessionId=acceptedBody?.sessionId;
      if(accepted.status!==202||typeof sessionId!=='string')throw new CommerceEveLifecycleError('EVE_CREATE_FAILED',accepted.status);
      let bound:CommerceEveSession;
      try{
        try{bound=await bind(sessionId,issued.token);}
        catch(error){
          if(!(error instanceof CommerceEveLifecycleError)||error.status===null||(error.status<500&&error.status!==429))throw error;
          bound=await bind(sessionId,issued.token);
        }
      }catch(error){
        try{await abandon(sessionId,issued.token);}
        catch{throw new CommerceEveLifecycleError('CORE_ABANDON_FAILED',null);}
        if(error instanceof CommerceEveLifecycleError)throw error;
        throw new CommerceEveLifecycleError('CORE_BIND_FAILED',null);
      }
      return bound;
    },

    async send(sessionId:string,message:string,startIndex=0):Promise<CommerceEveTurnResult>{
      const normalizedMessage=message.trim();
      if(!sessionIdPattern.test(sessionId))throw new Error('sessionId is invalid');
      if(normalizedMessage.length<1||normalizedMessage.length>2_000)throw new Error('Message must contain 1 to 2,000 characters');
      if(!Number.isSafeInteger(startIndex)||startIndex<0)throw new Error('startIndex must be a non-negative integer');
      const messageGrant=await grant({sessionId});
      if(messageGrant.capability!=='continue'||messageGrant.sessionId!==sessionId)throw new CommerceEveLifecycleError('CORE_GRANT_FAILED',null);
      let accepted:Response;
      try{accepted=await fetchImpl(`${eve}/eve/v1/session/${encodeURIComponent(sessionId)}`,{
        method:'POST',headers:{...eveHeaders(),authorization:`Bearer ${messageGrant.token}`,'content-type':'application/json'},
        body:JSON.stringify({message:normalizedMessage,idempotencyKey:idempotencyKey()}),redirect:'error',
      });}catch{throw new CommerceEveLifecycleError('EVE_MESSAGE_FAILED',null);}
      const acceptedBody=object(await json(accepted)),deliveryId=acceptedBody?.deliveryId;
      if(accepted.status!==202||typeof deliveryId!=='string'||!deliveryIdPattern.test(deliveryId)){
        throw new CommerceEveLifecycleError('EVE_MESSAGE_FAILED',accepted.status);
      }
      const streamGrant=await grant({sessionId});
      if(streamGrant.capability!=='continue'||streamGrant.sessionId!==sessionId)throw new CommerceEveLifecycleError('CORE_GRANT_FAILED',null);
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),55_000);
      try{
        let stream:Response;
        try{stream=await fetchImpl(`${eve}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=${startIndex}`,{
          method:'GET',headers:{...eveHeaders(),authorization:`Bearer ${streamGrant.token}`,accept:'application/x-ndjson'},redirect:'error',signal:controller.signal,
        });}catch{throw new CommerceEveLifecycleError('EVE_STREAM_FAILED',null);}
        return await readTurnStream(stream,{sessionId,deliveryId,startIndex,signal:controller.signal});
      }finally{clearTimeout(timeout);}
    },

    async end(sessionId:string,reason:string):Promise<{sessionId:string;status:'ended'}>{
      const normalizedReason=reason.trim();
      if(normalizedReason.length<10||normalizedReason.length>500)throw new Error('End reason must contain 10 to 500 characters');
      const issued=await grant({sessionId});
      if(issued.capability!=='continue'||issued.sessionId!==sessionId)throw new CommerceEveLifecycleError('CORE_GRANT_FAILED',null);
      const intentPayload={grantToken:issued.token,idempotencyKey:idempotencyKey(),reason:normalizedReason,confirmed:true};
      const intentBody=object(await retryableCorePost(
        corePath(`/sessions/${encodeURIComponent(sessionId)}/end-intents`),intentPayload,'CORE_END_INTENT_FAILED',
      ));
      const intentId=intentBody?.intentId;
      if(typeof intentId!=='string'||intentBody?.status!=='pending'){
        throw new CommerceEveLifecycleError('CORE_END_INTENT_FAILED',null);
      }
      let ended:Response;
      try{ended=await fetchImpl(`${eve}/eve/v1/session/${encodeURIComponent(sessionId)}/end`,{
        method:'POST',headers:{...eveHeaders(),authorization:`Bearer ${issued.token}`,'content-type':'application/json'},
        body:JSON.stringify({reason:normalizedReason}),redirect:'error',
      });}catch{throw new CommerceEveLifecycleError('EVE_END_FAILED',null);}
      const endedBody=object(await json(ended));
      const deliveryId=endedBody?.deliveryId;
      if(ended.status!==202||typeof deliveryId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(deliveryId)){
        throw new CommerceEveLifecycleError('EVE_END_FAILED',ended.status);
      }
      const receiptBody=object(await retryableCorePost(
        corePath(`/sessions/${encodeURIComponent(sessionId)}/end-intents/${encodeURIComponent(intentId)}/receipt`),
        {deliveryId,confirmed:true},'CORE_END_RECEIPT_FAILED',
      ));
      if(receiptBody?.intentId!==intentId||receiptBody.status!=='receipt_received'){
        throw new CommerceEveLifecycleError('CORE_END_RECEIPT_FAILED',null);
      }
      const path=corePath(`/sessions/${encodeURIComponent(sessionId)}/end`);
      try{
        await retryableCorePost(path,{reason:normalizedReason,confirmed:true},'CORE_END_RECONCILIATION_PENDING');
      }catch(error){
        if(error instanceof CommerceEveLifecycleError)throw error;
        throw new CommerceEveLifecycleError('CORE_END_RECONCILIATION_PENDING',null);
      }
      return {sessionId,status:'ended'};
    },
  };
}

export type CommerceEveSessionClient=ReturnType<typeof createCommerceEveSessionClient>;
