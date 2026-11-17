import { runSyntheticRollbackRehearsal } from '../evals/synthetic-rollback.ts';

const report=await runSyntheticRollbackRehearsal();
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
