import { readFile } from 'node:fs/promises';
import { describe,expect,test } from 'vitest';
import {
  agentCanaryReadinessGate,
  requiredCanaryApprovalGateIds,
  requiredCanaryTechnicalGateIds,
} from '@commerce/operations';

async function manifest(){return JSON.parse(await readFile(new URL('../config/eve-canary-readiness.json',import.meta.url),'utf8'));}

function controls(id:string){
  if(id==='CANARY-IDENTITY-SECRETS')return {identityProvider:'approved-idp',secretManager:'approved-secret-manager',rotationRehearsal:'docs/evidence/rotation.md'};
  if(id==='CANARY-DATA-POLICY')return {allowedDataContract:'commerce-agent-read-v1',retentionPolicy:'approved-ai-retention-v1',providerRetentionMode:'approved-mode'};
  if(id==='CANARY-MODEL-BUDGET')return {modelAllowlist:'approved-model-v1',monthlyBudgetUsd:100,perRunMaxInputTokens:4000,perRunMaxOutputTokens:1000,perRunMaxCostUsd:0.5};
  if(id==='CANARY-DYNAMIC-ROUTING')return {flagOwner:'platform-owner',auditSink:'durable-audit-v1',revocationSloSeconds:60};
  if(id==='CANARY-MONITORING-SLO')return {monitorProvider:'approved-monitor',availabilitySloPercent:99,alertEvidence:'docs/evidence/alert.md'};
  if(id==='CANARY-INCIDENT-OWNERSHIP')return {primaryOwner:'github:kobdesign',backupOwner:null,communicationsOwner:'github:kobdesign',runbook:'docs/runbook.md',ackTargetMinutes:15};
  throw new Error(`Unknown gate ${id}`);
}

describe('Eve read-only canary readiness gate',()=>{
  test('accepts the owner-approved bootstrap controls while keeping production no-go',async()=>{
    const report=agentCanaryReadinessGate(await manifest());
    expect(report).toMatchObject({status:'approved',productionDecision:'no-go',errors:[],technicalReady:true,approvalsReady:true,blockingGates:[],
      governance:{mode:'bootstrap-single-owner',ownerSubject:'github:kobdesign'}});
    expect(report.technicalGates.map(gate=>gate.id)).toEqual(requiredCanaryTechnicalGateIds);
    expect(report.approvalGates.map(gate=>gate.id)).toEqual(requiredCanaryApprovalGateIds);
    expect(report.approvalGates.every(gate=>gate.status==='approved')).toBe(true);
  });

  test('rejects an approved label without the configured bootstrap owner, evidence and concrete controls',async()=>{
    const value=await manifest();
    value.approvalGates=value.approvalGates.map((gate:{id:string;ownerRoles:string[]})=>({...gate,status:'approved',selectedOption:'selected',
      approvedBy:[{subject:'wrong-owner',role:gate.ownerRoles[0]}],approvedAt:'invalid',evidence:[],controls:{}}));
    const report=agentCanaryReadinessGate(value);
    expect(report.status).toBe('blocked');
    expect(report.errors.length).toBeGreaterThan(requiredCanaryApprovalGateIds.length*3);
  });

  test('passes the bootstrap canary gate only when the configured owner approves every concrete control',async()=>{
    const value=await manifest();
    value.approvalGates=value.approvalGates.map((gate:{id:string;ownerRoles:string[]})=>({...gate,status:'approved',selectedOption:'approved-option',controls:controls(gate.id),
      approvedBy:[{subject:'github:kobdesign',role:'BootstrapOwner'}],
      approvedAt:'2026-11-15T12:00:00.000Z',evidence:[`docs/approvals/${gate.id}.md`]}));
    expect(agentCanaryReadinessGate(value)).toMatchObject({status:'approved',productionDecision:'no-go',errors:[],technicalReady:true,approvalsReady:true,blockingGates:[],
      governance:{mode:'bootstrap-single-owner',ownerSubject:'github:kobdesign',productionAllowed:false,realTenantDataAllowed:false,commerceMutationsAllowed:false}});
  });

  test('does not pass if a required technical gate fails or is missing',async()=>{
    const value=await manifest();
    value.technicalGates=value.technicalGates.filter((gate:{id:string})=>gate.id!=='CANARY-GRANT-OPERATIONS');
    const report=agentCanaryReadinessGate(value);
    expect(report.status).toBe('blocked');
    expect(report.errors).toContain('Missing technical gate CANARY-GRANT-OPERATIONS.');
  });

  test('restores dual-control approvals when governance moves beyond bootstrap',async()=>{
    const value=await manifest();
    value.governance={...value.governance,mode:'separated-roles',ownerSubject:null};
    value.approvalGates=value.approvalGates.map((gate:{id:string})=>({...gate,status:'approved',approvedBy:[{subject:'github:kobdesign',role:'BootstrapOwner'}],
      approvedAt:'2026-11-16T12:00:00.000Z',evidence:[`docs/approvals/${gate.id}.md`]}));
    const report=agentCanaryReadinessGate(value);
    expect(report.status).toBe('blocked');
    expect(report.errors).toContain('CANARY-IDENTITY-SECRETS requires at least two distinct approvers.');
    expect(report.errors).toContain('CANARY-IDENTITY-SECRETS requires approvers from at least two distinct roles.');
  });
});
