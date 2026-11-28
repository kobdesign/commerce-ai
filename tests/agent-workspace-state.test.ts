import {describe,expect,it} from 'vitest';
import {agentWorkspaceState} from '../apps/web/lib/agent-workspace';

const tenantId='11111111-1111-4111-8111-111111111111';
const enabled={
  COMMERCE_AGENT_EVE_ENABLED:'true',
  COMMERCE_AGENT_EVE_KILL_SWITCH:'false',
  COMMERCE_AGENT_EVE_TENANT_IDS:tenantId,
};

describe('AI team workspace state',()=>{
  it('stays visibly on hold while the global safety gate is closed',()=>{
    expect(agentWorkspaceState(tenantId,{
      COMMERCE_AGENT_EVE_ENABLED:'false',
      COMMERCE_AGENT_EVE_KILL_SWITCH:'true',
    })).toMatchObject({status:'safety_hold',canStart:false,label:'ยังไม่เปิดใช้งาน'});
  });

  it('does not claim readiness when the runtime connection is incomplete',()=>{
    expect(agentWorkspaceState(tenantId,enabled)).toMatchObject({status:'setup_pending',canStart:false,label:'กำลังเชื่อมระบบ'});
  });

  it('keeps the workspace pending until the user conversation is connected',()=>{
    expect(agentWorkspaceState(tenantId,{
      ...enabled,
      COMMERCE_AGENT_EVE_URL:'https://eve.example.test',
      COMMERCE_AGENT_SESSION_KEY_ID:'staging-key-1',
      COMMERCE_AGENT_SESSION_PRIVATE_KEY:'private-key-is-kept-on-the-server',
    })).toMatchObject({status:'setup_pending',canStart:false,label:'เตรียมช่องสนทนา'});
  });

  it('allows a conversation only behind the explicit server-side gate',()=>{
    expect(agentWorkspaceState(tenantId,{
      ...enabled,
      COMMERCE_AGENT_EVE_URL:'https://eve.example.test',
      COMMERCE_AGENT_SESSION_KEY_ID:'staging-key-1',
      COMMERCE_AGENT_SESSION_PRIVATE_KEY:'private-key-is-kept-on-the-server',
      COMMERCE_AGENT_CONVERSATION_ENABLED:'true',
    })).toMatchObject({status:'ready',canStart:true,label:'พร้อมทดสอบ'});
  });

  it('keeps another tenant out of the enabled tenant route',()=>{
    expect(agentWorkspaceState('22222222-2222-4222-8222-222222222222',{
      ...enabled,
      COMMERCE_AGENT_EVE_URL:'https://eve.example.test',
      COMMERCE_AGENT_SESSION_KEY_ID:'staging-key-1',
      COMMERCE_AGENT_SESSION_PRIVATE_KEY:'private-key-is-kept-on-the-server',
    })).toMatchObject({status:'safety_hold',canStart:false});
  });

  it('uses the durable tenant policy when dynamic routing is enabled',()=>{
    expect(agentWorkspaceState(tenantId,{
      COMMERCE_AGENT_EVE_ENABLED:'true',COMMERCE_AGENT_EVE_KILL_SWITCH:'false',COMMERCE_AGENT_DYNAMIC_ROUTING:'true',
      APP_MODE:'staging-demo',COMMERCE_AGENT_EVE_URL:'https://eve.example.test',COMMERCE_AGENT_SESSION_KEY_ID:'staging-key-1',
      COMMERCE_AGENT_SESSION_PRIVATE_KEY:'private-key-is-kept-on-the-server',COMMERCE_AGENT_CONVERSATION_ENABLED:'true',
    },{status:'active',environment:'staging',expiresAt:new Date(Date.now()+60_000),version:1})).toMatchObject({status:'ready',canStart:true});
  });
});
