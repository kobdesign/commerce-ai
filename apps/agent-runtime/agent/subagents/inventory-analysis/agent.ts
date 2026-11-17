import { defineAgent } from 'eve';
import {commerceCanaryGatewayProviderOptions,commerceCanaryModelId} from '../../lib/canary-policy-constants.ts';
import {agentUsageLimits} from '../../lib/runtime-policy.ts';
import {commerceWorkflowRetention} from '../../lib/retention-policy.ts';

const usageLimits=agentUsageLimits(process.env,{maxNewInputTokens:10_000,maxOutputTokens:2_000,maxCostUsd:0.08});

export default defineAgent({
  description:'Assess stockout risk and promotion eligibility from scoped central stock and inventory policy evidence. Return analysis only; never mutate inventory.',
  model:commerceCanaryModelId,
  modelOptions:{providerOptions:commerceCanaryGatewayProviderOptions},
  tool:false,defaultTools:false,
  experimental:{workflow:{retention:commerceWorkflowRetention}},
  limits:{sessionTimeoutMs:5*60*1_000,sessionUsage:({window})=>window.inputTokens-window.cacheReadTokens>=usageLimits.maxNewInputTokens||window.outputTokens>=usageLimits.maxOutputTokens||(window.costUsd??0)>=usageLimits.maxCostUsd},
});
