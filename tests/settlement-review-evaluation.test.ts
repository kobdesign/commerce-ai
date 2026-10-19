import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import {
  evaluateSettlementReviewResult,humanSettlementReviewGrade,settlementEvaluationDataset,settlementEvaluationVersion,
  settlementReviewVersions,type SettlementReviewResult,
} from '@commerce/ai';

function result():SettlementReviewResult{
  const exception={
    id:'payout_difference:EVAL-PAYOUT-01',kind:'payout_difference' as const,status:'needs_review' as const,basis:'allocated' as const,
    payoutTotalOrigin:'reported_total' as const,payoutReference:'EVAL-PAYOUT-01',orderId:null,observedAt:'2026-09-20',importedAt:'2026-09-20T08:00:00.000Z',
    amounts:{payoutTotalMinor:120_000,allocatedMinor:100_000,expectedReceiptMinor:null,differenceMinor:-20_000},
    arithmeticBalanced:false,orderMatchingComplete:true,independentPayoutVerification:false as const,missingInputs:[],
    evidenceReferences:[{kind:'settlement_payout' as const,ref:'settlement-payout:EVAL-PAYOUT-01',sourceTransactionId:'EVAL-PAYOUT-01',transactionIdOrigin:'source' as const}],
  };
  return {
    id:'00000000-0000-4000-8000-000000000001',mode:'live',source:'ai',request:{period:{from:'2026-09-01',to:'2026-09-30'},limit:10},
    headline:'AI แนะนำให้เริ่มจากรายการที่มียอดต่าง · ระบบพบ 1 รายการที่ต้องตรวจ',priorityExceptionIds:[exception.id],
    facts:[{exceptionId:exception.id,kind:exception.kind,title:'ยอดรวมรอบโอนกับยอดจัดสรรยังต่างกัน',detail:'รอบโอน EVAL-PAYOUT-01 มียอดรวมจากต้นทาง ฿1,200.00 จัดสรรแล้ว ฿1,000.00 ส่วนต่าง -฿200.00',evidenceReferences:['settlement-payout:EVAL-PAYOUT-01']}],
    suggestions:['ตรวจยอดรวมที่รายงานไว้และ allocations ในรอบโอนเดียวกัน'],versions:settlementReviewVersions,
    evidence:{contractVersion:'finance-evidence-v1',metricVersion:'settlement-reconciliation-v2',scope:{shopId:'00000000-0000-4000-8000-000000000010',shopName:'Synthetic shop',channel:'tiktok',period:{from:'2026-09-01',to:'2026-09-30'}},currency:'THB',calculatedAt:'2026-09-20T08:00:00.000Z',analysedAt:'2026-09-20T08:00:01.000Z',observedAt:'2026-09-20',importedAt:'2026-09-20T08:00:00.000Z',isSynthetic:true,sources:[{adapter:'synthetic',schemaVersion:'v1',parserVersion:'v1'}],results:{total:1,shown:1,truncated:false,items:[exception]},missingInputs:[],limitations:['ไม่ใช่หลักฐานว่าเงินเข้าธนาคาร']},
  };
}

describe('Settlement review evaluation contract',()=>{
  it('loads a versioned synthetic dataset with human grading instructions',async()=>{
    const dataset=settlementEvaluationDataset.parse(JSON.parse(await readFile('fixtures/settlement-review-evaluation.json','utf8')));
    expect(dataset).toMatchObject({version:settlementEvaluationVersion,synthetic:true});expect(dataset.cases).toHaveLength(6);
    expect(dataset.cases.every(item=>item.requiredBehavior.length>0&&item.unacceptableBehavior.length>0&&item.graderNotes.length>0)).toBe(true);
    expect(humanSettlementReviewGrade.safeParse({datasetVersion:settlementEvaluationVersion,caseId:'FA-E01',reviewer:'ผู้ตรวจการเงิน',evidenceCorrect:true,priorityUseful:5,clarity:4,actionability:4,criticalFailure:false,notes:'อ้างหลักฐานครบและไม่สรุปเกินข้อมูล',reviewedAt:new Date().toISOString()}).success).toBe(true);
  });

  it('passes grounded results and reports non-critical priority usefulness separately',()=>{
    const grade=evaluateSettlementReviewResult(result(),{expectedExceptionKinds:['payout_difference'],expectedTopPriorityKind:'payout_difference'});
    expect(grade).toMatchObject({version:settlementEvaluationVersion,passed:true,criticalFailures:[]});
    expect(grade.checks.every(item=>item.passed)).toBe(true);
    const usefulness=evaluateSettlementReviewResult({...result(),priorityExceptionIds:[]},{expectedExceptionKinds:['payout_difference'],expectedTopPriorityKind:'payout_difference'});
    expect(usefulness.passed).toBe(true);expect(usefulness.checks.find(item=>item.id==='expected_priority')).toMatchObject({critical:false,passed:false});
  });

  it('fails critical gates for invented citations, unsupported facts, unsafe claims, or wrong lineage',()=>{
    const source=result();
    const corrupted={...source,headline:'ยืนยันว่าเงินเข้าแล้ว',versions:{...source.versions,policy:'forged-policy' as typeof source.versions.policy},facts:[{...source.facts[0],exceptionId:'invented',evidenceReferences:['settlement-line:invented']}]} as SettlementReviewResult;
    const grade=evaluateSettlementReviewResult(corrupted,{expectedExceptionKinds:['payout_difference']});
    expect(grade.passed).toBe(false);expect(grade.criticalFailures).toEqual(expect.arrayContaining(['facts_grounded','citations_grounded','unsafe_claims','lineage']));
  });
});
