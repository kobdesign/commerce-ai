import { z } from 'zod';
import {
  evidenceReferenceSchema,inventoryReadResponseSchema,productReadResponseSchema,salesReadResponseSchema,
} from '@commerce/agent-contracts';

const uuid=z.string().uuid();
const versionTag=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const resourceSchema=z.enum(['products','sales','inventory']);

export const resolvedEvidenceReferenceSchema=evidenceReferenceSchema.extend({
  integrityHash:z.string().regex(/^[a-f0-9]{64}$/),resource:resourceSchema,sourceRequestId:uuid,
  dataVersion:versionTag,responseAsOf:z.string().datetime({offset:true}),productId:uuid,variantId:uuid,
}).strict();
export type ResolvedEvidenceReference=z.infer<typeof resolvedEvidenceReferenceSchema>;

type ProductResponse=z.infer<typeof productReadResponseSchema>;
type SalesResponse=z.infer<typeof salesReadResponseSchema>;
type InventoryResponse=z.infer<typeof inventoryReadResponseSchema>;
export type AgentEvidenceResponse=ProductResponse|SalesResponse|InventoryResponse;

export type EvidenceVerificationCode=
  |'INTEGRITY_MISMATCH'|'REFERENCE_MISMATCH'|'SOURCE_VERSION_MISMATCH'|'EVIDENCE_INCOMPLETE'
  |'SCOPE_MISMATCH'|'SNAPSHOT_MISMATCH'|'SNAPSHOT_STALE'|'PAGINATION_INCOMPLETE'|'REQUEST_ID_REUSED';

export class AgentEvidenceVerificationError extends Error{
  constructor(public readonly code:EvidenceVerificationCode,message:string){super(message);this.name='AgentEvidenceVerificationError';}
}

/** Hash contract used by both Commerce Core evidence production and runtime verification. */
export function canonicalAgentEvidenceJson(value:unknown):string{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new TypeError('Evidence values must contain finite numbers');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return `[${value.map(item=>canonicalAgentEvidenceJson(item)).join(',')}]`;
  if(typeof value==='object'){
    const record=value as Record<string,unknown>;
    const entries=Object.keys(record).filter(key=>record[key]!==undefined).sort()
      .map(key=>`${JSON.stringify(key)}:${canonicalAgentEvidenceJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new TypeError('Evidence values must be JSON serializable');
}

export async function agentEvidenceIntegrityHash(value:unknown){
  const bytes=new TextEncoder().encode(canonicalAgentEvidenceJson(value));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function sameSet(left:string[],right:string[]){
  return left.length===right.length&&[...left].sort().every((value,index)=>value===[...right].sort()[index]);
}

function expectedEvidence(response:AgentEvidenceResponse,item:AgentEvidenceResponse['items'][number],hash:string){
  if(response.resource==='products'){
    const product=item as ProductResponse['items'][number];
    return [
      {kind:'product' as const,ref:`product:${product.productId}`,sourceVersion:'catalog-v1'},
      {kind:'variant' as const,ref:`variant:${product.variantId}`,sourceVersion:'catalog-v1'},
    ];
  }
  if(response.resource==='sales')return [{kind:'sales_aggregate' as const,ref:`sales_aggregate:${hash.slice(0,32)}`,sourceVersion:'sales-aggregate-v1'}];
  const inventory=item as InventoryResponse['items'][number];
  return [
    {kind:'inventory_balance' as const,ref:`inventory_balance:${inventory.variantId}`,sourceVersion:'inventory-ledger-v1'},
    {kind:'inventory_policy' as const,ref:`inventory_policy:${inventory.variantId}`,sourceVersion:'inventory-policy-v1'},
  ];
}

export async function verifyAgentEvidenceResponse(responseInput:AgentEvidenceResponse):Promise<ResolvedEvidenceReference[]>{
  const response=responseInput.resource==='products'?productReadResponseSchema.parse(responseInput)
    :responseInput.resource==='sales'?salesReadResponseSchema.parse(responseInput):inventoryReadResponseSchema.parse(responseInput);
  if(response.page.hasMore||response.page.nextCursor!==null)throw new AgentEvidenceVerificationError('PAGINATION_INCOMPLETE',`${response.resource} evidence is paginated and incomplete`);
  const resolved:ResolvedEvidenceReference[]=[];
  for(const item of response.items){
    const {evidence,...payload}=item;
    const hash=await agentEvidenceIntegrityHash(payload);
    const expected=expectedEvidence(response as AgentEvidenceResponse,item as AgentEvidenceResponse['items'][number],hash);
    if(evidence.length!==expected.length)throw new AgentEvidenceVerificationError('EVIDENCE_INCOMPLETE',`${response.resource} item ${item.variantId} does not contain the exact required evidence set`);
    for(const requirement of expected){
      const found=evidence.find(candidate=>candidate.kind===requirement.kind);
      if(!found)throw new AgentEvidenceVerificationError('EVIDENCE_INCOMPLETE',`Required ${requirement.kind} evidence is missing for variant ${item.variantId}`);
      if(found.ref!==requirement.ref)throw new AgentEvidenceVerificationError('REFERENCE_MISMATCH',`${requirement.kind} evidence does not identify the verified item`);
      if(found.sourceVersion!==requirement.sourceVersion)throw new AgentEvidenceVerificationError('SOURCE_VERSION_MISMATCH',`${requirement.kind} evidence uses unsupported source version ${found.sourceVersion}`);
      if(found.integrityHash!==hash)throw new AgentEvidenceVerificationError('INTEGRITY_MISMATCH',`${requirement.kind} evidence failed integrity verification`);
      if(Date.parse(found.observedAt)>Date.parse(response.asOf))throw new AgentEvidenceVerificationError('SNAPSHOT_MISMATCH',`${requirement.kind} evidence was observed after the response snapshot`);
      resolved.push(resolvedEvidenceReferenceSchema.parse({...found,resource:response.resource,sourceRequestId:response.requestId,
        dataVersion:response.dataVersion,responseAsOf:response.asOf,productId:item.productId,variantId:item.variantId}));
    }
  }
  return resolved;
}

export async function verifyAgentEvidenceBundle(input:{products:ProductResponse;sales:SalesResponse;inventory:InventoryResponse},options:{
  expectedShopIds:string[];expectedAsOf?:string;now?:Date;maximumSnapshotAgeMs?:number;
}){
  const responses:AgentEvidenceResponse[]=[input.products,input.sales,input.inventory];
  const requestIds=responses.map(response=>response.requestId);
  if(new Set(requestIds).size!==requestIds.length)throw new AgentEvidenceVerificationError('REQUEST_ID_REUSED','Evidence sources must use distinct Core request IDs');
  for(const response of responses){
    if(!sameSet(response.scope.shopIds,options.expectedShopIds))throw new AgentEvidenceVerificationError('SCOPE_MISMATCH',`${response.resource} evidence scope does not match the delegated shop scope`);
    if(options.expectedAsOf&&response.asOf!==options.expectedAsOf)throw new AgentEvidenceVerificationError('SNAPSHOT_MISMATCH',`${response.resource} evidence does not use the pinned snapshot`);
  }
  const snapshot=options.expectedAsOf??responses[0].asOf;
  if(responses.some(response=>response.asOf!==snapshot))throw new AgentEvidenceVerificationError('SNAPSHOT_MISMATCH','Commerce evidence sources do not share one snapshot');
  const now=(options.now??new Date()).getTime();
  const snapshotTime=Date.parse(snapshot);
  const maximumAge=options.maximumSnapshotAgeMs??300_000;
  if(snapshotTime>now+60_000||now-snapshotTime>maximumAge)throw new AgentEvidenceVerificationError('SNAPSHOT_STALE','Commerce evidence snapshot is outside the verification window');
  const manifest=(await Promise.all(responses.map(response=>verifyAgentEvidenceResponse(response)))).flat();
  return {
    asOf:snapshot,
    manifest,
    sources:responses.map(response=>({resource:response.resource,requestId:response.requestId,asOf:response.asOf,
      dataVersion:response.dataVersion,limitations:response.limitations})),
  };
}
