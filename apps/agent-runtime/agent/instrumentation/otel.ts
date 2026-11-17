import { otel } from 'eve/instrumentation/otel';

export default otel({
  resource:{'service.name':'commerce-ai-agent-runtime','commerce.trace.policy':'metadata-only-v1'},
  tracePolicy:()=>({emit:true,recordInputs:false,recordOutputs:false}),
});
