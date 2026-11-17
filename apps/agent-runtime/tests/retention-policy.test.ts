import assert from 'node:assert/strict';
import test from 'node:test';
import {commerceWorkflowRetention,evaluateCommerceRetentionObservation} from '../agent/lib/retention-policy.ts';

test('requests zero Workflow run-data retention for every Commerce agent',()=>{
  assert.equal(commerceWorkflowRetention,0);
});

test('verifies synthetic deletion evidence only when workflow, trace and provider controls all pass',()=>{
  const verified=evaluateCommerceRetentionObservation({sessionEnded:true,workflowWorldSpecVersion:4,terminalRead:'expired',traceContentCaptured:false,providerRetention:'zero-data-retention'});
  assert.equal(verified.status,'verified');
  assert.equal(verified.limitations.length,3);
  for(const partial of [
    {sessionEnded:false},
    {workflowWorldSpecVersion:3},
    {terminalRead:'readable' as const},
    {traceContentCaptured:true},
    {providerRetention:'not-approved' as const},
  ])assert.equal(evaluateCommerceRetentionObservation({sessionEnded:true,workflowWorldSpecVersion:4,terminalRead:'empty',traceContentCaptured:false,providerRetention:'approved-retention',...partial}).status,'blocked');
});
