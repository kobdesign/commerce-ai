import type { VerifiedAlert } from '@commerce/operations';

export type AlertBridgeConfig={environment:string;allowedSources:VerifiedAlert['source'][];signingSecret:string;
  maxBodyBytes:number;maxAgeMs:number;maxFutureSkewMs:number};

const validSources=new Set<VerifiedAlert['source']>(['commerce-runtime-monitor','commerce-agent-canary-monitor']);

function positiveInteger(value:string|undefined,fallback:number,name:string){
  if(value===undefined)return fallback;
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<=0)throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function alertBridgeConfig(env:Readonly<Record<string,string|undefined>>=process.env):AlertBridgeConfig{
  const environment=env.ALERT_BRIDGE_ENVIRONMENT?.trim();
  if(!environment||!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(environment))throw new Error('ALERT_BRIDGE_ENVIRONMENT is invalid.');
  const signingSecret=env.ALERT_BRIDGE_SIGNING_SECRET??'';
  if(signingSecret.length<32)throw new Error('ALERT_BRIDGE_SIGNING_SECRET must contain at least 32 characters.');
  const sources=(env.ALERT_BRIDGE_ALLOWED_SOURCES??'').split(',').map(value=>value.trim()).filter(Boolean);
  if(sources.length===0||sources.some(source=>!validSources.has(source as VerifiedAlert['source'])))throw new Error('ALERT_BRIDGE_ALLOWED_SOURCES is invalid.');
  return {environment,signingSecret,allowedSources:[...new Set(sources)] as VerifiedAlert['source'][],
    maxBodyBytes:positiveInteger(env.ALERT_BRIDGE_MAX_BODY_BYTES,16_384,'ALERT_BRIDGE_MAX_BODY_BYTES'),
    maxAgeMs:positiveInteger(env.ALERT_BRIDGE_MAX_AGE_MS,5*60_000,'ALERT_BRIDGE_MAX_AGE_MS'),
    maxFutureSkewMs:positiveInteger(env.ALERT_BRIDGE_MAX_FUTURE_SKEW_MS,60_000,'ALERT_BRIDGE_MAX_FUTURE_SKEW_MS')};
}
