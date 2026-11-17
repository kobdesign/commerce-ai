import { createHash,createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  agentApiErrorSchema,agentApiErrorSemantics,agentApiOperations,agentRequestContextSchema,authorizeAgentQuery,
  commerceAgentAudience,commerceAgentContractVersion,inventoryReadResponseSchema,productReadResponseSchema,salesReadResponseSchema,
  type AgentApiErrorCode,type AgentReadOperation,type InventoryQuery,type ProductQuery,type SalesQuery,
} from '@commerce/agent-contracts';
import { canonicalAgentEvidenceJson } from '@commerce/agent-evidence';
import {
  authorizeAgentServiceRequest as authorizeDatabaseRequest,readAgentInventory,readAgentProducts,readAgentSales,
  readAgentServiceRequestResult,storeAgentServiceRequestResult,
} from '@commerce/db';

export const agentServiceHeaders={
  requestId:'x-commerce-request-id',timestamp:'x-commerce-timestamp',environment:'x-commerce-environment',
  audience:'x-commerce-audience',signature:'x-commerce-signature',
} as const;
export const maximumAgentRequestBytes=32_768;
export const maximumAgentClockSkewMs=300_000;

const credentialPattern=/^svc_[A-Za-z0-9_-]{43}$/;
const signaturePattern=/^v1=([0-9a-f]{64})$/;
const requestIdSchema=z.string().uuid();
const timestampSchema=z.string().datetime({offset:true});
const environmentSchema=z.enum(['development','staging','production']);

export class AgentServiceAuthenticationError extends Error{
  constructor(public readonly code:AgentApiErrorCode,message:string,public readonly requestId:string=randomUUID(),public readonly fieldIssues:Array<{path:string;message:string}>=[]){super(message);this.name='AgentServiceAuthenticationError';}
}

export type AgentSigningInput={
  method:'POST';path:string;body:string;requestId:string;timestamp:string;
  environment:'development'|'staging'|'production';audience:typeof commerceAgentAudience;
};

export function agentRequestBodyHash(body:string){return createHash('sha256').update(body,'utf8').digest('hex');}
export function canonicalAgentServiceRequest(input:AgentSigningInput){
  return ['v1',input.method,input.path,agentRequestBodyHash(input.body),input.requestId,input.timestamp,input.environment,input.audience].join('\n');
}
export function signAgentServiceRequest(credential:string,input:AgentSigningInput){
  return `v1=${createHmac('sha256',credential).update(canonicalAgentServiceRequest(input),'utf8').digest('hex')}`;
}

function expectedEnvironment(){
  const mode=process.env.APP_MODE;
  if(mode==='local-demo')return 'development' as const;
  if(mode==='staging-demo')return 'staging' as const;
  if(mode==='production')return 'production' as const;
  throw new Error('APP_MODE is not configured for Agent API authentication');
}
function verifiedBearer(value:string|null,requestId:string){
  const match=value?.match(/^Bearer (.+)$/);
  if(!match||!credentialPattern.test(match[1]))throw new AgentServiceAuthenticationError('UNAUTHENTICATED','Service credential is missing or invalid',requestId);
  return match[1];
}
function verifySignature(credential:string,supplied:string|null,canonical:string,requestId:string){
  const match=supplied?.match(signaturePattern);
  if(!match)throw new AgentServiceAuthenticationError('SIGNATURE_INVALID','Request signature is missing or invalid',requestId);
  const expected=createHmac('sha256',credential).update(canonical,'utf8').digest();
  const received=Buffer.from(match[1],'hex');
  if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new AgentServiceAuthenticationError('SIGNATURE_INVALID','Request signature is missing or invalid',requestId);
}
function mapDatabaseError(error:unknown,requestId:string):never{
  const message=error instanceof Error?error.message:'';
  if(message.includes('AGENT_REQUEST_REPLAYED'))throw new AgentServiceAuthenticationError('REQUEST_REPLAYED','Request ID was already used',requestId);
  if(message.includes('AGENT_REQUEST_EXPIRED'))throw new AgentServiceAuthenticationError('REQUEST_EXPIRED','Request timestamp is outside the allowed window',requestId);
  if(message.includes('SERVICE_IDENTITY_EXPIRED'))throw new AgentServiceAuthenticationError('SERVICE_IDENTITY_EXPIRED','Service identity has expired',requestId);
  if(message.includes('SERVICE_ENVIRONMENT_FORBIDDEN'))throw new AgentServiceAuthenticationError('WRONG_ENVIRONMENT','Service identity is not valid in this environment',requestId);
  if(message.includes('SERVICE_AUDIENCE_FORBIDDEN'))throw new AgentServiceAuthenticationError('WRONG_AUDIENCE','Service identity is not valid for this audience',requestId);
  if(message.includes('SERVICE_SHOP_FORBIDDEN'))throw new AgentServiceAuthenticationError('SHOP_FORBIDDEN','Requested shop is outside the service delegation',requestId);
  if(message.includes('SERVICE_SCOPE_FORBIDDEN'))throw new AgentServiceAuthenticationError('SCOPE_FORBIDDEN','Required read scope is not delegated',requestId);
  if(message.includes('SERVICE_CREDENTIAL_INVALID'))throw new AgentServiceAuthenticationError('UNAUTHENTICATED','Service credential is missing or invalid',requestId);
  if(message.includes('AGENT_REQUEST_INVALID'))throw new AgentServiceAuthenticationError('INVALID_REQUEST','Signed request metadata is invalid',requestId);
  throw error;
}

export async function authenticateAgentServiceRequest(request:Request,operation:AgentReadOperation){
  const definition=agentApiOperations[operation];
  const fallbackRequestId=randomUUID();
  const requestIdValue=request.headers.get(agentServiceHeaders.requestId);
  const requestId=requestIdSchema.safeParse(requestIdValue);
  if(!requestId.success)throw new AgentServiceAuthenticationError('INVALID_REQUEST','A valid request ID is required',fallbackRequestId,[{path:agentServiceHeaders.requestId,message:'Must be a UUID'}]);
  const trustedRequestId=requestId.data;
  if(request.method!==definition.method)throw new AgentServiceAuthenticationError('INVALID_REQUEST','HTTP method is not allowed',trustedRequestId);
  const url=new URL(request.url);
  if(url.pathname!==definition.path||url.search)throw new AgentServiceAuthenticationError('INVALID_REQUEST','Request path does not match the operation',trustedRequestId);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AgentServiceAuthenticationError('INVALID_REQUEST','Content-Type must be application/json',trustedRequestId);

  const body=await request.text();
  if(Buffer.byteLength(body,'utf8')>maximumAgentRequestBytes)throw new AgentServiceAuthenticationError('INVALID_REQUEST','Request body exceeds the allowed size',trustedRequestId);
  const timestamp=timestampSchema.safeParse(request.headers.get(agentServiceHeaders.timestamp));
  if(!timestamp.success)throw new AgentServiceAuthenticationError('INVALID_REQUEST','A valid signed timestamp is required',trustedRequestId,[{path:agentServiceHeaders.timestamp,message:'Must be an ISO timestamp with offset'}]);
  if(Math.abs(Date.now()-Date.parse(timestamp.data))>maximumAgentClockSkewMs)throw new AgentServiceAuthenticationError('REQUEST_EXPIRED','Request timestamp is outside the allowed window',trustedRequestId);
  const environment=environmentSchema.safeParse(request.headers.get(agentServiceHeaders.environment));
  if(!environment.success)throw new AgentServiceAuthenticationError('INVALID_REQUEST','A valid environment is required',trustedRequestId);
  if(environment.data!==expectedEnvironment())throw new AgentServiceAuthenticationError('WRONG_ENVIRONMENT','Request environment does not match this service',trustedRequestId);
  const audience=request.headers.get(agentServiceHeaders.audience);
  if(audience!==commerceAgentAudience)throw new AgentServiceAuthenticationError('WRONG_AUDIENCE','Request audience does not match this service',trustedRequestId);

  const credential=verifiedBearer(request.headers.get('authorization'),trustedRequestId);
  const signingInput:AgentSigningInput={method:'POST',path:definition.path,body,requestId:trustedRequestId,timestamp:timestamp.data,environment:environment.data,audience:commerceAgentAudience};
  const canonical=canonicalAgentServiceRequest(signingInput);
  verifySignature(credential,request.headers.get(agentServiceHeaders.signature),canonical,trustedRequestId);

  let json:unknown;
  try{json=JSON.parse(body);}catch{throw new AgentServiceAuthenticationError('INVALID_REQUEST','Request body must be valid JSON',trustedRequestId);}
  const parsed=definition.input.safeParse(json);
  if(!parsed.success)throw new AgentServiceAuthenticationError('INVALID_REQUEST','Request body does not match the operation contract',trustedRequestId,
    parsed.error.issues.slice(0,25).map(issue=>({path:issue.path.join('.'),message:issue.message.slice(0,240)})));
  const query=parsed.data as {shopIds:string[]};
  const bodyHash=agentRequestBodyHash(body);
  let authorization:Awaited<ReturnType<typeof authorizeDatabaseRequest>>;
  try{
    authorization=await authorizeDatabaseRequest({
      credentialHash:createHash('sha256').update(credential,'utf8').digest('hex'),shopIds:query.shopIds,requiredScope:definition.requiredScope,
      environment:environment.data,audience:commerceAgentAudience,requestId:trustedRequestId,requestTimestamp:timestamp.data,
      method:'POST',path:definition.path,bodyHash,requestHash:createHash('sha256').update(canonical,'utf8').digest('hex'),
    });
  }catch(error){mapDatabaseError(error,trustedRequestId);}
  const context=agentRequestContextSchema.parse({
    tenantId:authorization.tenantId,principalId:authorization.principalId,allowedShopIds:authorization.shopIds,
    scopes:authorization.scopes,audience:authorization.audience,environment:authorization.environment,requestId:trustedRequestId,
    authenticatedAt:authorization.authenticatedAt.toISOString(),expiresAt:authorization.expiresAt.toISOString(),
  });
  authorizeAgentQuery(context,operation,query);
  return {context,query,body,bodyHash,replayed:authorization.replayed};
}

export function agentApiErrorResponse(error:unknown,fallbackRequestId:string=randomUUID()){
  if(!(error instanceof AgentServiceAuthenticationError)&&process.env.APP_MODE!=='production'){
    process.stderr.write(`[agent-api] ${error instanceof Error?error.message:'Unknown internal error'}\n`);
  }
  const known=error instanceof AgentServiceAuthenticationError?error:new AgentServiceAuthenticationError('INTERNAL_ERROR','The request could not be completed',fallbackRequestId);
  const semantics=agentApiErrorSemantics[known.code];
  const payload=agentApiErrorSchema.parse({contractVersion:commerceAgentContractVersion,requestId:known.requestId,error:{code:known.code,message:known.message,retryable:semantics.retryable,fieldIssues:known.fieldIssues}});
  return Response.json(payload,{status:semantics.status,headers:{'cache-control':'private, no-store','content-type':'application/json'}});
}

const cursorSchema=z.object({
  v:z.literal(1),resource:z.enum(['products','sales','inventory']),offset:z.number().int().min(1).max(10_000),
  asOf:z.string().datetime({offset:true}),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const rawReadPayloadSchema=z.object({items:z.array(z.object({sourceUpdatedAt:z.string().datetime({offset:true})}).passthrough()).max(101)}).strict();

function queryFingerprint(query:Record<string,unknown>){
  const normalized={...query,cursor:null,asOf:undefined};
  return createHash('sha256').update(JSON.stringify(normalized),'utf8').digest('hex');
}
function decodeCursor(value:string|null,operation:AgentReadOperation,fingerprint:string,requestId:string){
  if(!value)return null;
  try{
    const parsed=cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')));
    const expectedResource=operation.split('.')[0];
    if(parsed.resource!==expectedResource||parsed.fingerprint!==fingerprint)throw new Error('mismatch');
    return parsed;
  }catch{
    throw new AgentServiceAuthenticationError('INVALID_REQUEST','Cursor does not match this query',requestId,[{path:'cursor',message:'Use the unmodified cursor returned by the previous page'}]);
  }
}
function encodeCursor(resource:'products'|'sales'|'inventory',offset:number,asOf:string,fingerprint:string){
  return Buffer.from(JSON.stringify({v:1,resource,offset,asOf,fingerprint}),'utf8').toString('base64url');
}
function integrityHash(value:unknown){return createHash('sha256').update(canonicalAgentEvidenceJson(value),'utf8').digest('hex');}
function evidence(kind:'product'|'variant'|'sales_aggregate'|'inventory_balance'|'inventory_policy',ref:string,observedAt:string,sourceVersion:string,value:unknown){
  return {kind,ref:`${kind}:${ref}`,observedAt,sourceVersion,integrityHash:integrityHash(value)};
}
function appIsSynthetic(){return process.env.APP_MODE==='local-demo'||process.env.APP_MODE==='staging-demo';}
function mapReadError(error:unknown,requestId:string):never{
  const message=error instanceof Error?error.message:'';
  if(message.includes('AGENT_QUERY_INVALID'))throw new AgentServiceAuthenticationError('INVALID_REQUEST','Query values are outside the allowed range',requestId);
  throw error;
}

/** Execute an authenticated, receipt-bound read query and return the reduced agent projection. */
export async function handleAgentQueryRequest(request:Request,operation:AgentReadOperation){
  const suppliedRequestId=request.headers.get(agentServiceHeaders.requestId);
  const fallbackRequestId=requestIdSchema.safeParse(suppliedRequestId).success?suppliedRequestId!:randomUUID();
  try{
    const authenticated=await authenticateAgentServiceRequest(request,operation);
    const query=authenticated.query as ProductQuery|SalesQuery|InventoryQuery;
    const resultIdentity={tenantId:authenticated.context.tenantId,requestId:authenticated.context.requestId,
      principalId:authenticated.context.principalId,operation,bodyHash:authenticated.bodyHash};
    if(authenticated.replayed){
      const stored=await readAgentServiceRequestResult(resultIdentity);
      if(stored!==null){
        const payload=agentApiOperations[operation].output.parse(stored);
        return Response.json(payload,{status:200,headers:{'cache-control':'private, no-store','content-type':'application/json','x-commerce-idempotent-replay':'true'}});
      }
    }
    const fingerprint=queryFingerprint(query as unknown as Record<string,unknown>);
    const cursor=decodeCursor(query.cursor,operation,fingerprint,authenticated.context.requestId);
    if(cursor&&query.asOf&&query.asOf!==cursor.asOf){
      throw new AgentServiceAuthenticationError('SNAPSHOT_EXPIRED','Cursor snapshot does not match the requested snapshot',authenticated.context.requestId);
    }
    const asOf=cursor?.asOf??query.asOf??new Date().toISOString();
    const offset=cursor?.offset??0;
    let databasePayload:unknown;
    try{
      if(operation==='products.query'){
        const product=query as ProductQuery;
        databasePayload=await readAgentProducts({tenantId:authenticated.context.tenantId,requestId:authenticated.context.requestId,shopIds:product.shopIds,
          search:product.search,category:product.category,status:product.status,variantIds:product.variantIds,limit:product.limit+1,offset});
      }else if(operation==='sales.query'){
        const sales=query as SalesQuery;
        databasePayload=await readAgentSales({tenantId:authenticated.context.tenantId,requestId:authenticated.context.requestId,shopIds:sales.shopIds,
          from:sales.period.from,to:sales.period.to,variantIds:sales.variantIds,granularity:sales.granularity,orderStates:sales.orderStates,limit:sales.limit+1,offset});
      }else{
        const inventory=query as InventoryQuery;
        databasePayload=await readAgentInventory({tenantId:authenticated.context.tenantId,requestId:authenticated.context.requestId,shopIds:inventory.shopIds,
          search:inventory.search,variantIds:inventory.variantIds,availability:inventory.availability,includeChannelAllocation:inventory.includeChannelAllocation,
          limit:inventory.limit+1,offset});
      }
    }catch(error){mapReadError(error,authenticated.context.requestId);}
    const raw=rawReadPayloadSchema.parse(databasePayload);
    const hasMore=raw.items.length>query.limit;
    const rows=raw.items.slice(0,query.limit);
    const resource=operation.split('.')[0] as 'products'|'sales'|'inventory';
    const nextCursor=hasMore?encodeCursor(resource,offset+query.limit,asOf,fingerprint):null;
    const common={contractVersion:commerceAgentContractVersion,requestId:authenticated.context.requestId,asOf,
      dataVersion:`${resource}:${integrityHash({fingerprint,rows}).slice(0,24)}`,isSynthetic:appIsSynthetic(),scope:{shopIds:query.shopIds},
      page:{limit:query.limit,returned:rows.length,hasMore,nextCursor}};
    let payload:unknown;
    if(operation==='products.query'){
      payload=productReadResponseSchema.parse({...common,resource:'products',limitations:['Product cost and supplier data are intentionally excluded.'],items:rows.map(row=>{
        const {sourceUpdatedAt,...item}=row;
        const productId=String(item.productId);const variantId=String(item.variantId);
        return {...item,evidence:[evidence('product',productId,sourceUpdatedAt,'catalog-v1',item),evidence('variant',variantId,sourceUpdatedAt,'catalog-v1',item)]};
      })});
    }else if(operation==='sales.query'){
      payload=salesReadResponseSchema.parse({...common,resource:'sales',limitations:['Sales aggregates contain internal manual/shadow orders only; customer and raw order identifiers are excluded.'],items:rows.map(row=>{
        const {sourceUpdatedAt,...item}=row;const ref=integrityHash(item).slice(0,32);
        return {...item,evidence:[evidence('sales_aggregate',ref,sourceUpdatedAt,'sales-aggregate-v1',item)]};
      })});
    }else{
      payload=inventoryReadResponseSchema.parse({...common,resource:'inventory',limitations:['Channel quantities are planning values; published marketplace stock and sync time are unavailable until provider integrations report them.'],items:rows.map(row=>{
        const {sourceUpdatedAt,...item}=row;const variantId=String(item.variantId);
        return {...item,evidence:[evidence('inventory_balance',variantId,sourceUpdatedAt,'inventory-ledger-v1',item),evidence('inventory_policy',variantId,sourceUpdatedAt,'inventory-policy-v1',item)]};
      })});
    }
    payload=agentApiOperations[operation].output.parse(await storeAgentServiceRequestResult({...resultIdentity,payload}));
    return Response.json(payload,{status:200,headers:{'cache-control':'private, no-store','content-type':'application/json',
      'x-commerce-idempotent-replay':authenticated.replayed?'true':'false'}});
  }catch(error){return agentApiErrorResponse(error,fallbackRequestId);}
}
