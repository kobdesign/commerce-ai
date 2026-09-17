import { z } from 'zod';
import { commitSettlementImport,inspectSettlementFile,previewSettlementImport } from '@commerce/finance';
import { apiContext,jsonInput,respond } from '../../../../../lib/server';

export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>{
    const ctx=await apiContext((await params).tenantId);
    const {action,input}=z.object({action:z.enum(['inspect','preview','commit']),input:z.unknown()}).strict().parse(await jsonInput(req,2_200_000));
    return action==='inspect'?inspectSettlementFile(ctx,input):action==='preview'?previewSettlementImport(ctx,input):commitSettlementImport(ctx,input);
  });
}
