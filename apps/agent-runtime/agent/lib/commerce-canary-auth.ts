import {
  commerceSessionTokenPrefix,
  verifyCommerceSessionGrant,
} from '@commerce/agent-session-auth';
import {
  ForbiddenError,
  extractBearerToken,
  type AuthFn,
} from 'eve/channels/auth';
import { commerceCanaryToolPolicyVersion } from './canary-policy-constants.ts';
import { consumeCommerceGrant } from './commerce-grant-consumer.ts';
import { isLiveAiRequest } from './poc-route-policy.ts';
import { readPocRuntimePolicy } from './runtime-policy.ts';

type Environment = Readonly<Record<string, string | undefined>>;
const continuationPath=/^\/eve\/v1\/session\/([^/]+)(?:\/(?:cancel|compact|clear|end|stream))?$/;

function addressedSession(request:Request){
  const pathname=new URL(request.url).pathname.replace(/\/+$/,'');
  if(pathname==='/eve/v1/session'&&request.method==='POST')return null;
  const match=continuationPath.exec(pathname);
  if(!match)return undefined;
  const isStream=pathname.endsWith('/stream');
  if((isStream&&request.method!=='GET')||(!isStream&&request.method!=='POST'))return undefined;
  try{return decodeURIComponent(match[1]);}catch{return undefined;}
}

/**
 * Authorizes Core-scoped create and continuation requests. It intentionally
 * runs before Vercel OIDC/localDev so a live request can never fall through
 * to a broader authenticator.
 */
export function commerceCanaryAuth(
  env: Environment = process.env,
  now: () => Date = () => new Date(),
  fetchImpl: typeof fetch = fetch,
): AuthFn<Request> {
  return async (request) => {
    if (!(await isLiveAiRequest(request))) return null;

    let policy;
    try {
      policy = readPocRuntimePolicy(env, now());
    } catch {
      throw new ForbiddenError({
        code: 'canary_policy_invalid',
        message: 'Live AI canary policy is missing, invalid or expired.',
      });
    }
    if (!policy.liveAiEnabled) {
      throw new ForbiddenError({
        code: 'live_ai_disabled',
        message: 'Live AI turns are disabled.',
      });
    }

    const sessionId=addressedSession(request);
    if (sessionId === undefined) {
      throw new ForbiddenError({
        code: 'canary_route_denied',
        message: 'This Eve route is outside the approved staging canary.',
      });
    }

    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token?.startsWith(commerceSessionTokenPrefix)) {
      throw new ForbiddenError({
        code: 'commerce_grant_required',
        message: 'A signed Commerce session grant is required for live AI.',
      });
    }

    try {
      const claims = verifyCommerceSessionGrant(token, {
        environment: 'staging',
        keyId: env.COMMERCE_SESSION_KEY_ID!,
        now: now(),
        publicKey: env.COMMERCE_SESSION_PUBLIC_KEY!,
      });
      if(sessionId===null&&(claims.capability!=='create'||claims.sessionId!==null))throw new Error('create grant required');
      if(sessionId!==null&&(claims.capability!=='continue'||claims.sessionId!==sessionId))throw new Error('continuation session mismatch');
      if (!policy.allowedRoles.includes(claims.role)) throw new Error('role not approved');
      await consumeCommerceGrant(token,claims.grantId,env,fetchImpl);

      return {
        authenticator: 'jwt-ecdsa',
        issuer: claims.issuer,
        principalId: claims.subject,
        principalType: 'user',
        subject: claims.subject,
        attributes: {
          approvalId: policy.approvalId,
          capability: claims.capability,
          canaryMode: policy.mode,
          commerceGrant: token,
          grantId: claims.grantId,
          modelId: policy.modelId,
          role: claims.role,
          ...(claims.sessionId?{sessionId:claims.sessionId}:{}),
          shopIds: claims.shopIds,
          tenantId: claims.tenantId,
          toolPolicyVersion: commerceCanaryToolPolicyVersion,
        },
      };
    } catch {
      throw new ForbiddenError({
        code: 'canary_scope_denied',
        message: 'Commerce session grant is invalid, expired or outside the approved canary scope.',
      });
    }
  };
}
