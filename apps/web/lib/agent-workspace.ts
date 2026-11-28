import {readAgentRouteConfiguration,resolveAgentRoute,resolveDynamicAgentRoute,type AgentRouteReason,type DynamicAgentRoutePolicy} from '@commerce/agent-routing';

export type AgentWorkspaceStatus='safety_hold'|'setup_pending'|'ready';
export type AgentWorkspaceState={
  status:AgentWorkspaceStatus;
  canStart:boolean;
  label:string;
  message:string;
};

const waitingMessages:Record<AgentRouteReason,string>={
  global_disabled:'ทีม AI ยังไม่ถูกเปิดให้ใช้งานบนระบบทดสอบ',
  kill_switch:'ทีม AI ถูกพักไว้ด้วยสวิตช์ความปลอดภัย',
  tenant_not_enabled:'ร้านนี้ยังไม่อยู่ในรอบทดสอบทีม AI',
  tenant_enabled:'ร้านนี้ผ่านเงื่อนไขเบื้องต้นสำหรับทีม AI',
  dynamic_policy_missing:'ร้านนี้ยังไม่มีสิทธิ์เข้าร่วมรอบทดสอบทีม AI',
  dynamic_policy_pending:'สิทธิ์ใช้งานทีม AI ของร้านนี้กำลังรออนุมัติ',
  dynamic_policy_revoked:'สิทธิ์ใช้งานทีม AI ของร้านนี้ถูกยกเลิก',
  dynamic_policy_expired:'สิทธิ์ใช้งานทีม AI ของร้านนี้หมดอายุแล้ว',
  dynamic_environment_mismatch:'สิทธิ์ใช้งานทีม AI ไม่ตรงกับระบบทดสอบนี้',
  dynamic_tenant_enabled:'ร้านนี้ผ่านเงื่อนไขเบื้องต้นสำหรับทีม AI',
};

/** Returns only user-safe operational state. Secrets and internal URLs never cross the server boundary. */
export function agentWorkspaceState(
  tenantId:string,
  env:Readonly<Record<string,string|undefined>>=process.env,
  dynamicPolicy:DynamicAgentRoutePolicy|null=null,
):AgentWorkspaceState{
  let configuration;
  try{configuration=readAgentRouteConfiguration(env);}
  catch{return {status:'setup_pending',canStart:false,label:'กำลังตั้งค่าระบบ',message:'การตั้งค่าทีม AI ยังไม่สมบูรณ์ ผู้ดูแลระบบกำลังตรวจสอบ'};}

  const dynamic=env.COMMERCE_AGENT_DYNAMIC_ROUTING==='true';
  const environment=env.APP_MODE==='staging-demo'?'staging':'development';
  const route=dynamic
    ?(!configuration.eveEnabled?resolveAgentRoute(tenantId,configuration)
      :configuration.killSwitch?resolveAgentRoute(tenantId,configuration)
      :resolveDynamicAgentRoute(tenantId,environment,dynamicPolicy))
    :resolveAgentRoute(tenantId,configuration);
  if(route.engine!=='eve'){
    return {status:'safety_hold',canStart:false,label:'ยังไม่เปิดใช้งาน',message:waitingMessages[route.reason]};
  }

  const runtimeReady=Boolean(env.COMMERCE_AGENT_EVE_URL?.trim());
  const sessionReady=Boolean(env.COMMERCE_AGENT_SESSION_KEY_ID?.trim()&&env.COMMERCE_AGENT_SESSION_PRIVATE_KEY?.trim());
  if(!runtimeReady||!sessionReady){
    return {status:'setup_pending',canStart:false,label:'กำลังเชื่อมระบบ',message:'ร้านนี้ได้รับสิทธิ์แล้ว แต่การเชื่อมต่อทีม AI ยังไม่สมบูรณ์'};
  }

  if(env.COMMERCE_AGENT_CONVERSATION_ENABLED==='true'){
    return {status:'ready',canStart:true,label:'พร้อมทดสอบ',message:'ช่องสนทนาผูกกับบริษัท ร้าน และผู้ใช้ที่เข้าสู่ระบบแล้ว'};
  }

  return {status:'setup_pending',canStart:false,label:'เตรียมช่องสนทนา',message:'การกำหนดสิทธิ์และการเชื่อม runtime พร้อมแล้ว ขั้นต่อไปคือเปิดช่องสนทนาที่ผูกกับร้านนี้'};
}
