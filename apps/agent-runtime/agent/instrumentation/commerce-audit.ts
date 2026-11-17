import { defineInstrumentation } from 'eve/instrumentation';
import { projectSafeInstrumentationEvent } from '../lib/observability.ts';

function emit(event:Parameters<typeof projectSafeInstrumentationEvent>[0]){
  process.stdout.write(`${JSON.stringify({kind:'commerce-agent-trace',record:projectSafeInstrumentationEvent(event)})}\n`);
}

export default defineInstrumentation({
  tracePolicy:()=>({emit:true,recordInputs:false,recordOutputs:false}),
  events:{
    'session.started':emit,'session.ended':emit,'turn.started':emit,'turn.settled':emit,
    'model.call.started':emit,'model.call.settled':emit,'call.requested':emit,'call.settled':emit,
  },
});
