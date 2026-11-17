export const commerceCanaryModelId = 'openai/gpt-5.4-mini';

export const commerceCanaryGatewayProviderOptions = {
  gateway: {
    zeroDataRetention: true,
    disallowPromptTraining: true,
  },
} as const;

export const commerceCanaryToolPolicyVersion =
  'commerce-canary-read-only-v1';

export const commerceCanaryToolFiles = [
  'agent/subagents/inventory-analysis/tools/read_inventory.ts',
  'agent/subagents/inventory-analysis/tools/read_products.ts',
  'agent/subagents/marketing-analysis/tools/read_products.ts',
  'agent/subagents/marketing-analysis/tools/read_sales.ts',
  'agent/tools/analyze_promotion_candidates.ts',
] as const;

export const commerceCanaryHardLimits = {
  maxNewInputTokens: 20_000,
  maxOutputTokens: 4_000,
  maxCostUsd: 0.25,
} as const;
