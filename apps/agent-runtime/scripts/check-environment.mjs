import { assertPocRuntimePolicy } from '../agent/lib/runtime-policy.ts';

const policy = assertPocRuntimePolicy(process.env);
process.stdout.write(`${JSON.stringify({ status: 'ok', ...policy })}\n`);
