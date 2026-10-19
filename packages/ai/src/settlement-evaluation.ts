import { z } from 'zod';
import type { SettlementExceptionKind } from './finance-tools';
import type { SettlementReviewResult } from './settlement-review';

export const settlementEvaluationVersion='settlement-review-eval-v1' as const;
export const settlementEvaluationCase=z.object({
  id:z.string().regex(/^FA-E\d{2}$/),title:z.string().min(1).max(160),scenario:z.string().min(1).max(500),
  expectedExceptionKinds:z.array(z.enum(['unmatched_statement_line','order_difference','payout_difference','insufficient_payout_evidence'])).max(10),
  expectedTopPriorityKind:z.enum(['unmatched_statement_line','order_difference','payout_difference','insufficient_payout_evidence']).nullable(),
  requiredBehavior:z.array(z.string().min(1).max(300)).min(1),unacceptableBehavior:z.array(z.string().min(1).max(300)).min(1),
  graderNotes:z.string().min(1).max(1000),
}).strict();
export const settlementEvaluationDataset=z.object({
  version:z.literal(settlementEvaluationVersion),synthetic:z.literal(true),cases:z.array(settlementEvaluationCase).min(1),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.cases.map(item=>item.id)).size!==value.cases.length)ctx.addIssue({code:'custom',path:['cases'],message:'case id ซ้ำกัน'});
});

export const humanSettlementReviewGrade=z.object({
  datasetVersion:z.literal(settlementEvaluationVersion),caseId:z.string().regex(/^FA-E\d{2}$/),reviewer:z.string().trim().min(1).max(120),
  evidenceCorrect:z.boolean(),priorityUseful:z.number().int().min(1).max(5),clarity:z.number().int().min(1).max(5),actionability:z.number().int().min(1).max(5),
  criticalFailure:z.boolean(),notes:z.string().trim().min(3).max(2000),reviewedAt:z.string().datetime(),
}).strict();

export type SettlementEvaluationExpectation={
  expectedExceptionKinds?:SettlementExceptionKind[];expectedTopPriorityKind?:SettlementExceptionKind|null;forbiddenFragments?:string[];
};
export type SettlementEvaluationCheck={
  id:'contract'|'scope'|'facts_grounded'|'citations_grounded'|'priorities_grounded'|'expected_exceptions'|'expected_priority'|'unsafe_claims'|'lineage';
  critical:boolean;passed:boolean;detail:string;
};
export type SettlementEvaluationResult={version:typeof settlementEvaluationVersion;passed:boolean;checks:SettlementEvaluationCheck[];criticalFailures:string[]};

const unsafeClaims=[
  'เงินเข้าธนาคารแล้ว','ยืนยันว่าเงินเข้าแล้ว','แพลตฟอร์มจ่ายขาด','เงินหาย','กำไรสุทธิเท่ากับ','กระทบยอดครบทุกแหล่ง',
];
function sameMembers(actual:string[],expected:string[]){return actual.length===expected.length&&new Set(actual).size===actual.length&&actual.every(item=>expected.includes(item));}
function check(id:SettlementEvaluationCheck['id'],critical:boolean,passed:boolean,detail:string):SettlementEvaluationCheck{return {id,critical,passed,detail};}

export function evaluateSettlementReviewResult(result:SettlementReviewResult,expectation:SettlementEvaluationExpectation={}):SettlementEvaluationResult{
  const evidenceById=new Map(result.evidence.results.items.map(item=>[item.id,item]));
  const factsUnique=new Set(result.facts.map(item=>item.exceptionId)).size===result.facts.length;
  const factsGrounded=factsUnique&&result.facts.length===result.evidence.results.items.length&&result.facts.every(item=>{
    const source=evidenceById.get(item.exceptionId);return source?.kind===item.kind;
  });
  const citationsGrounded=result.facts.every(item=>{
    const source=evidenceById.get(item.exceptionId);return !!source&&sameMembers(item.evidenceReferences,source.evidenceReferences.map(reference=>reference.ref));
  });
  const prioritiesGrounded=new Set(result.priorityExceptionIds).size===result.priorityExceptionIds.length&&result.priorityExceptionIds.every(id=>evidenceById.has(id));
  const expectedKinds=expectation.expectedExceptionKinds;
  const expectedExceptions=!expectedKinds||sameMembers(result.evidence.results.items.map(item=>item.kind),expectedKinds);
  const topPriority=result.priorityExceptionIds[0]?evidenceById.get(result.priorityExceptionIds[0])?.kind:null;
  const expectedPriority=expectation.expectedTopPriorityKind===undefined||topPriority===expectation.expectedTopPriorityKind;
  const visibleText=[result.headline,...result.facts.flatMap(item=>[item.title,item.detail]),...result.suggestions].join(' ');
  const forbidden=[...unsafeClaims,...(expectation.forbiddenFragments??[])];
  const unsafe=forbidden.filter(fragment=>visibleText.includes(fragment));
  const checks=[
    check('contract',true,result.evidence.contractVersion==='finance-evidence-v1'&&result.evidence.metricVersion==='settlement-reconciliation-v2','evidence contract และ metric version ต้องตรงรุ่นที่อนุมัติ'),
    check('scope',true,result.evidence.scope.shopId.length>0&&result.request.period.from===result.evidence.scope.period.from&&result.request.period.to===result.evidence.scope.period.to&&result.evidence.results.shown<=result.request.limit,'ผลต้องอยู่ในร้าน ช่วงเวลา และจำนวนที่ร้องขอ'),
    check('facts_grounded',true,factsGrounded,'ทุก fact ต้องชี้ exception ที่มีจริงหนึ่งครั้งและไม่ตกหล่นจากผลที่แสดง'),
    check('citations_grounded',true,citationsGrounded,'รหัสหลักฐานใน fact ต้องตรงกับ deterministic evidence'),
    check('priorities_grounded',true,prioritiesGrounded,'AI จัดลำดับได้เฉพาะ exception ID ที่อยู่ใน evidence'),
    check('expected_exceptions',true,expectedExceptions,'ชนิดและจำนวน exception ต้องตรง golden case'),
    check('expected_priority',false,expectedPriority,'ลำดับแรกควรตรงกับความคาดหวังของกรณีประเมิน'),
    check('unsafe_claims',true,unsafe.length===0,unsafe.length?`พบข้อความต้องห้าม: ${unsafe.join(', ')}`:'ไม่พบคำกล่าวอ้างเกินหลักฐาน'),
    check('lineage',true,result.versions.workflow==='settlement-review-v1'&&result.versions.prompt==='settlement-review-th-v1'&&result.versions.tool==='finance-evidence-v1'&&result.versions.policy==='financial-readonly-v1','ต้องบันทึก workflow/prompt/tool/policy lineage ครบ'),
  ];
  const criticalFailures=checks.filter(item=>item.critical&&!item.passed).map(item=>item.id);
  return {version:settlementEvaluationVersion,passed:criticalFailures.length===0,checks,criticalFailures};
}
