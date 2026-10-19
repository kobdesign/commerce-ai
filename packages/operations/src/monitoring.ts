import { createHmac,randomUUID } from 'node:crypto';

export type ProbeStatus='ok'|'unavailable';
export type ProbeResult={status:ProbeStatus;httpStatus:number|null;reason:'none'|'http'|'timeout'|'network'|'invalid-response'};
export type RuntimeObservation={status:'healthy'|'unavailable';observedAt:string;health:ProbeResult;readiness:ProbeResult&{checks?:Record<string,'ok'|'unavailable'>}};
export type RuntimeAlert={schemaVersion:'1';eventId:string;source:'commerce-runtime-monitor';environment:string;status:'unavailable'|'recovered';observedAt:string;checks:{health:ProbeResult;readiness:ProbeResult&{checks?:Record<string,'ok'|'unavailable'>}}};
type Fetcher=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;
const readinessKeys=['configuration','applicationDatabase','identityDatabase','worker','importQueue'] as const;

async function probe(baseUrl:string,path:'/api/health'|'/api/ready',timeoutMs:number,fetcher:Fetcher){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetcher(new URL(path,baseUrl),{headers:{accept:'application/json'},cache:'no-store',signal:controller.signal});
    const text=await response.text();
    if(text.length>4096)return {result:{status:'unavailable',httpStatus:response.status,reason:'invalid-response'} as ProbeResult};
    let body:unknown;
    try{body=JSON.parse(text);}catch{return {result:{status:'unavailable',httpStatus:response.status,reason:'invalid-response'} as ProbeResult};}
    if(!body||typeof body!=='object'||!('status' in body)||!['ok','unavailable'].includes(String(body.status))){
      return {result:{status:'unavailable',httpStatus:response.status,reason:'invalid-response'} as ProbeResult};
    }
    const ok=response.ok&&body.status==='ok';
    return {result:{status:ok?'ok':'unavailable',httpStatus:response.status,reason:ok?'none':'http'} as ProbeResult,body};
  }catch(error){
    const timeout=error instanceof Error&&error.name==='AbortError';
    return {result:{status:'unavailable',httpStatus:null,reason:timeout?'timeout':'network'} as ProbeResult};
  }finally{clearTimeout(timer);}
}

export async function observeRuntime(baseUrl:string,options:{timeoutMs?:number;fetcher?:Fetcher;now?:()=>Date}={}):Promise<RuntimeObservation>{
  const timeoutMs=options.timeoutMs??5000,fetcher=options.fetcher??fetch,now=options.now??(()=>new Date());
  const [healthProbe,readinessProbe]=await Promise.all([
    probe(baseUrl,'/api/health',timeoutMs,fetcher),
    probe(baseUrl,'/api/ready',timeoutMs,fetcher),
  ]);
  const checks:Record<string,'ok'|'unavailable'>={};
  const raw=readinessProbe.body&&typeof readinessProbe.body==='object'&&'checks' in readinessProbe.body?readinessProbe.body.checks:null;
  if(raw&&typeof raw==='object')for(const key of readinessKeys){
    const value=(raw as Record<string,unknown>)[key];if(value==='ok'||value==='unavailable')checks[key]=value;
  }
  const readiness={...readinessProbe.result,...(Object.keys(checks).length?{checks}: {})};
  return {
    status:healthProbe.result.status==='ok'&&readiness.status==='ok'?'healthy':'unavailable',
    observedAt:now().toISOString(),health:healthProbe.result,readiness,
  };
}

export class RuntimeTransitionTracker{
  private state:'unknown'|'healthy'|'unavailable'='unknown';
  private consecutiveHealthy=0;
  private consecutiveUnavailable=0;
  constructor(private readonly failureThreshold=2,private readonly recoveryThreshold=2){
    if(!Number.isInteger(failureThreshold)||failureThreshold<1||!Number.isInteger(recoveryThreshold)||recoveryThreshold<1)throw new Error('Monitor thresholds must be positive integers.');
  }
  observe(observation:RuntimeObservation):'unavailable'|'recovered'|null{
    if(observation.status==='healthy'){
      this.consecutiveHealthy++;this.consecutiveUnavailable=0;
      if(this.state==='unknown'){this.state='healthy';return null;}
      if(this.state==='unavailable'&&this.consecutiveHealthy>=this.recoveryThreshold){this.state='healthy';return 'recovered';}
      return null;
    }
    this.consecutiveUnavailable++;this.consecutiveHealthy=0;
    if(this.state!=='unavailable'&&this.consecutiveUnavailable>=this.failureThreshold){this.state='unavailable';return 'unavailable';}
    return null;
  }
}

export function runtimeAlert(environment:string,status:'unavailable'|'recovered',observation:RuntimeObservation):RuntimeAlert{
  return {schemaVersion:'1',eventId:randomUUID(),source:'commerce-runtime-monitor',environment,status,observedAt:observation.observedAt,checks:{health:observation.health,readiness:observation.readiness}};
}

export function signAlert(body:string,timestamp:string,secret:string){
  return `sha256=${createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export async function deliverRuntimeAlert(alert:RuntimeAlert,url:string,secret:string,options:{fetcher?:Fetcher;attempts?:number;backoffMs?:number}={}){
  const fetcher=options.fetcher??fetch,attempts=options.attempts??3,backoffMs=options.backoffMs??250;
  const body=JSON.stringify(alert),timestamp=alert.observedAt,signature=signAlert(body,timestamp,secret);
  let lastStatus:number|null=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json','x-commerce-event-id':alert.eventId,'x-commerce-event-timestamp':timestamp,'x-commerce-signature':signature},body,signal:AbortSignal.timeout(5000)});
      lastStatus=response.status;if(response.ok)return {attempts:attempt};
    }catch{lastStatus=null;}
    if(attempt<attempts&&backoffMs>0)await new Promise(resolve=>setTimeout(resolve,backoffMs*2**(attempt-1)));
  }
  throw new Error(`Alert delivery failed after ${attempts} attempts${lastStatus===null?'':` (HTTP ${lastStatus})`}.`);
}
