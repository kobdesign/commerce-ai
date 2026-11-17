import {
  commerceCanaryHardLimits,
  commerceCanaryModelId,
} from './canary-policy-constants.ts';

export type PocRuntimeEnvironment = 'local' | 'preview';
export type CanaryRole = 'owner' | 'finance' | 'operator' | 'marketing' | 'auditor';
type Environment = Readonly<Record<string, string | undefined>>;

export interface CanaryUsageLimits {
  maxNewInputTokens: number;
  maxOutputTokens: number;
  maxCostUsd: number;
}
export interface DisabledRuntimePolicy {
  environment: PocRuntimeEnvironment;
  expiresAt: null;
  liveAiEnabled: false;
  mode: 'disabled';
  modelId: null;
  usageLimits: null;
}
export interface EnabledCanaryRuntimePolicy {
  allowedRoles: CanaryRole[];
  approvalId: string;
  environment: 'preview';
  expiresAt: Date;
  liveAiEnabled: true;
  mode: 'staging-canary';
  modelId: typeof commerceCanaryModelId;
  shopIds: string[];
  tenantId: string;
  usageLimits: CanaryUsageLimits;
}
export type PocRuntimePolicy = DisabledRuntimePolicy | EnabledCanaryRuntimePolicy;

const forbiddenCredentialNames = [
  'DATABASE_URL','ADMIN_DATABASE_URL','IDENTITY_DATABASE_URL','QUEUE_DATABASE_URL',
  'OPENAI_API_KEY','ANTHROPIC_API_KEY','AI_GATEWAY_API_KEY',
  'TIKTOK_SHOP_APP_SECRET','TIKTOK_SHOP_TOKEN_ENCRYPTION_KEY',
  'COMMERCE_AGENT_SESSION_PRIVATE_KEY',
] as const;
const commerceReadConfiguration = [
  'COMMERCE_CORE_URL','COMMERCE_CORE_ENVIRONMENT','COMMERCE_AGENT_TENANT_ID','COMMERCE_AGENT_CREDENTIAL',
] as const;
const commerceSessionConfiguration = ['COMMERCE_SESSION_KEY_ID','COMMERCE_SESSION_PUBLIC_KEY'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canaryRoles = new Set<CanaryRole>(['owner','finance','operator','marketing','auditor']);

function uniqueList(value:string|undefined,name:string):string[]{
  const values=(value??'').split(',').map(item=>item.trim()).filter(Boolean);
  if(values.length===0||new Set(values).size!==values.length){
    throw new Error(`${name} must contain a non-empty unique comma-separated list.`);
  }
  return values;
}
function boundedNumber(value:string|undefined,name:string,minimum:number,maximum:number):number{
  const parsed=Number(value);
  if(!Number.isFinite(parsed)||parsed<minimum||parsed>maximum){
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
function validateBaseRuntime(env:Environment):PocRuntimeEnvironment{
  const environment=env.COMMERCE_AGENT_ENV;
  if(environment!=='local'&&environment!=='preview')throw new Error('COMMERCE_AGENT_ENV must be local or preview.');
  if(env.VERCEL_ENV==='production')throw new Error('Commerce Agent Runtime cannot run in a Vercel production environment.');
  const exposed=forbiddenCredentialNames.filter(name=>Boolean(env[name]?.trim()));
  if(exposed.length>0)throw new Error(`Commerce Agent Runtime forbids production-capable credentials: ${exposed.join(', ')}.`);
  return environment;
}
function validateCommerceConfiguration(env:Environment,environment:PocRuntimeEnvironment):void{
  const configuredCommerce=commerceReadConfiguration.filter(name=>Boolean(env[name]?.trim()));
  if(configuredCommerce.length>0&&configuredCommerce.length!==commerceReadConfiguration.length){
    throw new Error('Commerce read-only configuration must be provided as one complete set.');
  }
  if(configuredCommerce.length===commerceReadConfiguration.length){
    const expected=environment==='local'?'development':'staging';
    if(env.COMMERCE_CORE_ENVIRONMENT!==expected)throw new Error(`COMMERCE_CORE_ENVIRONMENT must be ${expected} for this runtime environment.`);
    if(!/^svc_[A-Za-z0-9_-]{43}$/.test(env.COMMERCE_AGENT_CREDENTIAL!))throw new Error('COMMERCE_AGENT_CREDENTIAL must use the read-only service credential format.');
    if(!uuidPattern.test(env.COMMERCE_AGENT_TENANT_ID!))throw new Error('COMMERCE_AGENT_TENANT_ID must be a UUID.');
    const coreUrl=new URL(env.COMMERCE_CORE_URL!);
    const allowedLocal=environment==='local'&&coreUrl.protocol==='http:'&&['localhost','127.0.0.1'].includes(coreUrl.hostname);
    if(coreUrl.protocol!=='https:'&&!allowedLocal)throw new Error('COMMERCE_CORE_URL must use HTTPS outside local execution.');
  }
  const configuredSession=commerceSessionConfiguration.filter(name=>Boolean(env[name]?.trim()));
  if(configuredSession.length>0&&configuredSession.length!==commerceSessionConfiguration.length){
    throw new Error('Commerce session verification configuration must be provided as one complete set.');
  }
  if(configuredSession.length===commerceSessionConfiguration.length){
    if(!/^[A-Za-z0-9._-]{1,80}$/.test(env.COMMERCE_SESSION_KEY_ID!))throw new Error('COMMERCE_SESSION_KEY_ID format is invalid.');
    if(!/^[A-Za-z0-9_-]{40,}$/.test(env.COMMERCE_SESSION_PUBLIC_KEY!))throw new Error('COMMERCE_SESSION_PUBLIC_KEY must be a base64url SPKI key.');
  }
}

export function readPocRuntimePolicy(env:Environment,now=new Date()):PocRuntimePolicy{
  const environment=validateBaseRuntime(env);
  const liveAi=env.COMMERCE_AGENT_LIVE_AI;
  if(liveAi!=='false'&&liveAi!=='true')throw new Error('COMMERCE_AGENT_LIVE_AI must be explicitly set to false or true.');
  validateCommerceConfiguration(env,environment);
  if(liveAi==='false')return {environment,expiresAt:null,liveAiEnabled:false,mode:'disabled',modelId:null,usageLimits:null};

  if(environment!=='preview'||env.VERCEL_ENV!=='preview')throw new Error('Live AI is allowed only in a Vercel Preview environment.');
  if(env.COMMERCE_AGENT_CANARY_MODE!=='approved-staging')throw new Error('COMMERCE_AGENT_CANARY_MODE must be approved-staging.');
  const approvalId=env.COMMERCE_AGENT_CANARY_APPROVAL_ID?.trim();
  if(!approvalId||!/^[A-Za-z0-9._-]{3,80}$/.test(approvalId))throw new Error('COMMERCE_AGENT_CANARY_APPROVAL_ID is required and has an invalid format.');
  if(commerceReadConfiguration.some(name=>!env[name]?.trim())||commerceSessionConfiguration.some(name=>!env[name]?.trim())){
    throw new Error('Live AI requires complete Commerce read-only and session verification configuration.');
  }
  const models=uniqueList(env.COMMERCE_AGENT_MODEL_ALLOWLIST,'COMMERCE_AGENT_MODEL_ALLOWLIST');
  if(models.length!==1||models[0]!==commerceCanaryModelId)throw new Error(`COMMERCE_AGENT_MODEL_ALLOWLIST must contain only ${commerceCanaryModelId}.`);
  const shopIds=uniqueList(env.COMMERCE_AGENT_CANARY_SHOP_IDS,'COMMERCE_AGENT_CANARY_SHOP_IDS');
  if(shopIds.length>20||shopIds.some(id=>!uuidPattern.test(id)))throw new Error('COMMERCE_AGENT_CANARY_SHOP_IDS must contain 1 to 20 UUIDs.');
  const roles=uniqueList(env.COMMERCE_AGENT_CANARY_ALLOWED_ROLES,'COMMERCE_AGENT_CANARY_ALLOWED_ROLES');
  if(roles.some(role=>!canaryRoles.has(role as CanaryRole)))throw new Error('COMMERCE_AGENT_CANARY_ALLOWED_ROLES contains an unsupported role.');
  const expiresAt=new Date(env.COMMERCE_AGENT_CANARY_EXPIRES_AT??'');
  const durationMs=expiresAt.getTime()-now.getTime();
  if(!Number.isFinite(expiresAt.getTime())||durationMs<=0||durationMs>4*60*60*1_000){
    throw new Error('COMMERCE_AGENT_CANARY_EXPIRES_AT must be in the future and no more than four hours away.');
  }
  const usageLimits={
    maxNewInputTokens:boundedNumber(env.COMMERCE_AGENT_MAX_NEW_INPUT_TOKENS,'COMMERCE_AGENT_MAX_NEW_INPUT_TOKENS',100,commerceCanaryHardLimits.maxNewInputTokens),
    maxOutputTokens:boundedNumber(env.COMMERCE_AGENT_MAX_OUTPUT_TOKENS,'COMMERCE_AGENT_MAX_OUTPUT_TOKENS',100,commerceCanaryHardLimits.maxOutputTokens),
    maxCostUsd:boundedNumber(env.COMMERCE_AGENT_MAX_COST_USD,'COMMERCE_AGENT_MAX_COST_USD',0.001,commerceCanaryHardLimits.maxCostUsd),
  };
  return {allowedRoles:roles as CanaryRole[],approvalId,environment,expiresAt,liveAiEnabled:true,mode:'staging-canary',modelId:commerceCanaryModelId,
    shopIds,tenantId:env.COMMERCE_AGENT_TENANT_ID!,usageLimits};
}

export function agentUsageLimits(env:Environment,hardLimits:CanaryUsageLimits,now=new Date()):CanaryUsageLimits{
  const policy=readPocRuntimePolicy(env,now);
  if(!policy.liveAiEnabled)return hardLimits;
  return {
    maxNewInputTokens:Math.min(hardLimits.maxNewInputTokens,policy.usageLimits.maxNewInputTokens),
    maxOutputTokens:Math.min(hardLimits.maxOutputTokens,policy.usageLimits.maxOutputTokens),
    maxCostUsd:Math.min(hardLimits.maxCostUsd,policy.usageLimits.maxCostUsd),
  };
}
export function assertPocRuntimePolicy(env:Environment):PocRuntimePolicy{return readPocRuntimePolicy(env);}
