import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commerceCanaryGatewayProviderOptions,
  commerceCanaryModelId,
} from '../agent/lib/canary-policy-constants.ts';

process.env.COMMERCE_AGENT_ENV = 'local';
process.env.COMMERCE_AGENT_LIVE_AI = 'false';

const [{default: commerceLead}, {default: inventoryAnalysis}, {default: marketingAnalysis}] =
  await Promise.all([
    import('../agent/agent.ts'),
    import('../agent/subagents/inventory-analysis/agent.ts'),
    import('../agent/subagents/marketing-analysis/agent.ts'),
  ]);

test('requires ZDR and no-training routing for every Commerce canary agent', () => {
  assert.deepEqual(commerceCanaryGatewayProviderOptions, {
    gateway: {
      zeroDataRetention: true,
      disallowPromptTraining: true,
    },
  });

  for (const agent of [commerceLead, marketingAnalysis, inventoryAnalysis]) {
    assert.equal(agent.model, commerceCanaryModelId);
    assert.deepEqual(
      agent.modelOptions?.providerOptions,
      commerceCanaryGatewayProviderOptions,
    );
  }
});
