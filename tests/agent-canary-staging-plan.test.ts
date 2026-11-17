import { readFile } from 'node:fs/promises';
import { describe,expect,test } from 'vitest';
import { agentCanaryStagingGate } from '@commerce/operations';

async function manifests(){
  const [plan,readiness]=await Promise.all([
    readFile(new URL('../config/eve-canary-staging-plan.json',import.meta.url),'utf8').then(JSON.parse),
    readFile(new URL('../config/eve-canary-readiness.json',import.meta.url),'utf8').then(JSON.parse),
  ]);return {plan,readiness};
}
function controls(id:string){
  if(id==='CANARY-IDENTITY-SECRETS')return {identityProvider:'approved-idp',secretManager:'approved-vault',rotationRehearsal:'evidence/rotation.json'};
  if(id==='CANARY-DATA-POLICY')return {allowedDataContract:'commerce-agent-read-v1',retentionPolicy:'approved-policy',providerRetentionMode:'approved-mode'};
  if(id==='CANARY-MODEL-BUDGET')return {modelAllowlist:'approved-model',monthlyBudgetUsd:10,perRunMaxInputTokens:5_000,perRunMaxOutputTokens:1_000,perRunMaxCostUsd:0.25};
  if(id==='CANARY-DYNAMIC-ROUTING')return {flagOwner:'engineering-owner',auditSink:'commerce-audit',revocationSloSeconds:60};
  if(id==='CANARY-MONITORING-SLO')return {monitorProvider:'approved-monitor',availabilitySloPercent:99,alertEvidence:'evidence/alert.json'};
  return {primaryOwner:'github:kobdesign',backupOwner:null,communicationsOwner:'github:kobdesign',runbook:'docs/runbook.md',ackTargetMinutes:15};
}
type ReadinessGate={id:string;ownerRoles:string[];[key:string]:unknown};
function approvedReadiness(input:Record<string,unknown>){const gates=input.approvalGates as ReadinessGate[];return {...input,approvalGates:gates.map(gate=>({...gate,status:'approved',selectedOption:`approved-${gate.id}`,
  controls:controls(gate.id),approvedBy:[{subject:'github:kobdesign',role:'BootstrapOwner'}],
  approvedAt:'2026-11-15T10:00:00.000Z',evidence:[`evidence/${gate.id}.json`]}))};}

describe('Eve canary staging execution gate',()=>{
  test('keeps the prepared bootstrap plan blocked by window and remaining operational preflight evidence',async()=>{
    const {plan,readiness}=await manifests(),result=agentCanaryStagingGate(plan,readiness);
    expect(result.status).toBe('blocked');expect(result.executionDecision).toBe('no-go');expect(result.errors).toEqual([]);
    expect(result.blockingConditions).not.toContain('live_turn_policy_not_implemented');
    expect(result.blockingConditions).not.toContain('monitoring_stack_not_selected');
    expect(result.blockingConditions).not.toContain('slo_profile_not_selected');
    expect(result.blockingConditions).not.toContain('synthetic_tenant_not_selected');
    expect(result.blockingConditions).not.toContain('preflight_evidence_missing:rollbackRehearsal');
    expect(result.blockingConditions).not.toContain('preflight_evidence_missing:liveTurnPolicyTest');
    expect(result.blockingConditions).not.toContain('incident_owners_missing');
    expect(result.blockingConditions).not.toContain('bootstrap_owner_not_assigned');
    expect(result.blockingConditions).toContain('canary_window_not_scheduled');
    expect(result.blockingConditions).not.toContain('readiness:CANARY-MONITORING-SLO');
    expect(result.blockingConditions).not.toContain('preflight_evidence_missing:providerRetentionConfirmation');
    expect(result.blockingConditions).not.toContain('preflight_evidence_missing:stagingSecretProvisioning');
    expect(plan.syntheticTenantId).toBe('20000000-0000-4000-8000-000000000001');
    expect(result.selectedOptions).toEqual({monitoringStack:'hybrid-external-primary-v1',sloProfile:'strict-internal-canary-v1'});
    expect(result.runtimeCapabilities).toMatchObject({liveTurnsImplemented:true,commerceMutationsEnabled:false,productionTenantDataEnabled:false});
  });

  test('rejects a selected option that is not in the reviewed decision pack',async()=>{
    const {plan,readiness}=await manifests();plan.selectedOptions.monitoringStack='unknown-provider';
    const result=agentCanaryStagingGate(plan,readiness);
    expect(result.status).toBe('blocked');expect(result.errors).toContain('Selected monitoring option does not exist.');
  });

  test('rejects a monitoring option that the decision pack marks insufficient on its own',async()=>{
    const {plan,readiness}=await manifests();plan.selectedOptions.monitoringStack='platform-native-only-v1';
    const result=agentCanaryStagingGate(plan,readiness);
    expect(result.status).toBe('blocked');
    expect(result.errors).toContain('Selected monitoring option is explicitly insufficient as a standalone canary control.');
  });

  test('would allow only a complete hypothetical plan with all six independent approvals and capability evidence',async()=>{
    const {plan,readiness}=await manifests();
    Object.assign(plan,{status:'approved',executionEnabled:true,syntheticTenantId:'11111111-1111-4111-8111-111111111111'});
    plan.selectedOptions={monitoringStack:'hybrid-external-primary-v1',sloProfile:'strict-internal-canary-v1'};
    plan.incidentOwnership={primaryOwner:'github:kobdesign',backupOwner:null,communicationsOwner:'github:kobdesign'};
    plan.window={startsAt:'2026-11-20T02:00:00.000Z',endsAt:'2026-11-20T04:00:00.000Z',changeTicket:'CHG-001'};
    plan.runtimeCapabilities.liveTurnsImplemented=true;
    plan.preflightEvidence={approvalRecord:'evidence/approvals.json',providerRetentionConfirmation:'evidence/provider-retention.json',
      stagingSecretProvisioning:'evidence/staging-secrets.json',alertDeliveryDryRun:'evidence/alert.json',ownerAcknowledgement:'evidence/ack.json',
      rollbackRehearsal:'docs/evidence/eve-canary-incident-rehearsal-latest.json',liveTurnPolicyTest:'evidence/live-turn-policy.json',changeTicket:'CHG-001'};
    const result=agentCanaryStagingGate(plan,approvedReadiness(readiness));
    expect(result.status).toBe('approved');expect(result.executionDecision).toBe('go');expect(result.blockingConditions).toEqual([]);expect(result.errors).toEqual([]);
  });
});
