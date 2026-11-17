export const commerceWorkflowRetention=0 as const;

export type CommerceRetentionObservation={
  sessionEnded:boolean;
  workflowWorldSpecVersion:number;
  terminalRead:'expired'|'empty'|'readable'|'unknown';
  traceContentCaptured:boolean;
  providerRetention:'zero-data-retention'|'approved-retention'|'not-approved';
};

export function evaluateCommerceRetentionObservation(observation:CommerceRetentionObservation){
  const checks={
    sessionEnded:observation.sessionEnded,
    workflowWorldSupportsDeletion:observation.workflowWorldSpecVersion>=4,
    workflowPayloadUnavailable:observation.terminalRead==='expired'||observation.terminalRead==='empty',
    traceContentExcluded:!observation.traceContentCaptured,
    providerRetentionApproved:observation.providerRetention!=='not-approved',
  };
  return {
    status:Object.values(checks).every(Boolean)?'verified' as const:'blocked' as const,
    checks,
    limitations:[
      'Workflow retention does not delete model-provider data.',
      'Workflow run IDs, timestamps, statuses and attributes may remain for the World default period.',
      'Tool, channel and exported telemetry storage require separate retention controls.',
    ],
  };
}
