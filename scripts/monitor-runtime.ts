import { assertDeploymentConfiguration,deliverRuntimeAlert,observeRuntime,runtimeAlert,RuntimeTransitionTracker } from '@commerce/operations';

assertDeploymentConfiguration('monitor');
const baseUrl=process.env.MONITOR_BASE_URL as string;
const environment=process.env.MONITOR_ENVIRONMENT?.trim()||process.env.APP_MODE||'unknown';
const webhookUrl=process.env.MONITOR_ALERT_WEBHOOK_URL;
const webhookSecret=process.env.MONITOR_ALERT_WEBHOOK_SECRET;
const integer=(name:string,fallback:number,min:number,max:number)=>{
  const value=Number(process.env[name]??fallback);if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be an integer from ${min} to ${max}.`);return value;
};
const intervalMs=integer('MONITOR_INTERVAL_SECONDS',30,10,300)*1000;
const timeoutMs=integer('MONITOR_TIMEOUT_MS',5000,500,15000);
const tracker=new RuntimeTransitionTracker(integer('MONITOR_FAILURE_THRESHOLD',2,1,10),integer('MONITOR_RECOVERY_THRESHOLD',2,1,10));
const pending:ReturnType<typeof runtimeAlert>[]=[];
let stopping=false,wake:undefined|(()=>void);
function pause(duration:number){return new Promise<void>(resolve=>{const timer=setTimeout(()=>{wake=undefined;resolve();},duration);wake=()=>{clearTimeout(timer);wake=undefined;resolve();};});}

async function deliverPending(){
  const alert=pending[0];if(!alert)return;
  if(webhookUrl&&webhookSecret){
    try{const result=await deliverRuntimeAlert(alert,webhookUrl,webhookSecret);console.log(JSON.stringify({type:'alert-delivered',eventId:alert.eventId,status:alert.status,attempts:result.attempts}));pending.shift();}
    catch{console.error(JSON.stringify({type:'alert-delivery-failed',eventId:alert.eventId,status:alert.status}));}
  }else{
    console.log(JSON.stringify({type:'local-alert',alert}));pending.shift();
  }
}

async function check(){
  const observation=await observeRuntime(baseUrl,{timeoutMs});
  console.log(JSON.stringify({type:'runtime-observation',environment,...observation}));
  const transition=tracker.observe(observation);
  if(transition)pending.push(runtimeAlert(environment,transition,observation));
  await deliverPending();
  return observation;
}

for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;wake?.();});
if(process.argv.includes('--once')){
  const observation=await check();if(observation.status!=='healthy')process.exitCode=1;
}else{
  console.log(JSON.stringify({type:'monitor-started',environment,intervalSeconds:intervalMs/1000}));
  while(!stopping){await check();if(!stopping)await pause(intervalMs);}
}
