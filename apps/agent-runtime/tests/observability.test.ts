import assert from 'node:assert/strict';
import test from 'node:test';
import type { InstrumentationEvent } from 'eve/instrumentation';
import {
  attributeCommerceUsage,buildCommerceExecutionTraceLink,projectSafeInstrumentationEvent,traceAttributeIsSensitive,
} from '../agent/lib/observability.ts';

const ids={tenant:'20000000-0000-4000-8000-000000000001',execution:'70000000-0000-4000-8000-000000000001',
  products:'60000000-0000-4000-8000-000000000001',sales:'60000000-0000-4000-8000-000000000002',inventory:'60000000-0000-4000-8000-000000000003'};
const root='wrun_root_eve_09';
const scope=(sessionId:string)=>({rootSessionId:root,sessionId,turnId:'turn-1',runId:`run-${sessionId}`,attempt:1});
const event=(value:unknown)=>value as InstrumentationEvent;

test('metadata projection drops prompt, tool payload, errors, provider metadata, PII and credentials',()=>{
  const secret=`svc_${'A'.repeat(43)}`;
  const records=[
    projectSafeInstrumentationEvent(event({type:'call.requested',idempotencyKey:'call-1',callId:'call-1',scope:scope(root),frameworkTool:true,
      capability:{kind:'tool',name:'analyze_promotion_candidates'},toolName:'analyze_promotion_candidates',
      input:{authorization:`Bearer ${secret}`,buyerEmail:'buyer@example.com',phone:'+66 81 234 5678',address:'Bangkok'}})),
    projectSafeInstrumentationEvent(event({type:'model.call.settled',idempotencyKey:'model-1',scope:scope(root),outcome:'completed',finishReason:'stop',
      usage:{inputTokens:10,outputTokens:5,costUsd:0.001},content:[{type:'text',text:'private answer'}],
      providerMetadata:{authorization:secret,prompt:'private prompt'}})),
  ];
  const serialized=JSON.stringify(records);
  for(const forbidden of [secret,'buyer@example.com','+66 81 234 5678','Bangkok','private answer','private prompt','authorization']){
    assert.equal(serialized.includes(forbidden),false,`trace leaked ${forbidden}`);
  }
  assert.equal(records.every(record=>record.contentCaptured===false),true);
  assert.deepEqual(records[1].usage,{inputTokens:10,outputTokens:5,cacheReadTokens:null,cacheWriteTokens:null,costUsd:0.001});
});

test('links root, child agents, Core requests and evidence under one tenant execution',()=>{
  const link=buildCommerceExecutionTraceLink({tenantId:ids.tenant,executionId:ids.execution,rootSessionId:root,rootTurnId:'turn-1',rootCallId:'call-1',
    coreRequestIds:[ids.products,ids.sales,ids.inventory],evidenceRefs:['product:item-1','inventory_balance:item-1']});
  assert.equal(link.contentCaptured,false);assert.equal(link.tenantId,ids.tenant);assert.equal(link.executionId,ids.execution);
  assert.deepEqual(link.agents,['commerce-lead','marketing-analysis','inventory-analysis']);
  assert.deepEqual(link.coreRequestIds,[ids.products,ids.sales,ids.inventory]);
});

test('attributes provider usage and cost to tenant, execution and child agents without double counting call summaries',()=>{
  const link=buildCommerceExecutionTraceLink({tenantId:ids.tenant,executionId:ids.execution,rootSessionId:root,rootTurnId:'turn-1',rootCallId:'call-1',
    coreRequestIds:[ids.products,ids.sales,ids.inventory],evidenceRefs:[]});
  const records=[
    projectSafeInstrumentationEvent(event({type:'session.started',idempotencyKey:'session-root',rootSessionId:root,sessionId:root,agentName:'commerce-lead'})),
    projectSafeInstrumentationEvent(event({type:'session.started',idempotencyKey:'session-marketing',rootSessionId:root,sessionId:'child-marketing',agentName:'marketing-analysis',
      parentLineage:{sessionId:root,turnId:'turn-1',callId:'agent-call-1',subagentName:'marketing-analysis'}})),
    projectSafeInstrumentationEvent(event({type:'session.started',idempotencyKey:'session-inventory',rootSessionId:root,sessionId:'child-inventory',agentName:'inventory-analysis',
      parentLineage:{sessionId:root,turnId:'turn-1',callId:'agent-call-2',subagentName:'inventory-analysis'}})),
    projectSafeInstrumentationEvent(event({type:'call.requested',idempotencyKey:'tool-1',callId:'tool-1',scope:scope(root),frameworkTool:true,
      capability:{kind:'tool',name:'analyze_promotion_candidates'},toolName:'analyze_promotion_candidates',input:{}})),
    projectSafeInstrumentationEvent(event({type:'model.call.settled',idempotencyKey:'model-root',scope:scope(root),outcome:'completed',finishReason:'stop',
      usage:{inputTokens:100,outputTokens:20,costUsd:0.01}})),
    projectSafeInstrumentationEvent(event({type:'model.call.settled',idempotencyKey:'model-marketing',scope:scope('child-marketing'),outcome:'completed',finishReason:'stop',
      usage:{inputTokens:80,outputTokens:30,costUsd:0.02}})),
    projectSafeInstrumentationEvent(event({type:'model.call.settled',idempotencyKey:'model-inventory',scope:scope('child-inventory'),outcome:'completed',finishReason:'stop',
      usage:{inputTokens:70,outputTokens:25}})),
    projectSafeInstrumentationEvent(event({type:'call.settled',idempotencyKey:'agent-summary',scope:scope(root),outcome:'completed',
      usage:{inputTokens:150,outputTokens:55,costUsd:0.02}})),
  ];
  const result=attributeCommerceUsage(link,records);
  assert.equal(result.tenantId,ids.tenant);assert.equal(result.executionId,ids.execution);assert.equal(result.modelCallCount,3);
  assert.equal(result.costedModelCallCount,2);assert.equal(result.cost.status,'partial');assert.equal(result.cost.amount,0.03);
  assert.equal(result.inputTokens,250);assert.equal(result.outputTokens,75);assert.equal(result.toolCallCount,1);
  assert.deepEqual(result.byAgent.map(item=>item.agentName),['commerce-lead','inventory-analysis','marketing-analysis']);
});

test('marks cost unavailable instead of inventing a price when providers omit it',()=>{
  const link=buildCommerceExecutionTraceLink({tenantId:ids.tenant,executionId:ids.execution,rootSessionId:root,rootTurnId:'turn-1',rootCallId:'call-1',
    coreRequestIds:[ids.products,ids.sales,ids.inventory],evidenceRefs:[]});
  const record=projectSafeInstrumentationEvent(event({type:'model.call.settled',idempotencyKey:'model-no-cost',scope:scope(root),outcome:'completed',finishReason:'stop',
    usage:{inputTokens:5,outputTokens:2}}));
  assert.deepEqual(attributeCommerceUsage(link,[record]).cost,{status:'unavailable',currency:'USD',amount:null,source:'provider-reported'});
});

test('Agent Runs attribute filter blocks credential, content and customer fields',()=>{
  for(const key of ['http.request.header.authorization','gen_ai.prompt','tool.output','buyer.email','customer.address','api_key'])assert.equal(traceAttributeIsSensitive(key),true);
  for(const key of ['service.name','agent.usage.cost_usd','session.id','model.provider'])assert.equal(traceAttributeIsSensitive(key),false);
});
