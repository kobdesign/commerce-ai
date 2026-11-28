import { inventoryReadResponseSchema } from '@commerce/agent-contracts';
import { defineTool } from 'eve/tools';
import { commerceClientForScope } from '../../../lib/commerce-client.ts';
import { requireCommerceDelegation } from '../../../lib/commerce-scope.ts';
import { inventoryToolInputSchema } from '../../../lib/read-tool-inputs.ts';

export default defineTool({
  description:'Read central stock, safety stock and planning-only channel allocation for shops in the authenticated Commerce scope.',
  inputSchema:inventoryToolInputSchema,outputSchema:inventoryReadResponseSchema,
  async execute(input,ctx){
    const {scope,grantToken}=requireCommerceDelegation(ctx);const client=await commerceClientForScope(scope,grantToken);
    return client.inventory({...input,shopIds:scope.shopIds,cursor:null},{signal:ctx.abortSignal});
  },
});
