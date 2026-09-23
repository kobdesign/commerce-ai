import { z } from 'zod';
import { commitMarketplaceSettlement,commitSettlementImport,inspectMarketplaceSettlement,inspectSettlementFile,previewSettlementImport } from '@commerce/finance';
import { apiContext,jsonInput,respond } from '../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>{
    const ctx=await apiContext((await params).tenantId);
    const {action,input}=z.object({action:z.enum(['inspect','preview','commit','inspect-marketplace','commit-marketplace']),input:z.unknown()}).strict().parse(await jsonInput(req,7_500_000));
    if(action==='inspect')return inspectSettlementFile(ctx,input);
    if(action==='preview')return previewSettlementImport(ctx,input);
    if(action==='inspect-marketplace')return inspectMarketplaceSettlement(ctx,input);
    if(action==='commit-marketplace')return commitMarketplaceSettlement(ctx,input);
    return commitSettlementImport(ctx,input);
  });
}
