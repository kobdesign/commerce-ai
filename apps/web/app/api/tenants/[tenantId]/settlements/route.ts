import { recordSettlementLine } from '@commerce/finance';
import { apiContext,jsonInput,respond } from '../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>recordSettlementLine(await apiContext((await params).tenantId),await jsonInput(req)));
}
