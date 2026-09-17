import { reverseShopExpense } from '@commerce/finance';
import { apiContext,jsonInput,respond } from '../../../../../../../lib/server';

type Params={params:Promise<{tenantId:string;expenseId:string}>};

export async function POST(req:Request,{params}:Params){
  return respond(async()=>{const {tenantId,expenseId}=await params;return reverseShopExpense(await apiContext(tenantId),expenseId,await jsonInput(req));});
}
