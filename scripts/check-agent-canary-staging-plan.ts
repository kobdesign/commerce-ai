import { readFile } from 'node:fs/promises';
import { agentCanaryStagingGate } from '@commerce/operations';

const [plan,readiness]=await Promise.all([
  readFile(new URL('../config/eve-canary-staging-plan.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../config/eve-canary-readiness.json',import.meta.url),'utf8').then(JSON.parse),
]);
const report=agentCanaryStagingGate(plan,readiness),expectBlocked=process.argv.includes('--expect-blocked');
console.log(JSON.stringify(report,null,2));
if(expectBlocked?report.status!=='blocked':report.status!=='approved')process.exitCode=1;
