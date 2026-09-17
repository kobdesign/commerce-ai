import { randomUUID } from 'node:crypto';
import { afterAll,describe,expect,it } from 'vitest';
import { closePools,resolveContext,withTenant } from '@commerce/db';
import { createShop,demo } from '@commerce/domain';
import { applyShopExpenses,recordShopExpense,reverseShopExpense,shopExpenses,type ExpenseAllocationScope,type ShopExpenseType } from '@commerce/finance';

afterAll(closePools);
const today=new Date().toISOString().slice(0,10);

async function isolatedShop(){
  const ctx=await resolveContext(demo.users.owner,demo.tenants.chino);
  const shopId=await createShop(ctx,{name:`Expense test ${randomUUID().slice(0,8)}`,channel:'direct'});
  return {ctx,shopId};
}
function expense(shopId:string,expenseType:ShopExpenseType,amountMinor:number,allocationScope:ExpenseAllocationScope='shop_direct',sourceExpenseId=`EXP-${randomUUID()}`){
  return {shopId,sourceExpenseId,expenseType,occurredOn:today,amountMinor,allocationScope,allocationBasis:allocationScope==='shared_allocated'?'แบ่ง 40% ตามสัดส่วนยอดขายของร้าน':null,note:`หลักฐานทดสอบ ${expenseType}`,confirmedOutsideImportedReceipt:true as const};
}
function reversal(shopId:string,note='แก้กลับเพราะบันทึกเอกสารซ้ำ'){
  return {shopId,occurredOn:today,note,confirmedCorrection:true as const};
}

describe('Append-only shop expense ledger',()=>{
  it('totals direct and allocated expenses by category without assigning them to orders or SKUs',async()=>{
    const {ctx,shopId}=await isolatedShop();
    await recordShopExpense(ctx,expense(shopId,'advertising',25000));
    await recordShopExpense(ctx,expense(shopId,'payroll',40000,'shared_allocated'));
    const ledger=await shopExpenses(ctx,shopId);
    expect(ledger.summary).toEqual({entryCount:2,activeExpenseCount:2,reversedExpenseCount:0,activeAmountMinor:65000});
    expect(ledger.categoryTotals).toEqual(expect.arrayContaining([{expenseType:'advertising',amountMinor:25000},{expenseType:'payroll',amountMinor:40000}]));
    expect(ledger.items.find(row=>row.expenseType==='payroll')).toMatchObject({allocationScope:'shared_allocated',allocationBasis:'แบ่ง 40% ตามสัดส่วนยอดขายของร้าน'});
    expect(applyShopExpenses(100000,ledger.summary.activeAmountMinor)).toBe(35000);
    expect(applyShopExpenses(null,ledger.summary.activeAmountMinor)).toBeNull();
    expect(await withTenant(ctx,tx=>tx.query("SELECT id FROM app.audit_events WHERE action='shop_expense.recorded' AND details->>'shopId'=$1",[shopId]))).toHaveLength(2);
  });

  it('is idempotent under replay and rejects changed data under one document reference',async()=>{
    const {ctx,shopId}=await isolatedShop(),sourceExpenseId=`RECEIPT-${randomUUID()}`,input=expense(shopId,'travel',1500,'shop_direct',sourceExpenseId);
    const results=await Promise.all([recordShopExpense(ctx,input),recordShopExpense(ctx,input)]);
    expect(results.map(row=>row.duplicate).sort()).toEqual([false,true]);
    await expect(recordShopExpense(ctx,{...input,amountMinor:1600})).rejects.toMatchObject({code:'EXPENSE_ID_CONFLICT'});
    const [{count}]=await withTenant(ctx,tx=>tx.query<{count:number}>('SELECT count(*)::int AS count FROM app.shop_expenses WHERE shop_id=$1 AND source_expense_id=$2',[shopId,sourceExpenseId]));
    expect(count).toBe(1);
  });

  it('reverses an expense once, preserves both records and rejects a forged or nested reversal',async()=>{
    const {ctx,shopId}=await isolatedShop(),saved=await recordShopExpense(ctx,expense(shopId,'packaging',3200));
    const reversed=await reverseShopExpense(ctx,saved.id,reversal(shopId));
    expect(reversed).toMatchObject({sourceExpenseId:`REV-${saved.id}`,duplicate:false,reversedExpenseId:saved.id});
    await expect(reverseShopExpense(ctx,saved.id,reversal(shopId))).resolves.toMatchObject({id:reversed.id,duplicate:true});
    const ledger=await shopExpenses(ctx,shopId);
    expect(ledger.summary).toEqual({entryCount:2,activeExpenseCount:0,reversedExpenseCount:1,activeAmountMinor:0});
    expect(ledger.items.find(row=>row.id===saved.id)).toMatchObject({reversesExpenseId:null,reversedByExpenseId:reversed.id});
    expect(ledger.items.find(row=>row.id===reversed.id)).toMatchObject({reversesExpenseId:saved.id,reversedByExpenseId:null});
    await expect(reverseShopExpense(ctx,reversed.id,reversal(shopId))).rejects.toMatchObject({code:'REVERSAL_NOT_REVERSIBLE'});
    await expect(withTenant(ctx,tx=>tx.query(`INSERT INTO app.shop_expenses(tenant_id,id,shop_id,source_expense_id,expense_type,occurred_on,amount_minor,allocation_scope,allocation_basis,source_scope,note,actor_id,reverses_expense_id)
      VALUES($1,$2,$3,$4,'packaging',$5,3201,'shop_direct',NULL,'expense_reversal','ยอดไม่ตรงกับรายการเดิม',$6,$7)`,[ctx.tenantId,randomUUID(),shopId,`FORGED-${randomUUID()}`,today,ctx.userId,saved.id]))).rejects.toMatchObject({code:'23514'});
  });

  it('requires allocation evidence and enforces roles, tenant isolation and append-only history',async()=>{
    const {ctx,shopId}=await isolatedShop(),saved=await recordShopExpense(ctx,expense(shopId,'other',900));
    await expect(recordShopExpense(ctx,{...expense(shopId,'payroll',1000,'shared_allocated'),allocationBasis:null})).rejects.toThrow('กรุณาระบุวิธีแบ่งค่าใช้จ่ายส่วนกลางให้ร้านนี้');
    const auditor=await resolveContext(demo.users.consultant,demo.tenants.chino),marketing=await resolveContext(demo.users.marketing,demo.tenants.chino),other=await resolveContext(demo.users.other,demo.tenants.goods);
    expect((await shopExpenses(auditor,shopId)).items.some(row=>row.id===saved.id)).toBe(true);
    await expect(recordShopExpense(auditor,expense(shopId,'other',100))).rejects.toMatchObject({status:403});
    await expect(reverseShopExpense(auditor,saved.id,reversal(shopId))).rejects.toMatchObject({status:403});
    await expect(shopExpenses(marketing,shopId)).rejects.toMatchObject({status:403});
    await expect(shopExpenses(other,shopId)).rejects.toMatchObject({status:403});
    await expect(withTenant(ctx,tx=>tx.query('UPDATE app.shop_expenses SET amount_minor=1 WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
    await expect(withTenant(ctx,tx=>tx.query('DELETE FROM app.shop_expenses WHERE id=$1',[saved.id]))).rejects.toMatchObject({code:'42501'});
  });
});
