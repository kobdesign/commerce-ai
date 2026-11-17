import type { CommerceScope } from './commerce-scope.ts';

export async function commerceClientForScope(scope:CommerceScope){
  const baseUrl=process.env.COMMERCE_CORE_URL?.trim();
  const credential=process.env.COMMERCE_AGENT_CREDENTIAL?.trim();
  const delegatedTenantId=process.env.COMMERCE_AGENT_TENANT_ID?.trim();
  const environment=process.env.COMMERCE_CORE_ENVIRONMENT?.trim();
  if(!baseUrl||!credential||!delegatedTenantId)throw new Error('Commerce Core read-only POC credentials are not configured.');
  if(delegatedTenantId!==scope.tenantId)throw new Error('Commerce service delegation does not match the authenticated tenant.');
  if(environment!=='development'&&environment!=='staging')throw new Error('Commerce Core environment must be development or staging for this POC.');
  const {createCommerceAgentClient}=await import('@commerce/commerce-agent-client');
  return createCommerceAgentClient({baseUrl,credential,environment});
}
