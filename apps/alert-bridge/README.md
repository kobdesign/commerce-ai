# Commerce Alert Bridge

Independent, metadata-only receiver for signed Commerce runtime and Eve canary alerts. It verifies exact-body HMAC signatures, freshness, environment/source scope and replay protection before returning a safe acknowledgement.

## Deployment boundary

- Deploy as its own Vercel project rooted at `apps/alert-bridge`.
- Use the Node.js runtime.
- Connect a dedicated Upstash Redis resource through Vercel Marketplace.
- Store the signing secret only in this project.
- Do not point this app at the Commerce PostgreSQL database.

`GET /api/health` checks the process. `GET /api/ready` validates configuration and Redis connectivity. `POST /api/v1/alerts` accepts the signed contract from `@commerce/operations`.

The current endpoint verifies and durably consumes an event, but does not yet create a Better Stack incident. Its response marks `incidentDelivery` as `pending-provider-adapter`; external delivery must not be claimed until that adapter and a human acknowledgement rehearsal are complete.
