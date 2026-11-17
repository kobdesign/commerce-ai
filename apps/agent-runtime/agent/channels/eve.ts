import { localDev, vercelOidc } from 'eve/channels/auth';
import { eveChannel } from 'eve/channels/eve';
import { commerceCanaryAuth } from '../lib/commerce-canary-auth.ts';
import { commerceCleanupAuth } from '../lib/commerce-cleanup-auth.ts';
import { commerceSessionAuth } from '../lib/commerce-session-auth.ts';
import { assertPocRuntimePolicy } from '../lib/runtime-policy.ts';

assertPocRuntimePolicy(process.env);

export default eveChannel({
  auth: [commerceCleanupAuth(), commerceCanaryAuth(), commerceSessionAuth(), vercelOidc(), localDev()],
  audience: 'private',
});
