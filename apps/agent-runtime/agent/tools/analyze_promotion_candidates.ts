import { defineWorkflowTool } from 'eve/tools';
import { z } from 'zod';
import { requireCommerceDelegation } from '../lib/commerce-scope.ts';
import {
  inventoryAnalysisSchema,marketingAnalysisSchema,preparePromotionExecution,promotionPeriodSchema,promotionRecommendationSchema,
  verifyAndConsolidatePromotion,
} from '../lib/promotion-analysis.ts';

export default defineWorkflowTool({
  description:'Analyze which products to promote without creating stockout risk. Delegates to Marketing and Inventory specialists, then independently revalidates every fact against read-only Commerce Core evidence.',
  inputSchema:z.object({question:z.string().trim().min(5).max(500),period:promotionPeriodSchema}).strict(),
  outputSchema:promotionRecommendationSchema,
  async execute({question,period},ctx){
    'use workflow';
    const {scope,grantToken}=requireCommerceDelegation(ctx);
    const execution=await preparePromotionExecution({sessionId:ctx.session.id,turnId:ctx.session.turn.id,callId:ctx.callId});
    const sharedTask=JSON.stringify({question,period,executionId:execution.id,
      requirements:['Use only your scoped read tools','Return no more than 10 items','Do not ask for tenant or shop identifiers']});
    const [marketingResponse,inventoryResponse]=await Promise.all([
      ctx.agent('marketing-analysis').send(`Analyze promotion opportunities. Task: ${sharedTask}`,{outputSchema:marketingAnalysisSchema,signal:ctx.abortSignal}),
      ctx.agent('inventory-analysis').send(`Assess stockout risk for promotion candidates. Task: ${sharedTask}`,{outputSchema:inventoryAnalysisSchema,signal:ctx.abortSignal}),
    ]);
    const [marketingResult,inventoryResult]=await Promise.all([marketingResponse.result(),inventoryResponse.result()]);
    if(marketingResult.status!=='completed'||marketingResult.data===undefined)throw new Error(`Marketing analysis did not complete: ${marketingResult.error?.message??marketingResult.status}`);
    if(inventoryResult.status!=='completed'||inventoryResult.data===undefined)throw new Error(`Inventory analysis did not complete: ${inventoryResult.error?.message??inventoryResult.status}`);
    return verifyAndConsolidatePromotion({question,period,scope,grantToken,marketing:marketingResult.data,inventory:inventoryResult.data,execution});
  },
});
