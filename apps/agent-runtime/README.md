# Commerce Agent Runtime

Isolated Eve runtime for Vercel Preview. Commerce Core, PostgreSQL, RLS, RBAC,
business rules and mutations stay on Render. The Eve process receives no
database credential, marketplace secret, session signing private key or direct
model-provider API key.

## Default mode

`COMMERCE_AGENT_LIVE_AI=false` is required unless a time-bounded staging canary
has been approved. Bodyless session foundation requests remain available, while
initial and follow-up model turns return `403 live_ai_disabled`.

## Staging-canary mode

The adapter can authorize one initial turn only when all of these conditions
hold:

- Vercel Preview and Commerce staging environments
- explicit `approved-staging` mode, approval record and expiry within four hours
- signed Commerce grant whose tenant, shops and role are allowlisted
- model allowlist containing only `openai/gpt-5.4-mini`
- input, output and USD limits within the compiled hard ceilings
- reviewed read-only authored tool allowlist; framework default tools disabled

Existing-session continuation remains blocked. Commerce grants are currently
reusable during their five-minute lifetime, so live canary execution remains
blocked until one-time grant consumption and revocation controls are complete.

## Verification

Requires Node.js 24 in CI/Vercel:

```bash
npm run agent:test
npm run agent:typecheck
npm run agent:info
npm run agent:build:local
```

The health route is `/eve/v1/health`. Non-live private routes use Vercel OIDC or
Eve local-development authentication and fail closed otherwise.
