import type { CommerceScope } from './commerce-scope.ts';

export async function commerceClientForScope(scope:CommerceScope,grantToken:string){
  const baseUrl=process.env.COMMERCE_CORE_URL?.trim();
  const environment=process.env.COMMERCE_CORE_ENVIRONMENT?.trim();
  if(!baseUrl||!grantToken.startsWith('csg1_'))throw new Error('Commerce Core session delegation is not configured.');
  if(environment!=='development'&&environment!=='staging')throw new Error('Commerce Core environment must be development or staging for this POC.');
  const {createCommerceAgentClient}=await import('@commerce/commerce-agent-client');
  return createCommerceAgentClient({baseUrl,grantToken,environment});
}
