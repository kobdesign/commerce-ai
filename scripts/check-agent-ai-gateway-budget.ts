import {readFile} from 'node:fs/promises';
import {agentAiGatewayBudgetConfiguration} from '@commerce/operations';

const [budget,readiness]=await Promise.all([
  readFile(new URL('../config/eve-ai-gateway-budget.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../config/eve-canary-readiness.json',import.meta.url),'utf8').then(JSON.parse),
]);
const report=agentAiGatewayBudgetConfiguration(budget,readiness);
console.log(JSON.stringify(report,null,2));
if(report.status!=='valid')process.exitCode=1;
