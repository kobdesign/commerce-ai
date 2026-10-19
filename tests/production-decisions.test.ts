import { readFile } from 'node:fs/promises';
import { describe,expect,test } from 'vitest';
import { productionDecisionGate,requiredProductionDecisionIds } from '@commerce/operations';

describe('production dependency decision gate',()=>{
  test('keeps the reviewed proposal blocked until every owner approves with evidence',async()=>{
    const manifest=JSON.parse(await readFile(new URL('../config/production-dependencies.json',import.meta.url),'utf8'));
    const report=productionDecisionGate(manifest);
    expect(report.errors).toEqual([]);
    expect(report.status).toBe('blocked');
    expect(report.decisions.map(item=>item.id)).toEqual(requiredProductionDecisionIds);
    expect(report.decisions.every(item=>item.status==='proposed')).toBe(true);
  });

  test('does not accept an approval without option, two approvers, timestamp and evidence',()=>{
    const decisions=requiredProductionDecisionIds.map(id=>({id,status:'approved',recommendedOption:'recommended',ownerRole:'owners',requiredBefore:'production',selectedOption:null,approvedBy:['one'],approvedAt:null,evidence:[]}));
    const report=productionDecisionGate({schemaVersion:1,reviewedAt:'2026-09-27',decisions});
    expect(report.status).toBe('blocked');
    expect(report.errors).toHaveLength(requiredProductionDecisionIds.length*4);
  });

  test('passes only after every required decision has complete approval evidence',()=>{
    const decisions=requiredProductionDecisionIds.map(id=>({id,status:'approved',recommendedOption:'recommended',ownerRole:'owners',requiredBefore:'production',selectedOption:'recommended',approvedBy:['product-owner','security-owner'],approvedAt:'2026-09-27T00:00:00.000Z',evidence:[`docs/approvals/${id}.md`]}));
    expect(productionDecisionGate({schemaVersion:1,reviewedAt:'2026-09-27',decisions})).toMatchObject({status:'approved',errors:[]});
  });

  test('counts approvers by distinct identity',()=>{
    const decisions=requiredProductionDecisionIds.map(id=>({id,status:'approved',recommendedOption:'recommended',ownerRole:'owners',requiredBefore:'production',selectedOption:'recommended',approvedBy:['same-owner','same-owner'],approvedAt:'2026-09-27T00:00:00.000Z',evidence:[`docs/approvals/${id}.md`]}));
    const report=productionDecisionGate({schemaVersion:1,reviewedAt:'2026-09-27',decisions});
    expect(report.status).toBe('blocked');
    expect(report.errors).toHaveLength(requiredProductionDecisionIds.length);
  });
});
