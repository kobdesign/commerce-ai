import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { z } from 'zod';

export const commerceSessionIssuer='commerce-core';
export const commerceSessionAudience='commerce-eve-runtime';
export const commerceSessionTokenPrefix='csg1_';
export const commerceSessionMaxTtlSeconds=300;
export const commerceCleanupIssuer='commerce-core';
export const commerceCleanupAudience='commerce-eve-cleanup';
export const commerceCleanupTokenPrefix='ccl1_';
export const commerceCleanupMaxTtlSeconds=120;
export const commerceSessionIdSchema=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/);

const uuid=z.string().uuid();
const uniqueShopIds=z.array(uuid).min(1).max(20).refine(values=>new Set(values).size===values.length,'Shop IDs must be unique');
const headerSchema=z.object({alg:z.literal('EdDSA'),typ:z.literal('CSG'),kid:z.string().min(1).max(80)}).strict();
const cleanupHeaderSchema=z.object({alg:z.literal('EdDSA'),typ:z.literal('CCL'),kid:z.string().min(1).max(80)}).strict();
export const commerceSessionClaimsSchema=z.object({
  version:z.literal(1),
  issuer:z.literal(commerceSessionIssuer),
  audience:z.literal(commerceSessionAudience),
  subject:uuid,
  tenantId:uuid,
  shopIds:uniqueShopIds,
  role:z.enum(['owner','finance','operator','marketing','auditor']),
  environment:z.enum(['development','staging']),
  capability:z.enum(['create','continue']),
  sessionId:commerceSessionIdSchema.nullable(),
  grantId:uuid,
  issuedAt:z.number().int().nonnegative(),
  expiresAt:z.number().int().positive(),
}).strict().superRefine((claims,ctx)=>{
  if(claims.capability==='create'&&claims.sessionId!==null)ctx.addIssue({code:'custom',path:['sessionId'],message:'Create grants cannot address an existing session.'});
  if(claims.capability==='continue'&&claims.sessionId===null)ctx.addIssue({code:'custom',path:['sessionId'],message:'Continuation grants require a session ID.'});
});

export type CommerceSessionClaims=z.infer<typeof commerceSessionClaimsSchema>;
export type CommerceSessionEnvironment=CommerceSessionClaims['environment'];
export type CommerceSessionIssueInput=Omit<CommerceSessionClaims,'version'|'issuer'|'audience'|'capability'|'sessionId'|'grantId'|'issuedAt'|'expiresAt'>&{
  capability?:CommerceSessionClaims['capability'];
  sessionId?:string|null;
  ttlSeconds?:number;
};

export class CommerceSessionGrantError extends Error{
  constructor(public readonly code:'INVALID_GRANT'|'EXPIRED_GRANT'|'GRANT_NOT_ACTIVE'|'GRANT_ENVIRONMENT_MISMATCH',message:string){
    super(message);this.name='CommerceSessionGrantError';
  }
}

export const commerceCleanupClaimsSchema=z.object({
  version:z.literal(1),issuer:z.literal(commerceCleanupIssuer),audience:z.literal(commerceCleanupAudience),
  subject:z.literal('commerce-lifecycle-worker'),tenantId:uuid,sessionId:commerceSessionIdSchema,intentId:uuid,
  environment:z.enum(['development','staging']),capability:z.literal('cleanup:end'),nonce:uuid,
  issuedAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive(),
}).strict();
export type CommerceCleanupClaims=z.infer<typeof commerceCleanupClaimsSchema>;
export type CommerceCleanupIssueInput=Pick<CommerceCleanupClaims,'tenantId'|'sessionId'|'intentId'|'environment'>&{ttlSeconds?:number};

export class CommerceCleanupGrantError extends Error{
  constructor(public readonly code:'INVALID_CLEANUP_GRANT'|'EXPIRED_CLEANUP_GRANT'|'CLEANUP_GRANT_NOT_ACTIVE'|'CLEANUP_ENVIRONMENT_MISMATCH'|'CLEANUP_KEY_REVOKED',message:string){
    super(message);this.name='CommerceCleanupGrantError';
  }
}

function encode(value:unknown){return Buffer.from(JSON.stringify(value),'utf8').toString('base64url');}
function canonicalBase64url(value:string){
  if(!/^[A-Za-z0-9_-]+$/.test(value))return null;
  const decoded=Buffer.from(value,'base64url');
  return decoded.toString('base64url')===value?decoded:null;
}
function decode(value:string){
  try{const decoded=canonicalBase64url(value);if(!decoded)throw new Error('non-canonical');return JSON.parse(decoded.toString('utf8')) as unknown;}
  catch{throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session grant is malformed.');}
}
function decodeCleanup(value:string){
  try{const decoded=canonicalBase64url(value);if(!decoded)throw new Error('non-canonical');return JSON.parse(decoded.toString('utf8')) as unknown;}
  catch{throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup grant is malformed.');}
}
function derKey(value:string,label:'private'|'public'){
  const normalized=value.trim();
  if(!/^[A-Za-z0-9_-]+={0,2}$/.test(normalized))throw new CommerceSessionGrantError('INVALID_GRANT',`Commerce session ${label} key must be base64url DER.`);
  return Buffer.from(normalized,'base64url');
}

export function issueCommerceSessionGrant(input:CommerceSessionIssueInput,configuration:{keyId:string;privateKey:string;now?:Date}){
  const now=Math.floor((configuration.now??new Date()).getTime()/1000);
  const ttl=input.ttlSeconds??commerceSessionMaxTtlSeconds;
  if(!Number.isInteger(ttl)||ttl<30||ttl>commerceSessionMaxTtlSeconds)throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session grant TTL is outside the allowed range.');
  const claims=commerceSessionClaimsSchema.parse({
    version:1,issuer:commerceSessionIssuer,audience:commerceSessionAudience,subject:input.subject,tenantId:input.tenantId,
    shopIds:input.shopIds,role:input.role,environment:input.environment,capability:input.capability??'create',
    sessionId:input.sessionId??null,grantId:randomUUID(),issuedAt:now,expiresAt:now+ttl,
  });
  const header=headerSchema.parse({alg:'EdDSA',typ:'CSG',kid:configuration.keyId});
  const unsigned=`${encode(header)}.${encode(claims)}`;
  const key=createPrivateKey({key:derKey(configuration.privateKey,'private'),format:'der',type:'pkcs8'});
  const signature=sign(null,Buffer.from(unsigned,'utf8'),key).toString('base64url');
  return {token:`${commerceSessionTokenPrefix}${unsigned}.${signature}`,claims};
}

export function verifyCommerceSessionGrant(token:string,configuration:{keyId:string;publicKey:string;environment:CommerceSessionEnvironment;now?:Date;clockSkewSeconds?:number}){
  if(!token.startsWith(commerceSessionTokenPrefix))throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session grant prefix is invalid.');
  const segments=token.slice(commerceSessionTokenPrefix.length).split('.');
  if(segments.length!==3)throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session grant is malformed.');
  const [encodedHeader,encodedClaims,encodedSignature]=segments;
  const header=headerSchema.safeParse(decode(encodedHeader));
  if(!header.success||header.data.kid!==configuration.keyId)throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session grant key is not trusted.');
  const key=createPublicKey({key:derKey(configuration.publicKey,'public'),format:'der',type:'spki'});
  const signature=canonicalBase64url(encodedSignature);
  if(!signature)throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session signature is malformed.');
  if(signature.length!==64||!verify(null,Buffer.from(`${encodedHeader}.${encodedClaims}`,'utf8'),key,signature))throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session signature is invalid.');
  const parsed=commerceSessionClaimsSchema.safeParse(decode(encodedClaims));
  if(!parsed.success)throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session claims are invalid.');
  const now=Math.floor((configuration.now??new Date()).getTime()/1000),skew=configuration.clockSkewSeconds??15;
  if(parsed.data.environment!==configuration.environment)throw new CommerceSessionGrantError('GRANT_ENVIRONMENT_MISMATCH','Commerce session environment does not match this runtime.');
  if(parsed.data.issuedAt>now+skew)throw new CommerceSessionGrantError('GRANT_NOT_ACTIVE','Commerce session grant is not active yet.');
  if(parsed.data.expiresAt<=now-skew)throw new CommerceSessionGrantError('EXPIRED_GRANT','Commerce session grant has expired.');
  if(parsed.data.expiresAt-parsed.data.issuedAt>commerceSessionMaxTtlSeconds)throw new CommerceSessionGrantError('INVALID_GRANT','Commerce session grant lifetime is too long.');
  return parsed.data;
}

export function exportCommerceSessionPublicKey(privateKey:string){
  const key=createPrivateKey({key:derKey(privateKey,'private'),format:'der',type:'pkcs8'});
  return createPublicKey(key).export({format:'der',type:'spki'}).toString('base64url');
}

export function issueCommerceCleanupGrant(input:CommerceCleanupIssueInput,configuration:{keyId:string;privateKey:string;now?:Date}){
  const now=Math.floor((configuration.now??new Date()).getTime()/1000),ttl=input.ttlSeconds??60;
  if(!Number.isInteger(ttl)||ttl<30||ttl>commerceCleanupMaxTtlSeconds){
    throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup grant TTL is outside the allowed range.');
  }
  const claims=commerceCleanupClaimsSchema.parse({
    version:1,issuer:commerceCleanupIssuer,audience:commerceCleanupAudience,subject:'commerce-lifecycle-worker',
    tenantId:input.tenantId,sessionId:input.sessionId,intentId:input.intentId,environment:input.environment,
    capability:'cleanup:end',nonce:randomUUID(),issuedAt:now,expiresAt:now+ttl,
  });
  const header=cleanupHeaderSchema.parse({alg:'EdDSA',typ:'CCL',kid:configuration.keyId});
  const unsigned=`${encode(header)}.${encode(claims)}`;
  const key=createPrivateKey({key:derKey(configuration.privateKey,'private'),format:'der',type:'pkcs8'});
  const signature=sign(null,Buffer.from(unsigned,'utf8'),key).toString('base64url');
  return {token:`${commerceCleanupTokenPrefix}${unsigned}.${signature}`,claims};
}

export function verifyCommerceCleanupGrant(token:string,configuration:{
  environment:CommerceSessionEnvironment;publicKeys:Readonly<Record<string,string>>;revokedKeyIds?:readonly string[];
  now?:Date;clockSkewSeconds?:number;
}){
  if(!token.startsWith(commerceCleanupTokenPrefix))throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup grant prefix is invalid.');
  const segments=token.slice(commerceCleanupTokenPrefix.length).split('.');
  if(segments.length!==3)throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup grant is malformed.');
  const [encodedHeader,encodedClaims,encodedSignature]=segments;
  const header=cleanupHeaderSchema.safeParse(decodeCleanup(encodedHeader));
  if(!header.success)throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup header is invalid.');
  if(configuration.revokedKeyIds?.includes(header.data.kid))throw new CommerceCleanupGrantError('CLEANUP_KEY_REVOKED','Commerce cleanup signing key is revoked.');
  const publicKey=configuration.publicKeys[header.data.kid];
  if(!publicKey||Object.keys(configuration.publicKeys).length>3)throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup signing key is not trusted.');
  const key=createPublicKey({key:derKey(publicKey,'public'),format:'der',type:'spki'});
  const signature=canonicalBase64url(encodedSignature);
  if(!signature)throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup signature is malformed.');
  if(signature.length!==64||!verify(null,Buffer.from(`${encodedHeader}.${encodedClaims}`,'utf8'),key,signature)){
    throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup signature is invalid.');
  }
  const parsed=commerceCleanupClaimsSchema.safeParse(decodeCleanup(encodedClaims));
  if(!parsed.success)throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup claims are invalid.');
  const now=Math.floor((configuration.now??new Date()).getTime()/1000),skew=configuration.clockSkewSeconds??15;
  if(parsed.data.environment!==configuration.environment)throw new CommerceCleanupGrantError('CLEANUP_ENVIRONMENT_MISMATCH','Commerce cleanup environment does not match this runtime.');
  if(parsed.data.issuedAt>now+skew)throw new CommerceCleanupGrantError('CLEANUP_GRANT_NOT_ACTIVE','Commerce cleanup grant is not active yet.');
  if(parsed.data.expiresAt<=now-skew)throw new CommerceCleanupGrantError('EXPIRED_CLEANUP_GRANT','Commerce cleanup grant has expired.');
  if(parsed.data.expiresAt-parsed.data.issuedAt>commerceCleanupMaxTtlSeconds)throw new CommerceCleanupGrantError('INVALID_CLEANUP_GRANT','Commerce cleanup grant lifetime is too long.');
  return parsed.data;
}
