import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError,type Context,uuid } from '@commerce/contracts';
import { withTenant } from '@commerce/db';
import { assertShop } from '@commerce/domain';
import { getSettlementExceptions,settlementExceptionsInput,type SettlementException,type SettlementExceptionKind } from './finance-tools';

export const financialReviewTaskVersions={evidence:'finance-evidence-v1:settlement-reconciliation-v2',policy:'financial-review-task-v1'} as const;
export const financialReviewTaskStatuses=['open','in_progress','resolved','cancelled'] as const;
export type FinancialReviewTaskStatus=typeof financialReviewTaskStatuses[number];

const reason=z.string().trim().min(3).max(500);
export const reviewTaskDraftInput=settlementExceptionsInput.pick({shopId:true,period:true}).extend({
  exceptionId:z.string().min(1).max(300),assigneeId:uuid,reason,
  proposedByRunId:uuid.nullable().optional(),
}).strict();
export const reviewTaskConfirmInput=z.object({
  shopId:uuid,draftId:uuid,payloadHash:z.string().regex(/^[0-9a-f]{64}$/),confirmationKey:uuid,
  humanConfirmed:z.literal(true),
}).strict();
export const reviewTaskStatusInput=z.object({
  shopId:uuid,status:z.enum(financialReviewTaskStatuses),reason:z.string().trim().max(500).default(''),
}).strict();

export type FinancialReviewAssignee={user_id:string;name:string;role:'owner'|'finance'};
export type FinancialReviewDraft={
  id:string;shop_id:string;requester_id:string;proposed_by_run_id:string|null;exception_id:string;
  exception_kind:SettlementExceptionKind;title:string;reason:string;assignee_id:string;
  period_from:string;period_to:string;evidence_snapshot:ReviewEvidenceSnapshot;evidence_hash:string;payload_hash:string;
  evidence_version:string;policy_version:string;status:'draft'|'confirmed'|'rejected'|'expired'|'stale';
  confirmed_task_id:string|null;created_at:Date;expires_at:Date;confirmed_at:Date|null;
};
export type FinancialReviewTask={
  id:string;shop_id:string;source_draft_id:string;exception_id:string;exception_kind:SettlementExceptionKind;
  title:string;reason:string;assignee_id:string;status:FinancialReviewTaskStatus;evidence_snapshot:ReviewEvidenceSnapshot;
  evidence_hash:string;evidence_version:string;policy_version:string;proposed_by_run_id:string|null;
  proposed_by:string;approved_by:string;executed_by:string;confirmation_key:string;outcome:string|null;
  created_at:Date;updated_at:Date;resolved_at:Date|null;
};
export type FinancialReviewTaskEvent={id:string;actor_id:string;from_status:FinancialReviewTaskStatus|null;to_status:FinancialReviewTaskStatus;reason:string;created_at:Date};
export type ReviewEvidenceSnapshot={
  contractVersion:string;metricVersion:string;scope:{shopId:string;shopName:string;channel:string;period:{from:string;to:string}};
  currency:'THB';isSynthetic:boolean;sources:{adapter:string;schemaVersion:string;parserVersion:string}[];
  observedAt:string|null;importedAt:string|null;exception:SettlementException;missingInputs:string[];limitations:string[];
};

const titleByKind:Record<SettlementExceptionKind,string>={
  unmatched_statement_line:'ติดตามบรรทัด Statement ที่ยังไม่พบคำสั่งซื้อ',
  order_difference:'ติดตามยอดคำสั่งซื้อที่ยังต่างกัน',
  payout_difference:'ติดตามยอดรวมรอบโอนที่ยังต่างกัน',
  insufficient_payout_evidence:'ติดตามหลักฐานยอดรวมของรอบโอน',
};
export const reasonByKind:Record<SettlementExceptionKind,string>={
  unmatched_statement_line:'ตรวจเลขคำสั่งซื้อและจับคู่กับรายงานขายต้นทาง',
  order_difference:'ตรวจรายการหัก คืนเงิน และการแบ่งรับเงินของคำสั่งซื้อ',
  payout_difference:'ตรวจยอดรวมและรายการจัดสรรใน Statement รอบเดียวกัน',
  insufficient_payout_evidence:'ขอหลักฐานยอดรวมจาก Statement ต้นทางให้ครบ',
};

function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
function evidenceSnapshot(evidence:Awaited<ReturnType<typeof getSettlementExceptions>>,exception:SettlementException):ReviewEvidenceSnapshot{
  return {
    contractVersion:evidence.contractVersion,metricVersion:evidence.metricVersion,scope:evidence.scope,currency:evidence.currency,
    isSynthetic:evidence.isSynthetic,sources:evidence.sources,observedAt:exception.observedAt,importedAt:exception.importedAt,
    exception,missingInputs:exception.missingInputs,limitations:evidence.limitations,
  };
}
function databaseError(error:unknown):never{
  const message=error instanceof Error?error.message:'';
  if(message.includes('INVALID_ASSIGNEE'))throw new AppError(409,'INVALID_ASSIGNEE','ผู้รับผิดชอบไม่มีสิทธิ์การเงินในร้านนี้แล้ว กรุณาเลือกรายชื่อใหม่');
  if(message.includes('INVALID_SOURCE_RUN'))throw new AppError(409,'INVALID_SOURCE_RUN','ประวัติการสรุปไม่พร้อมใช้สร้างร่าง กรุณาสรุปข้อมูลใหม่');
  if(message.includes('DRAFT_NOT_FOUND'))throw new AppError(404,'DRAFT_NOT_FOUND','ไม่พบร่างงานติดตามนี้');
  if(message.includes('DRAFT_NOT_CONFIRMABLE'))throw new AppError(409,'DRAFT_NOT_CONFIRMABLE','ร่างนี้ไม่อยู่ในสถานะที่ยืนยันได้ กรุณาสร้างร่างใหม่');
  if(message.includes('TASK_NOT_FOUND'))throw new AppError(404,'TASK_NOT_FOUND','ไม่พบงานติดตามนี้');
  if(message.includes('INVALID_TASK_TRANSITION'))throw new AppError(409,'INVALID_TASK_TRANSITION','สถานะงานถูกเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุด');
  if(message.includes('TASK_EXCEPTION_MISMATCH'))throw new AppError(409,'IDEMPOTENCY_CONFLICT','รหัสยืนยันนี้ถูกใช้กับร่างอื่นแล้ว กรุณาโหลดข้อมูลล่าสุด');
  if(message.includes('FORBIDDEN'))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดำเนินการนี้');
  throw error;
}
function requireWriter(role:string){if(!['owner','finance'].includes(role))throw new AppError(403,'FORBIDDEN','เฉพาะเจ้าของหรือฝ่ายการเงินสร้างและยืนยันงานติดตามได้');}

export async function financialReviewAssignees(ctx:Context,shopId:string){
  uuid.parse(shopId);
  return withTenant(ctx,async(tx,role)=>{
    if(!['owner','finance','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูผู้รับผิดชอบงานการเงิน');
    await assertShop(tx,ctx,shopId);
    return tx.query<FinancialReviewAssignee>('SELECT * FROM app.financial_review_assignees($1)',[shopId]);
  });
}

export async function draftFinancialReviewTask(ctx:Context,input:unknown){
  const data=reviewTaskDraftInput.parse(input);
  if(!['owner','finance'].includes(ctx.role))requireWriter(ctx.role);
  const evidence=await getSettlementExceptions(ctx,{shopId:data.shopId,period:data.period,limit:50});
  const exception=evidence.results.items.find(item=>item.id===data.exceptionId);
  if(!exception)throw new AppError(409,'EVIDENCE_CHANGED','ไม่พบข้อยกเว้นนี้ในข้อมูลล่าสุด กรุณาสรุปข้อมูลใหม่');
  const snapshot=evidenceSnapshot(evidence,exception),evidenceHash=hash(snapshot);
  const payload={actionType:'create_financial_review_task',shopId:data.shopId,exceptionId:exception.id,exceptionKind:exception.kind,
    title:titleByKind[exception.kind],reason:data.reason,assigneeId:data.assigneeId,period:data.period,evidenceHash,
    evidenceVersion:financialReviewTaskVersions.evidence,policyVersion:financialReviewTaskVersions.policy};
  const payloadHash=hash(payload);
  try{
    return await withTenant(ctx,async(tx,role)=>{
      requireWriter(role);await assertShop(tx,ctx,data.shopId);
      const [reserved]=await tx.query<{id:string}>(`SELECT app.reserve_financial_review_draft(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      ) AS id`,[data.shopId,exception.id,exception.kind,payload.title,data.reason,data.assigneeId,data.period.from,data.period.to,
        JSON.stringify(snapshot),evidenceHash,payloadHash,financialReviewTaskVersions.evidence,financialReviewTaskVersions.policy,data.proposedByRunId??null]);
      const [draft]=await tx.query<FinancialReviewDraft>(`SELECT id,shop_id,requester_id,proposed_by_run_id,exception_id,exception_kind,title,reason,assignee_id,
        period_from::text,period_to::text,evidence_snapshot,evidence_hash,payload_hash,evidence_version,policy_version,status,
        confirmed_task_id,created_at,expires_at,confirmed_at FROM app.financial_review_task_drafts WHERE id=$1`,[reserved.id]);
      return draft;
    });
  }catch(error){return databaseError(error);}
}

async function taskByIdInShop(ctx:Context,shopId:string,taskId:string){
  return withTenant(ctx,async(tx,role)=>{
    if(!['owner','finance','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูงานติดตามการเงิน');
    await assertShop(tx,ctx,shopId);
    const [task]=await tx.query<FinancialReviewTask>(`SELECT id,shop_id,source_draft_id,exception_id,exception_kind,title,reason,assignee_id,status,
      evidence_snapshot,evidence_hash,evidence_version,policy_version,proposed_by_run_id,proposed_by,approved_by,executed_by,
      confirmation_key,outcome,created_at,updated_at,resolved_at FROM app.financial_review_tasks WHERE shop_id=$1 AND id=$2`,[shopId,taskId]);
    if(!task)throw new AppError(404,'TASK_NOT_FOUND','ไม่พบงานติดตามนี้');
    return task;
  });
}

export async function confirmFinancialReviewTask(ctx:Context,input:unknown){
  const data=reviewTaskConfirmInput.parse(input);
  if(!['owner','finance'].includes(ctx.role))requireWriter(ctx.role);
  const draft=await withTenant(ctx,async(tx,role)=>{
    requireWriter(role);await assertShop(tx,ctx,data.shopId);
    const [row]=await tx.query<FinancialReviewDraft>(`SELECT id,shop_id,requester_id,proposed_by_run_id,exception_id,exception_kind,title,reason,assignee_id,
      period_from::text,period_to::text,evidence_snapshot,evidence_hash,payload_hash,evidence_version,policy_version,status,
      confirmed_task_id,created_at,expires_at,confirmed_at FROM app.financial_review_task_drafts WHERE shop_id=$1 AND id=$2`,[data.shopId,data.draftId]);
    if(!row)throw new AppError(404,'DRAFT_NOT_FOUND','ไม่พบร่างงานติดตามนี้');
    return row;
  });
  if(draft.status==='confirmed'&&draft.confirmed_task_id)return {outcome:'existing' as const,task:await taskByIdInShop(ctx,data.shopId,draft.confirmed_task_id)};
  if(draft.status!=='draft')throw new AppError(409,'DRAFT_NOT_CONFIRMABLE','ร่างนี้ไม่อยู่ในสถานะที่ยืนยันได้ กรุณาสร้างร่างใหม่');
  const evidence=await getSettlementExceptions(ctx,{shopId:data.shopId,period:{from:draft.period_from,to:draft.period_to},limit:50});
  const exception=evidence.results.items.find(item=>item.id===draft.exception_id);
  const currentEvidenceHash=exception?hash(evidenceSnapshot(evidence,exception)):hash({exception:'missing'});
  try{
    const confirmation=await withTenant(ctx,async(tx,role)=>{
      requireWriter(role);await assertShop(tx,ctx,data.shopId);
      const [row]=await tx.query<{outcome:'created'|'existing'|'expired'|'payload_changed'|'evidence_changed'|'invalid_assignee';task_id:string|null}>(
        'SELECT * FROM app.confirm_financial_review_draft($1,$2,$3,$4,$5)',[data.draftId,data.shopId,data.payloadHash,currentEvidenceHash,data.confirmationKey]);
      return row;
    });
    if(confirmation.outcome==='expired')throw new AppError(409,'DRAFT_EXPIRED','ร่างหมดอายุแล้ว กรุณาสร้างร่างใหม่จากหลักฐานล่าสุด');
    if(confirmation.outcome==='payload_changed')throw new AppError(409,'PAYLOAD_CHANGED','รายละเอียดที่ยืนยันไม่ตรงกับร่าง กรุณาสร้างร่างใหม่');
    if(confirmation.outcome==='evidence_changed')throw new AppError(409,'EVIDENCE_CHANGED','หลักฐานเปลี่ยนหลังจากสร้างร่าง กรุณาตรวจและสร้างร่างใหม่');
    if(confirmation.outcome==='invalid_assignee')throw new AppError(409,'INVALID_ASSIGNEE','ผู้รับผิดชอบไม่มีสิทธิ์ในร้านนี้แล้ว กรุณาเลือกรายชื่อใหม่');
    if(!confirmation.task_id)throw new AppError(500,'TASK_NOT_CREATED','ไม่สามารถสร้างงานติดตามได้');
    return {outcome:confirmation.outcome,task:await taskByIdInShop(ctx,data.shopId,confirmation.task_id)};
  }catch(error){if(error instanceof AppError)throw error;return databaseError(error);}
}

export async function financialReviewTasks(ctx:Context,shopId:string){
  uuid.parse(shopId);
  return withTenant(ctx,async(tx,role)=>{
    if(!['owner','finance','auditor'].includes(role))throw new AppError(403,'FORBIDDEN','คุณไม่มีสิทธิ์ดูงานติดตามการเงิน');
    await assertShop(tx,ctx,shopId);
    return tx.query<FinancialReviewTask>(`SELECT id,shop_id,source_draft_id,exception_id,exception_kind,title,reason,assignee_id,status,
      evidence_snapshot,evidence_hash,evidence_version,policy_version,proposed_by_run_id,proposed_by,approved_by,executed_by,
      confirmation_key,outcome,created_at,updated_at,resolved_at FROM app.financial_review_tasks WHERE shop_id=$1 ORDER BY updated_at DESC LIMIT 50`,[shopId]);
  });
}

export async function financialReviewTask(ctx:Context,shopId:string,taskId:string){
  uuid.parse(shopId);uuid.parse(taskId);
  const task=await taskByIdInShop(ctx,shopId,taskId);
  const events=await withTenant(ctx,tx=>tx.query<FinancialReviewTaskEvent>(
    'SELECT id,actor_id,from_status,to_status,reason,created_at FROM app.financial_review_task_events WHERE task_id=$1 ORDER BY created_at',[taskId]));
  return {task,events};
}

export async function changeFinancialReviewTaskStatus(ctx:Context,taskId:string,input:unknown){
  uuid.parse(taskId);const data=reviewTaskStatusInput.parse(input);
  if(!['owner','finance'].includes(ctx.role))requireWriter(ctx.role);
  if(['resolved','cancelled'].includes(data.status)&&data.reason.length<3)throw new AppError(400,'OUTCOME_REQUIRED','กรุณาระบุผลการติดตามอย่างน้อย 3 ตัวอักษร');
  try{
    await withTenant(ctx,async(tx,role)=>{requireWriter(role);await assertShop(tx,ctx,data.shopId);
      await tx.query('SELECT app.change_financial_review_task_status($1,$2,$3,$4)',[taskId,data.shopId,data.status,data.reason]);});
    return taskByIdInShop(ctx,data.shopId,taskId);
  }catch(error){if(error instanceof AppError)throw error;return databaseError(error);}
}
