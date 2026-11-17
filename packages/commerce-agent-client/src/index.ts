import { createHash,createHmac,randomUUID } from 'node:crypto';
import {
  agentApiErrorSchema,agentApiOperations,commerceAgentAudience,inventoryQuerySchema,inventoryReadResponseSchema,
  productQuerySchema,productReadResponseSchema,salesQuerySchema,salesReadResponseSchema,
  type AgentApiError,type AgentReadOperation,type InventoryQuery,type ProductQuery,type SalesQuery,
} from '@commerce/agent-contracts';

export type CommerceAgentEnvironment='development'|'staging'|'production';
export type CommerceAgentClientConfig={
  baseUrl:string;credential:string;environment:CommerceAgentEnvironment;fetch?:typeof fetch;
};
export type CommerceAgentRequestOptions={signal?:AbortSignal;idempotencyKey?:string};

const headers={requestId:'x-commerce-request-id',timestamp:'x-commerce-timestamp',environment:'x-commerce-environment',
  audience:'x-commerce-audience',signature:'x-commerce-signature'} as const;

export class CommerceAgentApiError extends Error{
  constructor(public readonly response:AgentApiError,public readonly status:number){super(response.error.message);this.name='CommerceAgentApiError';}
}
function validateConfig(config:CommerceAgentClientConfig){
  const url=new URL(config.baseUrl);
  const localDevelopment=config.environment==='development'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
  if(url.protocol!=='https:'&&!localDevelopment)throw new Error('Commerce Core URL must use HTTPS outside local development');
  if(url.username||url.password||url.search||url.hash)throw new Error('Commerce Core URL must not contain credentials, query or fragment');
  if(!/^svc_[A-Za-z0-9_-]{43}$/.test(config.credential))throw new Error('Commerce service credential format is invalid');
  return url.toString().replace(/\/$/,'');
}
function sign(credential:string,method:'POST',path:string,body:string,requestId:string,timestamp:string,environment:CommerceAgentEnvironment){
  const bodyHash=createHash('sha256').update(body,'utf8').digest('hex');
  const canonical=['v1',method,path,bodyHash,requestId,timestamp,environment,commerceAgentAudience].join('\n');
  return `v1=${createHmac('sha256',credential).update(canonical,'utf8').digest('hex')}`;
}

/**
 * Produce a stable UUID for one logical operation without sending the source key to Commerce Core.
 * Reusing a key with a different payload is rejected by Core rather than silently returning stale data.
 */
export function commerceAgentIdempotencyId(idempotencyKey:string,operation:string){
  if(idempotencyKey.length<1||idempotencyKey.length>256)throw new Error('Commerce idempotency key must contain 1 to 256 characters');
  const bytes=createHash('sha256').update(`commerce-agent-idempotency-v1\n${operation}\n${idempotencyKey}`,'utf8').digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function createCommerceAgentClient(config:CommerceAgentClientConfig){
  const baseUrl=validateConfig(config);const fetchImpl=config.fetch??fetch;
  async function request(operation:AgentReadOperation,input:unknown,options:CommerceAgentRequestOptions={}){
    const definition=agentApiOperations[operation];
    const parsed=definition.input.parse(input);const body=JSON.stringify(parsed);
    const requestId=options.idempotencyKey?commerceAgentIdempotencyId(options.idempotencyKey,operation):randomUUID();
    const timestamp=new Date().toISOString();
    const response=await fetchImpl(`${baseUrl}${definition.path}`,{method:'POST',body,signal:options.signal,headers:{
      'content-type':'application/json','authorization':`Bearer ${config.credential}`,[headers.requestId]:requestId,
      [headers.timestamp]:timestamp,[headers.environment]:config.environment,[headers.audience]:commerceAgentAudience,
      [headers.signature]:sign(config.credential,'POST',definition.path,body,requestId,timestamp,config.environment),
    }});
    const json:unknown=await response.json().catch(()=>null);
    if(!response.ok){
      const error=agentApiErrorSchema.safeParse(json);
      if(error.success)throw new CommerceAgentApiError(error.data,response.status);
      throw new Error(`Commerce Core returned HTTP ${response.status} without a valid error contract`);
    }
    return definition.output.parse(json);
  }
  return {
    products:(input:ProductQuery,options?:CommerceAgentRequestOptions)=>request('products.query',productQuerySchema.parse(input),options).then(value=>productReadResponseSchema.parse(value)),
    sales:(input:SalesQuery,options?:CommerceAgentRequestOptions)=>request('sales.query',salesQuerySchema.parse(input),options).then(value=>salesReadResponseSchema.parse(value)),
    inventory:(input:InventoryQuery,options?:CommerceAgentRequestOptions)=>request('inventory.query',inventoryQuerySchema.parse(input),options).then(value=>inventoryReadResponseSchema.parse(value)),
  };
}
export type CommerceAgentClient=ReturnType<typeof createCommerceAgentClient>;
