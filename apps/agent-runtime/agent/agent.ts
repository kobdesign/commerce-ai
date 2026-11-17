import { defineAgent } from 'eve';
import {
  commerceCanaryGatewayProviderOptions,
  commerceCanaryHardLimits,
  commerceCanaryModelId,
} from './lib/canary-policy-constants.ts';
import { agentUsageLimits } from './lib/runtime-policy.ts';
import {commerceWorkflowRetention} from './lib/retention-policy.ts';

const usageLimits=agentUsageLimits(process.env,commerceCanaryHardLimits);

export default defineAgent({
  description: 'Coordinate evidence-backed Commerce analysis through bounded specialist agents and read-only Core tools.',
  model: commerceCanaryModelId,
  modelOptions: {providerOptions: commerceCanaryGatewayProviderOptions},
  tool: false,
  defaultTools: false,
  experimental:{workflow:{retention:commerceWorkflowRetention}},
  limits: {
    sessionTimeoutMs: 15 * 60 * 1_000,
    sessionUsage: ({ window }) =>
      window.inputTokens-window.cacheReadTokens>=usageLimits.maxNewInputTokens||
      window.outputTokens>=usageLimits.maxOutputTokens||
      (window.costUsd??0)>=usageLimits.maxCostUsd,
  },
});
