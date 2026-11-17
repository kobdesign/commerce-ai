import { agentRuns } from 'eve/instrumentation/otel';
import { traceAttributeIsSensitive } from '../lib/observability.ts';

export default agentRuns({
  exportPolicy:{
    span:()=>({redact:true,inputs:true,outputs:true}),
    attribute:({key})=>traceAttributeIsSensitive(key)?{emit:false}:{emit:true},
  },
});
