import assert from 'node:assert/strict';
import test from 'node:test';
import { runSyntheticRollbackRehearsal } from '../evals/synthetic-rollback.ts';

test('rehearses tenant routing, Eve failure, timeout and operator rollback without Commerce mutation',async()=>{
  const report=await runSyntheticRollbackRehearsal();
  assert.equal(report.passed,true);
  assert.equal(report.cases,6);
  assert.equal(report.legacyDefault,true);
  assert.equal(report.crossTenantIsolation,true);
  assert.equal(report.businessDataMutations,0);
  assert.equal(report.productionDecision,'no-go');
  assert.equal(report.releaseDecision,'retain-legacy-default');
  assert.equal(report.results.find(result=>result.id==='RB-04-eve-unavailable')?.fallbackReason,'eve_unavailable');
  assert.equal(report.results.find(result=>result.id==='RB-05-eve-timeout')?.fallbackReason,'eve_timeout');
  assert.equal(report.results.find(result=>result.id==='RB-06-operator-rollback')?.fallbackReason,'rollback_requested');
  assert.ok(report.results.every(result=>result.commerceSnapshotUnchanged));
});
