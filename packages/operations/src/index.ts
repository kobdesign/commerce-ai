export const deploymentModes=['local-demo','staging-demo','production'] as const;
export type DeploymentMode=typeof deploymentModes[number];
export type RuntimeService='web'|'worker'|'monitor';
export type RuntimeEnvironment=Readonly<Record<string,string|undefined>>;
export type ConfigurationCheck={key:string;status:'ok'|'blocked';message:string};
export type ConfigurationReport={status:'ok'|'blocked';mode:string;service:RuntimeService;checks:ConfigurationCheck[]};

const productionCapabilities={
  auditedIdentity:false,
  privateEvidenceStorage:false,
} as const;

function check(key:string,valid:boolean,message:string):ConfigurationCheck{
  return {key,status:valid?'ok':'blocked',message};
}

function originFor(env:RuntimeEnvironment){
  if(env.APP_ORIGIN)return env.APP_ORIGIN;
  if(env.RENDER_EXTERNAL_HOSTNAME)return `https://${env.RENDER_EXTERNAL_HOSTNAME}`;
  return null;
}

function isLoopback(url:URL){return ['127.0.0.1','localhost','::1'].includes(url.hostname);}

export function deploymentConfiguration(service:RuntimeService,env:RuntimeEnvironment=process.env):ConfigurationReport{
  const mode=env.APP_MODE??'';
  const checks:ConfigurationCheck[]=[
    check('app-mode',deploymentModes.includes(mode as DeploymentMode),'APP_MODE ต้องเป็น local-demo, staging-demo หรือ production'),
  ];
  if(service==='web'){
    const raw=originFor(env);let origin:URL|null=null;
    try{origin=raw?new URL(raw):null;}catch{origin=null;}
    const validOrigin=mode==='local-demo'
      ? Boolean(origin&&isLoopback(origin)&&['http:','https:'].includes(origin.protocol))
      : Boolean(origin&&origin.protocol==='https:');
    checks.push(check('trusted-origin',validOrigin,mode==='local-demo'?'Local web ต้องใช้ loopback origin':'Staging/production web ต้องกำหนด HTTPS origin'));
  }
  if(service==='monitor'){
    const raw=env.MONITOR_BASE_URL;let target:URL|null=null;
    try{target=raw?new URL(raw):null;}catch{target=null;}
    const targetValid=mode==='local-demo'?Boolean(target&&isLoopback(target)&&['http:','https:'].includes(target.protocol)):Boolean(target&&target.protocol==='https:');
    checks.push(check('monitor-target',targetValid,mode==='local-demo'?'Local monitor ต้องใช้ loopback target':'Monitor target ต้องใช้ HTTPS'));
    const alertConfigured=Boolean(env.MONITOR_ALERT_WEBHOOK_URL||env.MONITOR_ALERT_WEBHOOK_SECRET);
    if(mode!=='local-demo'||alertConfigured){
      let webhook:URL|null=null;try{webhook=env.MONITOR_ALERT_WEBHOOK_URL?new URL(env.MONITOR_ALERT_WEBHOOK_URL):null;}catch{webhook=null;}
      const webhookValid=mode==='local-demo'?Boolean(webhook&&(webhook.protocol==='https:'||(webhook.protocol==='http:'&&isLoopback(webhook)))):Boolean(webhook&&webhook.protocol==='https:');
      checks.push(check('alert-webhook',webhookValid,mode==='local-demo'?'Local alert webhook ต้องเป็น HTTPS หรือ loopback':'Staging/production monitor ต้องมี HTTPS alert webhook'));
      checks.push(check('alert-secret',Boolean(env.MONITOR_ALERT_WEBHOOK_SECRET&&env.MONITOR_ALERT_WEBHOOK_SECRET.length>=32),'Alert webhook secret ต้องยาวอย่างน้อย 32 ตัวอักษร'));
    }
  }
  if(mode==='staging-demo'&&service!=='monitor')checks.push(check('staging-ai-disabled',env.AI_ENABLED==='false','Staging demo ต้องปิด live AI'));
  if(mode==='production'&&service!=='monitor'){
    checks.push(check('production-identity',productionCapabilities.auditedIdentity,'ยังไม่มี audited production identity adapter'));
    checks.push(check('private-evidence-storage',productionCapabilities.privateEvidenceStorage,'ยังไม่มี private production evidence storage'));
  }
  return {status:checks.every(item=>item.status==='ok')?'ok':'blocked',mode:mode||'unset',service,checks};
}

export * from './monitoring';
export * from './production-decisions';

export function assertDeploymentConfiguration(service:RuntimeService,env:RuntimeEnvironment=process.env){
  const report=deploymentConfiguration(service,env);
  if(report.status==='blocked')throw new Error(`Deployment configuration blocked: ${report.checks.filter(item=>item.status==='blocked').map(item=>item.key).join(', ')}`);
  return report;
}
