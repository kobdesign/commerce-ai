import { createHmac } from 'node:crypto';
import { describe,expect,test } from 'vitest';
import {
  SyntheticCobrowsingAdapter,
  SupportPolicyError,
  applySyntheticWebhook,
  claimSupportSession,
  consentToSupportSession,
  endSupportSession,
  requestSupportSession,
  revalidateSupportSession,
  supportSensitiveSelectors,
  validateSupportPolicy,
  verifySyntheticWebhook,
  type SupportPolicy,
} from '@commerce/support';

const start=new Date('2026-09-27T10:00:00.000Z');
const policy:SupportPolicy={
  enabled:true,killSwitch:false,allowedOrigins:['https://app.example.test'],allowedPageClasses:['catalog','imports','settlements','reviews'],ttlMs:10*60_000,
  codePepper:'synthetic-poc-pepper-not-production',privateByDefault:true,maskedSelectors:[...supportSensitiveSelectors],
};
const request=(overrides:Partial<Parameters<typeof requestSupportSession>[0]>={})=>requestSupportSession({tenantId:'tenant-a',customerUserId:'customer-a',caseId:'case-a',assignedAgentId:'agent-a',origin:'https://app.example.test',pageClass:'catalog',oneTimeCode:'123456',policyVersion:'support-poc-v1',...overrides},policy,start);
async function ready(adapter=new SyntheticCobrowsingAdapter()){
  return {adapter,session:await consentToSupportSession(request(),true,policy,adapter,start)};
}
async function active(adapter=new SyntheticCobrowsingAdapter()){
  const prepared=await ready(adapter);
  return {...prepared,session:await claimSupportSession(prepared.session,{tenantId:'tenant-a',caseId:'case-a',agentId:'agent-a',oneTimeCode:'123456'},policy,adapter,start)};
}
async function rejectsCode(run:()=>unknown|Promise<unknown>,code:string){
  await expect(Promise.resolve().then(run)).rejects.toMatchObject<Partial<SupportPolicyError>>({code});
}

describe('synthetic co-browsing boundary',()=>{
  test('SUP-T01 does not create a vendor session before explicit consent',async()=>{
    const adapter=new SyntheticCobrowsingAdapter(),session=request();
    expect(session.state).toBe('awaiting_consent');expect(adapter.created).toHaveLength(0);
    await rejectsCode(()=>consentToSupportSession(session,false,policy,adapter,start),'CONSENT_REQUIRED');
    expect(adapter.created).toHaveLength(0);
  });

  test('SUP-T02 consumes the six-digit code once and rejects replay or expiry',async()=>{
    const {adapter,session}=await ready();
    const claimed=await claimSupportSession(session,{tenantId:'tenant-a',caseId:'case-a',agentId:'agent-a',oneTimeCode:'123456'},policy,adapter,start);
    expect(claimed).toMatchObject({state:'active',codeConsumedAt:start.toISOString()});
    await rejectsCode(()=>claimSupportSession(claimed,{tenantId:'tenant-a',caseId:'case-a',agentId:'agent-a',oneTimeCode:'123456'},policy,adapter,start),'CODE_ALREADY_USED');
    const expired={...(await ready(new SyntheticCobrowsingAdapter())).session,expiresAt:'2026-09-27T09:59:59.000Z'};
    await rejectsCode(()=>claimSupportSession(expired,{tenantId:'tenant-a',caseId:'case-a',agentId:'agent-a',oneTimeCode:'123456'},policy,adapter,start),'SESSION_EXPIRED');
  });

  test('SUP-T03 rejects tenant, case and assigned-agent mismatches before vendor claim',async()=>{
    const {adapter,session}=await ready();
    await rejectsCode(()=>claimSupportSession(session,{tenantId:'tenant-b',caseId:'case-a',agentId:'agent-a',oneTimeCode:'123456'},policy,adapter,start),'SCOPE_MISMATCH');
    await rejectsCode(()=>claimSupportSession(session,{tenantId:'tenant-a',caseId:'case-b',agentId:'agent-a',oneTimeCode:'123456'},policy,adapter,start),'SCOPE_MISMATCH');
    await rejectsCode(()=>claimSupportSession(session,{tenantId:'tenant-a',caseId:'case-a',agentId:'agent-b',oneTimeCode:'123456'},policy,adapter,start),'SCOPE_MISMATCH');
    expect(adapter.claimed).toHaveLength(0);
  });

  test('SUP-T04 requires private-by-default and every sensitive selector',()=>{
    expect(validateSupportPolicy(policy)).toEqual({valid:true,errors:[]});
    const missing={...policy,maskedSelectors:policy.maskedSelectors.filter(selector=>selector!=='[data-support-evidence]')};
    expect(validateSupportPolicy(missing)).toMatchObject({valid:false,errors:['Missing sensitive selector [data-support-evidence].']});
  });

  test('SUP-T05 ends an active session when membership is revoked',async()=>{
    const {adapter,session}=await active();
    const ended=await revalidateSupportSession(session,{tenantId:'tenant-a',origin:session.origin,pageClass:session.pageClass,membershipActive:false},policy,adapter,start);
    expect(ended).toMatchObject({state:'ended',endReason:'access_revoked'});expect(adapter.ended).toHaveLength(1);
  });

  test('SUP-T06 rejects non-HTTPS/unlisted origins and ends on scope change',async()=>{
    expect(()=>request({origin:'http://app.example.test'})).toThrowError(SupportPolicyError);
    const {adapter,session}=await active(),ended=await revalidateSupportSession(session,{tenantId:'tenant-a',origin:session.origin,pageClass:'imports',membershipActive:true},policy,adapter,start);
    expect(ended).toMatchObject({state:'ended',endReason:'scope_changed'});
  });

  test('SUP-T07 sends a view-only contract with recording and controls disabled',async()=>{
    const {adapter}=await ready();
    expect(adapter.created[0]).toMatchObject({mode:'view_only',privateByDefault:true,recording:false,remoteControl:false,fullDeviceSharing:false});
  });

  test('SUP-T08 verifies signed webhooks, rejects mismatched sessions and deduplicates events',async()=>{
    const {adapter,session}=await active(),secret='synthetic-webhook-secret',event={eventId:'event-1',vendorSessionId:session.vendorSessionId!,type:'session.ended' as const,occurredAt:'2026-09-27T10:01:00.000Z'},payload=JSON.stringify(event);
    const signature=createHmac('sha256',secret).update(payload).digest('hex');
    expect(verifySyntheticWebhook(payload,signature,secret)).toBe(true);expect(verifySyntheticWebhook(payload,'0'.repeat(64),secret)).toBe(false);
    const processed=new Set<string>(),first=await applySyntheticWebhook(session,event,processed,adapter),second=await applySyntheticWebhook(first.session,event,processed,adapter);
    expect(first).toMatchObject({duplicate:false,session:{state:'ended',endReason:'vendor_ended'}});expect(second.duplicate).toBe(true);
    await rejectsCode(()=>applySyntheticWebhook(session,{...event,eventId:'event-2',vendorSessionId:'other'},processed,adapter),'VENDOR_SESSION_MISMATCH');
  });

  test('SUP-T09 blocks new sessions and ends active sessions when kill switch is on',async()=>{
    const disabled={...policy,killSwitch:true};expect(()=>requestSupportSession({tenantId:'tenant-a',customerUserId:'customer-a',caseId:'case-a',assignedAgentId:'agent-a',origin:'https://app.example.test',pageClass:'catalog',oneTimeCode:'123456',policyVersion:'support-poc-v1'},disabled,start)).toThrowError(SupportPolicyError);
    const {adapter,session}=await active(),ended=await revalidateSupportSession(session,{tenantId:'tenant-a',origin:session.origin,pageClass:session.pageClass,membershipActive:true},disabled,adapter,start);
    expect(ended).toMatchObject({state:'ended',endReason:'kill_switch'});
  });

  test('customer stop is idempotent and never asks the vendor to end twice',async()=>{
    const {adapter,session}=await active(),once=await endSupportSession(session,'customer_stopped',adapter,start),twice=await endSupportSession(once,'customer_stopped',adapter,start);
    expect(twice).toEqual(once);expect(adapter.ended).toHaveLength(1);
  });

  test('does not store the one-time code in the session record',()=>{
    const session=request();expect(JSON.stringify(session)).not.toContain('123456');expect(session.codeHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
