import {readFile} from 'node:fs/promises';
import {describe,expect,test} from 'vitest';
import {agentAiGatewayBudgetConfiguration} from '@commerce/operations';

async function manifests(){
  const [budget,readiness]=await Promise.all([
    readFile(new URL('../config/eve-ai-gateway-budget.json',import.meta.url),'utf8').then(JSON.parse),
    readFile(new URL('../config/eve-canary-readiness.json',import.meta.url),'utf8').then(JSON.parse),
  ]);
  return {budget,readiness};
}

describe('AI Gateway project budget desired state',()=>{
  test('keeps the approved monthly limit at USD 5 with verified platform enforcement',async()=>{
    const {budget,readiness}=await manifests();
    expect(agentAiGatewayBudgetConfiguration(budget,readiness)).toMatchObject({
      status:'valid',enforcementStatus:'platform-applied',errors:[],
      target:{projectName:'commerce-ai-agent-poc'},budget:{currency:'USD',limitUsd:5,refreshPeriod:'monthly'},
    });
  });

  test('rejects drift between the reviewed budget and readiness gate',async()=>{
    const {budget,readiness}=await manifests();budget.limit=6;
    expect(agentAiGatewayBudgetConfiguration(budget,readiness)).toMatchObject({
      status:'invalid',errors:['Readiness monthlyBudgetUsd must match the AI Gateway project budget limit.'],
    });
  });

  test('requires evidence before configuration can claim platform enforcement',async()=>{
    const {budget,readiness}=await manifests();
    budget.platformSync={status:'applied',lastVerifiedAt:null,evidence:null};
    expect(agentAiGatewayBudgetConfiguration(budget,readiness).errors).toContain('Applied platform budget requires verification time and evidence.');
  });
});
