import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createProductFamily,demo } from '@commerce/domain';
import { commitDraft,saveDraft } from '@commerce/imports';
import { recordSettlementLine } from '@commerce/finance';
import {
  changeFinancialReviewTaskStatus,confirmFinancialReviewTask,draftFinancialReviewTask,executeSettlementReview,
  financialReadTools,financialReviewAssignees,financialReviewTask,financialReviewTasks,getSettlementExceptions,
} from '@commerce/ai';

const admin=new Pool({connectionString:process.env.ADMIN_DATABASE_URL});
afterAll(async()=>{await closePools();await admin.end();});
const mapping={orderId:'order_id',sourceLineId:'source_line_id',sku:'sku',quantity:'quantity',date:'date',netSales:'net_receipt',platformFee:'platform_fee'};

async function exceptionCase(soldOn:string){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino),sku=`TASK-${randomUUID()}`,orderId=`TASK-ORDER-${randomUUID()}`,payoutReference=`TASK-PAYOUT-${randomUUID()}`;
  await createProductFamily(ctx,{shopId:demo.shops.tiktok,name:'Synthetic task item',category:'other',salesUnit:'ชิ้น',attributes:{},variants:[{sku,attributes:{},priceMinor:10_000,costMinor:null}]});
  const csv=`order_id,source_line_id,sku,quantity,date,net_receipt,platform_fee\n${orderId},SALE-${randomUUID()},${sku},1,${soldOn},100.00,0.00\n`;
  const imported=await saveDraft(ctx,{shopId:demo.shops.tiktok,filename:`task-${randomUUID()}.csv`,delimiter:',' as const,csv,mapping});
  await commitDraft(ctx,{shopId:demo.shops.tiktok,draftId:imported.id});
  await recordSettlementLine(ctx,{shopId:demo.shops.tiktok,sourceLineId:`LINE-${randomUUID()}`,payoutReference,orderId,settledOn:soldOn,payoutTotalMinor:12_000,payoutTotalBasis:'reported_total',amountMinor:8_000,note:'statement test evidence',confirmedStatement:true});
  const period={from:soldOn,to:soldOn},run=await executeSettlementReview(ctx,{shopId:demo.shops.tiktok,period,limit:10,mode:'tool-preview'});
  const exception=run.evidence.results.items.find(item=>item.kind==='payout_difference')!;
  return {ctx,period,run,exception,payoutReference,orderId};
}

describe('Human-confirmed financial review tasks',()=>{
  it('creates one task after explicit confirmation and returns it for duplicate confirmation or duplicate exception',async()=>{
    const created=await exceptionCase('2051-01-12'),confirmationKey=randomUUID();
    const draft=await draftFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,period:created.period,exceptionId:created.exception.id,assigneeId:demo.users.owner,reason:'ตรวจยอดรอบโอนกับ Statement ต้นทาง',proposedByRunId:created.run.id});
    expect(draft).toMatchObject({status:'draft',exception_id:created.exception.id,assignee_id:demo.users.owner,proposed_by_run_id:created.run.id});
    const input={shopId:demo.shops.tiktok,draftId:draft.id,payloadHash:draft.payload_hash,confirmationKey,humanConfirmed:true as const};
    const first=await confirmFinancialReviewTask(created.ctx,input),replayed=await confirmFinancialReviewTask(created.ctx,input);
    expect(first.outcome).toBe('created');expect(replayed.outcome).toBe('existing');expect(replayed.task.id).toBe(first.task.id);
    const secondDraft=await draftFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,period:created.period,exceptionId:created.exception.id,assigneeId:demo.users.owner,reason:'ตรวจซ้ำจากหลักฐานชุดเดียวกัน',proposedByRunId:null});
    const duplicate=await confirmFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,draftId:secondDraft.id,payloadHash:secondDraft.payload_hash,confirmationKey:randomUUID(),humanConfirmed:true});
    expect(duplicate).toMatchObject({outcome:'existing',task:{id:first.task.id}});
    const active=(await financialReviewTasks(created.ctx,demo.shops.tiktok)).filter(task=>task.exception_id===created.exception.id&&['open','in_progress'].includes(task.status));
    expect(active).toHaveLength(1);
    const otherException=created.run.evidence.results.items.find(item=>item.id!==created.exception.id)!;
    const otherDraft=await draftFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,period:created.period,exceptionId:otherException.id,assigneeId:demo.users.owner,reason:'ตรวจข้อยกเว้นอีกประเภทหนึ่ง',proposedByRunId:null});
    await expect(confirmFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,draftId:otherDraft.id,payloadHash:otherDraft.payload_hash,confirmationKey,humanConfirmed:true})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });

  it('blocks changed evidence, changed payload, expired drafts, and revoked assignees',async()=>{
    const changed=await exceptionCase('2051-02-13');
    const draft=await draftFinancialReviewTask(changed.ctx,{shopId:demo.shops.tiktok,period:changed.period,exceptionId:changed.exception.id,assigneeId:demo.users.owner,reason:'ตรวจหลักฐานก่อนมอบหมาย',proposedByRunId:changed.run.id});
    await expect(confirmFinancialReviewTask(changed.ctx,{shopId:demo.shops.tiktok,draftId:draft.id,payloadHash:'0'.repeat(64),confirmationKey:randomUUID(),humanConfirmed:true})).rejects.toMatchObject({code:'PAYLOAD_CHANGED'});
    await recordSettlementLine(changed.ctx,{shopId:demo.shops.tiktok,sourceLineId:`LINE-${randomUUID()}`,payoutReference:changed.payoutReference,orderId:changed.orderId,settledOn:changed.period.from,payoutTotalMinor:12_000,payoutTotalBasis:'reported_total',amountMinor:1_000,note:'new evidence after draft',confirmedStatement:true});
    await expect(confirmFinancialReviewTask(changed.ctx,{shopId:demo.shops.tiktok,draftId:draft.id,payloadHash:draft.payload_hash,confirmationKey:randomUUID(),humanConfirmed:true})).rejects.toMatchObject({code:'EVIDENCE_CHANGED'});

    const expiredCase=await exceptionCase('2051-03-14');
    const expired=await draftFinancialReviewTask(expiredCase.ctx,{shopId:demo.shops.tiktok,period:expiredCase.period,exceptionId:expiredCase.exception.id,assigneeId:demo.users.owner,reason:'ตรวจร่างที่หมดอายุ',proposedByRunId:null});
    await admin.query('UPDATE app.financial_review_task_drafts SET expires_at=now()-interval \'1 minute\' WHERE tenant_id=$1 AND id=$2',[demo.tenants.chino,expired.id]);
    await expect(confirmFinancialReviewTask(expiredCase.ctx,{shopId:demo.shops.tiktok,draftId:expired.id,payloadHash:expired.payload_hash,confirmationKey:randomUUID(),humanConfirmed:true})).rejects.toMatchObject({code:'DRAFT_EXPIRED'});

    const assignee=randomUUID();
    await admin.query(`INSERT INTO private.users(id,email,name,password_hash) VALUES($1,$2,'Synthetic Finance','disabled')`,[assignee,`${assignee}@example.invalid`]);
    await admin.query(`INSERT INTO app.memberships(tenant_id,user_id,role,all_shops) VALUES($1,$2,'finance',true)`,[demo.tenants.chino,assignee]);
    const revokedCase=await exceptionCase('2051-04-15');
    const revoked=await draftFinancialReviewTask(revokedCase.ctx,{shopId:demo.shops.tiktok,period:revokedCase.period,exceptionId:revokedCase.exception.id,assigneeId:assignee,reason:'มอบหมายให้ฝ่ายการเงินตรวจ',proposedByRunId:null});
    await admin.query('UPDATE app.memberships SET active=false WHERE tenant_id=$1 AND user_id=$2',[demo.tenants.chino,assignee]);
    await expect(confirmFinancialReviewTask(revokedCase.ctx,{shopId:demo.shops.tiktok,draftId:revoked.id,payloadHash:revoked.payload_hash,confirmationKey:randomUUID(),humanConfirmed:true})).rejects.toMatchObject({code:'INVALID_ASSIGNEE'});
  });

  it('keeps task lifecycle separate from reconciliation and retains append-only events',async()=>{
    const created=await exceptionCase('2051-05-16');
    const draft=await draftFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,period:created.period,exceptionId:created.exception.id,assigneeId:demo.users.owner,reason:'ติดตามข้อแตกต่างจนได้ข้อสรุป',proposedByRunId:null});
    const confirmed=await confirmFinancialReviewTask(created.ctx,{shopId:demo.shops.tiktok,draftId:draft.id,payloadHash:draft.payload_hash,confirmationKey:randomUUID(),humanConfirmed:true});
    await changeFinancialReviewTaskStatus(created.ctx,confirmed.task.id,{shopId:demo.shops.tiktok,status:'in_progress',reason:'เริ่มตรวจ Statement'});
    await changeFinancialReviewTaskStatus(created.ctx,confirmed.task.id,{shopId:demo.shops.tiktok,status:'resolved',reason:'ตรวจเอกสารและส่งผลให้ฝ่ายการเงินแล้ว'});
    const detail=await financialReviewTask(created.ctx,demo.shops.tiktok,confirmed.task.id);
    expect(detail.task).toMatchObject({status:'resolved',outcome:'ตรวจเอกสารและส่งผลให้ฝ่ายการเงินแล้ว'});
    expect(detail.events.map(event=>event.to_status)).toEqual(['open','in_progress','resolved']);
    const evidence=await getSettlementExceptions(created.ctx,{shopId:demo.shops.tiktok,period:created.period,limit:50});
    expect(evidence.results.items.some(item=>item.id===created.exception.id)).toBe(true);
  });

  it('allows auditors to read but denies them and marketing from drafting, confirming, or changing tasks',async()=>{
    const created=await exceptionCase('2051-06-17'),auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    await expect(financialReviewAssignees(auditor,demo.shops.tiktok)).resolves.toContainEqual(expect.objectContaining({user_id:demo.users.owner}));
    await expect(financialReviewTasks(auditor,demo.shops.tiktok)).resolves.toEqual(expect.any(Array));
    const draftInput={shopId:demo.shops.tiktok,period:created.period,exceptionId:created.exception.id,assigneeId:demo.users.owner,reason:'พยายามสร้างงานโดยผู้ตรวจสอบ',proposedByRunId:null};
    await expect(draftFinancialReviewTask(auditor,draftInput)).rejects.toMatchObject({status:403});
    await expect(draftFinancialReviewTask(marketing,draftInput)).rejects.toMatchObject({status:403});
    await expect(financialReviewTasks(other,demo.shops.tiktok)).rejects.toMatchObject({status:403});
    expect(Object.keys(financialReadTools(created.ctx,demo.shops.tiktok))).not.toContain('confirm_review_task');
    await expect(withTenant(auditor,tx=>tx.query('SELECT app.reserve_financial_review_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[
      demo.shops.tiktok,created.exception.id,created.exception.kind,'forged','forged reason',demo.users.owner,created.period.from,created.period.to,'{}','0'.repeat(64),'0'.repeat(64),'finance-evidence-v1','financial-review-task-v1',null,
    ]))).rejects.toThrow('FORBIDDEN');
  });
});
