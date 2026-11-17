import { readFile } from 'node:fs/promises';
import { agentCanaryReadinessGate } from '@commerce/operations';

const manifest=JSON.parse(await readFile(new URL('../config/eve-canary-readiness.json',import.meta.url),'utf8')) as unknown;
const report=agentCanaryReadinessGate(manifest),expectBlocked=process.argv.includes('--expect-blocked');
console.log(JSON.stringify(report,null,2));
if(expectBlocked?report.status!=='blocked':report.status!=='approved')process.exitCode=1;
