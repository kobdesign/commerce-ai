import { readFile } from 'node:fs/promises';
import { settlementEvaluationDataset } from '@commerce/ai';

const raw=JSON.parse(await readFile(new URL('../fixtures/settlement-review-evaluation.json',import.meta.url),'utf8')) as unknown;
const dataset=settlementEvaluationDataset.parse(raw);
const liveConfigured=process.env.AI_ENABLED==='true'&&!!process.env.AI_GATEWAY_API_KEY&&!!process.env.AI_MODEL;
const approvedThresholds=!!process.env.FINANCE_AI_EVAL_THRESHOLDS_APPROVED;
console.log(JSON.stringify({
  datasetVersion:dataset.version,synthetic:dataset.synthetic,cases:dataset.cases.length,
  automatedEvaluationReady:true,liveModelConfigured:liveConfigured,humanThresholdsApproved:approvedThresholds,
  mode:liveConfigured&&approvedThresholds?'live-evaluation-ready':'synthetic-and-mocked-only',
  blockers:[...(!liveConfigured?['live model/provider configuration']:[]),...(!approvedThresholds?['approved usefulness/latency/cost thresholds']:[])],
},null,2));
