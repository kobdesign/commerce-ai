import { salesReadResponseSchema } from '@commerce/agent-contracts';
import { defineTool } from 'eve/tools';
import { commerceClientForScope } from '../../../lib/commerce-client.ts';
import { requireCommerceScope } from '../../../lib/commerce-scope.ts';
import { salesToolInputSchema } from '../../../lib/read-tool-inputs.ts';

export default defineTool({
  description:'Read privacy-reduced sales aggregates for shops in the authenticated Commerce scope. Raw orders and customer identifiers are unavailable.',
  inputSchema:salesToolInputSchema,outputSchema:salesReadResponseSchema,
  async execute(input,ctx){
    const scope=requireCommerceScope(ctx);const client=await commerceClientForScope(scope);
    return client.sales({...input,shopIds:scope.shopIds,cursor:null},{signal:ctx.abortSignal});
  },
});
