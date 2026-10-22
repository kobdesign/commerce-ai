import { createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError,type Context } from '@commerce/contracts';
import { withTenant } from '@commerce/db';

export const tiktokConnectorEnvironments=['development','production'] as const;
export type TikTokConnectorEnvironment=typeof tiktokConnectorEnvironments[number];

type ConnectorEnvironment=Record<string,string|undefined>;
export type TikTokShopConfiguration={
  ready:boolean;
  environment:TikTokConnectorEnvironment;
  appKey:string|null;
  appSecret:string|null;
  sellerAuthorizationUrl:string|null;
  tokenEndpoint:string;
  redirectUri:string|null;
  oauthStateSecret:string|null;
  tokenEncryptionKey:Buffer|null;
  blockers:string[];
};

const officialTokenEndpoint='https://auth.tiktok-shops.com/api/v2/token/get';
function httpsUrl(value:string|undefined,allowed:(hostname:string)=>boolean){
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&allowed(url.hostname.toLowerCase())?url:null;}catch{return null;}
}

export function tiktokShopConfiguration(env:ConnectorEnvironment=process.env):TikTokShopConfiguration{
  const blockers:string[]=[];
  const environment=env.TIKTOK_SHOP_ENVIRONMENT==='production'?'production':'development';
  const appKey=env.TIKTOK_SHOP_APP_KEY?.trim()||null;
  const appSecret=env.TIKTOK_SHOP_APP_SECRET?.trim()||null;
  const stateSecret=env.TIKTOK_SHOP_OAUTH_STATE_SECRET?.trim()||null;
  const authUrl=httpsUrl(env.TIKTOK_SHOP_SELLER_AUTH_URL,host=>host==='tiktokshop.com'||host.endsWith('.tiktokshop.com'));
  const origin=httpsUrl(env.APP_ORIGIN??(env.RENDER_EXTERNAL_HOSTNAME?`https://${env.RENDER_EXTERNAL_HOSTNAME}`:undefined),()=>true);
  let encryptionKey:Buffer|null=null;
  try{const value=Buffer.from(env.TIKTOK_SHOP_TOKEN_ENCRYPTION_KEY??'','base64');if(value.length===32)encryptionKey=value;}catch{encryptionKey=null;}
  if(!appKey)blockers.push('app-key');
  if(!appSecret)blockers.push('app-secret');
  if(!authUrl||!authUrl.searchParams.get('service_id'))blockers.push('seller-authorization-url');
  if(!origin)blockers.push('https-origin');
  if(!stateSecret||stateSecret.length<32)blockers.push('oauth-state-secret');
  if(!encryptionKey)blockers.push('token-encryption-key');
  if(env.APP_MODE==='staging-demo'&&environment!=='development')blockers.push('staging-development-shop-only');
  if(env.APP_MODE==='production'&&environment!=='production')blockers.push('production-connector-mode');
  return {ready:blockers.length===0,environment,appKey,appSecret,sellerAuthorizationUrl:authUrl?.toString()??null,tokenEndpoint:officialTokenEndpoint,
    redirectUri:origin?new URL('/api/connectors/tiktok/callback',origin).toString():null,oauthStateSecret:stateSecret,tokenEncryptionKey:encryptionKey,blockers};
}

const statePayload=z.object({v:z.literal(1),tenantId:z.string().uuid(),shopId:z.string().uuid(),userId:z.string().uuid(),nonce:z.string().min(16),expiresAt:z.number().int().positive()}).strict();
export type TikTokAuthorizationState=z.infer<typeof statePayload>;

export function createTikTokAuthorizationState(input:Omit<TikTokAuthorizationState,'v'|'nonce'|'expiresAt'>,secret:string,now=Date.now()){
  const payload: TikTokAuthorizationState={v:1,...input,nonce:randomBytes(18).toString('base64url'),expiresAt:now+10*60_000};
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature=createHmac('sha256',secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyTikTokAuthorizationState(value:string,secret:string,now=Date.now()){
  const [encoded,supplied,...rest]=value.split('.');
  if(!encoded||!supplied||rest.length)throw new Error('TIKTOK_OAUTH_STATE_INVALID');
  const expected=createHmac('sha256',secret).update(encoded).digest();
  let received:Buffer;try{received=Buffer.from(supplied,'base64url');}catch{throw new Error('TIKTOK_OAUTH_STATE_INVALID');}
  if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new Error('TIKTOK_OAUTH_STATE_INVALID');
  let raw:unknown;try{raw=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw new Error('TIKTOK_OAUTH_STATE_INVALID');}
  const payload=statePayload.parse(raw);
  if(payload.expiresAt<now)throw new Error('TIKTOK_OAUTH_STATE_EXPIRED');
  return payload;
}

export function tiktokSellerAuthorizationUrl(configuration:TikTokShopConfiguration,state:string){
  if(!configuration.ready||!configuration.sellerAuthorizationUrl)throw new Error(`TIKTOK_CONFIGURATION_INCOMPLETE:${configuration.blockers.join(',')}`);
  const url=new URL(configuration.sellerAuthorizationUrl);url.searchParams.set('state',state);return url.toString();
}

const tokenResponse=z.object({
  code:z.number().int(),message:z.string().optional(),
  data:z.object({access_token:z.string().min(1),refresh_token:z.string().min(1),open_id:z.string().min(1),user_type:z.number().int(),
    access_token_expire_in:z.number().int().positive().optional(),refresh_token_expire_in:z.number().int().positive().optional(),granted_scopes:z.array(z.string()).optional()}).optional(),
});
export type TikTokSellerToken={accessToken:string;refreshToken:string;openId:string;scopes:string[];accessTokenExpiresAt:Date|null;refreshTokenExpiresAt:Date|null};

export async function exchangeTikTokSellerCode(configuration:TikTokShopConfiguration,authCode:string,request:typeof fetch=fetch):Promise<TikTokSellerToken>{
  if(!configuration.ready||!configuration.appKey||!configuration.appSecret)throw new Error('TIKTOK_CONFIGURATION_INCOMPLETE');
  const url=new URL(configuration.tokenEndpoint);url.searchParams.set('app_key',configuration.appKey);url.searchParams.set('app_secret',configuration.appSecret);
  url.searchParams.set('auth_code',authCode);url.searchParams.set('grant_type','authorized_code');
  const response=await request(url,{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`TIKTOK_TOKEN_HTTP_${response.status}`);
  const parsed=tokenResponse.parse(await response.json());
  if(parsed.code!==0||!parsed.data)throw new Error(`TIKTOK_TOKEN_REJECTED_${parsed.code}`);
  if(parsed.data.user_type!==0)throw new Error('TIKTOK_TOKEN_NOT_SELLER');
  const now=Date.now();
  return {accessToken:parsed.data.access_token,refreshToken:parsed.data.refresh_token,openId:parsed.data.open_id,scopes:parsed.data.granted_scopes??[],
    accessTokenExpiresAt:parsed.data.access_token_expire_in?new Date(now+parsed.data.access_token_expire_in*1000):null,
    refreshTokenExpiresAt:parsed.data.refresh_token_expire_in?new Date(now+parsed.data.refresh_token_expire_in*1000):null};
}

export function encryptTikTokToken(value:string,key:Buffer,keyVersion='v1'){
  if(key.length!==32)throw new Error('TIKTOK_TOKEN_KEY_INVALID');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`tiktok-shop:${keyVersion}`));
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]),tag=cipher.getAuthTag();
  return `${keyVersion}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptTikTokToken(value:string,key:Buffer){
  const [version,ivValue,tagValue,ciphertextValue,...rest]=value.split('.');
  if(!version||!ivValue||!tagValue||!ciphertextValue||rest.length||key.length!==32)throw new Error('TIKTOK_TOKEN_CIPHERTEXT_INVALID');
  try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(ivValue,'base64url'));decipher.setAAD(Buffer.from(`tiktok-shop:${version}`));decipher.setAuthTag(Buffer.from(tagValue,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue,'base64url')),decipher.final()]).toString('utf8');
  }catch{throw new Error('TIKTOK_TOKEN_CIPHERTEXT_INVALID');}
}

export type MarketplaceConnection={id:string;shopId:string;provider:'tiktok_shop';connectorEnvironment:TikTokConnectorEnvironment;
  status:'authorized'|'validated'|'action_required'|'revoked';providerOpenId:string;providerShopId:string|null;providerShopName:string|null;
  grantedScopes:string[];tokenExpiresAt:string|null;refreshTokenExpiresAt:string|null;lastValidatedAt:string|null;version:number;updatedAt:string};
type MarketplaceConnectionRow=Omit<MarketplaceConnection,'tokenExpiresAt'|'refreshTokenExpiresAt'|'lastValidatedAt'|'updatedAt'>&{
  tokenExpiresAt:Date|null;refreshTokenExpiresAt:Date|null;lastValidatedAt:Date|null;updatedAt:Date};

export async function marketplaceConnections(ctx:Context,shopId:string){
  return withTenant(ctx,async(tx,role)=>{
    if(!['owner','operator','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูการเชื่อมต่อ Marketplace');
    const rows=await tx.query<MarketplaceConnectionRow>(`SELECT id,shop_id AS "shopId",provider,connector_environment AS "connectorEnvironment",status,
      provider_open_id AS "providerOpenId",provider_shop_id AS "providerShopId",provider_shop_name AS "providerShopName",granted_scopes AS "grantedScopes",
      token_expires_at AS "tokenExpiresAt",refresh_token_expires_at AS "refreshTokenExpiresAt",last_validated_at AS "lastValidatedAt",version,updated_at AS "updatedAt"
      FROM app.marketplace_connections WHERE tenant_id=$1 AND shop_id=$2 ORDER BY updated_at DESC`,[ctx.tenantId,shopId]);
    return rows.map(row=>({...row,tokenExpiresAt:row.tokenExpiresAt?.toISOString()??null,refreshTokenExpiresAt:row.refreshTokenExpiresAt?.toISOString()??null,
      lastValidatedAt:row.lastValidatedAt?.toISOString()??null,updatedAt:row.updatedAt.toISOString()}));
  });
}

export async function assertTikTokAuthorizationTarget(ctx:Context,shopId:string){
  return withTenant(ctx,async(tx,role)=>{
    if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของบริษัทเชื่อม TikTok Shop ได้');
    const [shop]=await tx.query<{channel:string}>('SELECT channel FROM app.shops WHERE tenant_id=$1 AND id=$2',[ctx.tenantId,shopId]);
    if(!shop||shop.channel!=='tiktok')throw new AppError(400,'TIKTOK_SHOP_REQUIRED','กรุณาเลือกร้าน TikTok ก่อนเริ่มเชื่อมต่อ');
    return true;
  });
}

export async function saveTikTokSellerAuthorization(ctx:Context,shopId:string,token:TikTokSellerToken,configuration:TikTokShopConfiguration){
  if(!configuration.ready||!configuration.tokenEncryptionKey)throw new Error('TIKTOK_CONFIGURATION_INCOMPLETE');
  const encryptionKey=configuration.tokenEncryptionKey;
  try{return await withTenant(ctx,async(tx,role)=>{
    if(role!=='owner')throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของบริษัทเชื่อม TikTok Shop ได้');
    const [saved]=await tx.query<{id:string;status:'authorized';version:number}>(`SELECT id,status,version FROM app.complete_marketplace_authorization(
      $1,$2,'tiktok_shop',$3,$4,$5,$6,$7,$8,$9,'v1')`,[randomUUID(),shopId,configuration.environment,token.openId,token.scopes,
      token.accessTokenExpiresAt,token.refreshTokenExpiresAt,encryptTikTokToken(token.accessToken,encryptionKey),encryptTikTokToken(token.refreshToken,encryptionKey)]);
    return saved;
  });}catch(error){
    if(error instanceof AppError)throw error;
    if(error instanceof Error&&error.message.includes('MARKETPLACE_AUTHORIZATION_INVALID'))throw new AppError(400,'MARKETPLACE_AUTHORIZATION_INVALID','ข้อมูลการเชื่อม TikTok Shop ไม่ถูกต้อง');
    throw error;
  }
}
