import { runSyntheticShadowEvaluation } from '../evals/synthetic-shadow.ts';

const report=await runSyntheticShadowEvaluation();
process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
if(!report.passed)process.exitCode=1;
