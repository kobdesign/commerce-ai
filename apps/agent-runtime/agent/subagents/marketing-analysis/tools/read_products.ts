import { productReadResponseSchema } from '@commerce/agent-contracts';
import { defineTool } from 'eve/tools';
import { commerceClientForScope } from '../../../lib/commerce-client.ts';
import { requireCommerceDelegation } from '../../../lib/commerce-scope.ts';
import { productToolInputSchema } from '../../../lib/read-tool-inputs.ts';

export default defineTool({
  description:'Read reduced product and SKU facts for shops in the authenticated Commerce scope. Tenant and shop scope are never model inputs.',
  inputSchema:productToolInputSchema,outputSchema:productReadResponseSchema,
  async execute(input,ctx){
    const {scope,grantToken}=requireCommerceDelegation(ctx);const client=await commerceClientForScope(scope,grantToken);
    return client.products({...input,shopIds:scope.shopIds,cursor:null},{signal:ctx.abortSignal});
  },
});
