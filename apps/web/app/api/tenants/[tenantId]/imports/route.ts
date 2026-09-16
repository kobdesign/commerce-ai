import { z } from 'zod';
import { commitDraft,inspectFile,previewImport,saveDraft } from '@commerce/imports';
import { apiContext,respond,jsonInput } from '../../../../../lib/server';
export async function POST(req:Request,{params}:{params:Promise<{tenantId:string}>}){
  return respond(async()=>{
    const ctx=await apiContext((await params).tenantId);
    const {action,input}=z.object({action:z.enum(['inspect','preview','save','commit']),input:z.unknown()}).strict().parse(await jsonInput(req,2_200_000));
    return action==='inspect'?inspectFile(ctx,input):action==='preview'?previewImport(ctx,input):action==='save'?saveDraft(ctx,input):commitDraft(ctx,input);
  });
}
