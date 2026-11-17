import assert from 'node:assert/strict';
import test from 'node:test';
import { runSyntheticShadowEvaluation } from '../evals/synthetic-shadow.ts';

test('compares legacy and Eve against the same synthetic promotion cases without exposing Eve output',async()=>{
  const report=await runSyntheticShadowEvaluation();
  assert.equal(report.cases,3);assert.equal(report.passed,true);
  assert.equal(report.userVisibleEngine,'legacy');assert.equal(report.productionDecision,'no-go');
  assert.equal(report.releaseDecision,'continue-to-rollback-rehearsal');assert.equal(report.liveMetricsAvailable,false);
  assert.equal(report.legacy.averageCorrectness,0);assert.equal(report.legacy.averageGrounding,0);
  assert.equal(report.eve.averageCorrectness,1);assert.equal(report.eve.averageGrounding,1);assert.equal(report.eve.criticalFailures,0);
  assert.equal(report.results.filter(result=>result.engine==='legacy').every(result=>result.checks.find(check=>check.id==='visibility')?.passed),true);
  assert.equal(report.results.filter(result=>result.engine==='eve').every(result=>result.checks.find(check=>check.id==='stockout_safety')?.passed),true);
  assert.equal(report.results.every(result=>result.metrics.inputTokens===null&&result.metrics.outputTokens===null&&result.metrics.costUsd===null),true);
});
