import { readFile } from 'node:fs/promises';
import { productionDecisionGate } from '@commerce/operations';

const path=new URL('../config/production-dependencies.json',import.meta.url);
const report=productionDecisionGate(JSON.parse(await readFile(path,'utf8')));
console.log(JSON.stringify(report,null,2));
if(report.status!=='approved')process.exitCode=1;
