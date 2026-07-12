# Wyvern pre-launch operations

This runbook covers the production and staging configuration that accompanies the
pre-launch Worker. It intentionally contains no credentials, live URLs, or
customer data.

## Current access mode

Subscriptions are intentionally disabled for the current launch window:
`SUBSCRIPTIONS_ENABLED=false` and `UNIVERSAL_PREMIUM_ACCESS=true`. Checkout
and the customer portal return a disabled response, Stripe events are accepted
without changing access, and every account receives the Premium limits and
profile-customization capability. Keep Stripe Price IDs and secrets unset while
this mode is active. The Stripe procedures below are retained only for a future
subscription re-enable.

## Configuration ownership

`wrangler.jsonc` contains reviewed production startup defaults. The app reads
the following non-secret values at startup:

| Purpose | Variables | Production default |
| --- | --- | --- |
| Mail sender | `SMTP2GO_BASE_URL`, `SMTP2GO_DEFAULT_FROM`, `SMTP2GO_DEFAULT_FROM_NAME` | SMTP2GO API, `noreply@wyvernhub.net`, `Wyvern Hub` |
| Email verification policy | `EMAIL_VERIFICATION_CODE_EXPIRE_MINUTES`, `EMAIL_VERIFICATION_MAX_ATTEMPTS`, `EMAIL_VERIFICATION_RESEND_SECONDS`, `EMAIL_VERIFICATION_REQUEST_LIMIT`, `EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MINUTES`, `EMAIL_VERIFICATION_REQUIRED_VERSION` | 15 minutes, 5 attempts, 60-second resend delay, 5 requests/account and IP/hour; version 1 requires every pre-rollout account to complete a fresh code verification |
| Subscription mode | `SUBSCRIPTIONS_ENABLED`, `UNIVERSAL_PREMIUM_ACCESS` | subscriptions off; universal Premium access on |
| Stripe public configuration | `STRIPE_PRICE_ID`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `STRIPE_PORTAL_RETURN_URL` | blank while subscriptions are disabled |
| Runtime-control bootstrap | `REGISTRATION_ENABLED`, `MAINTENANCE_MODE`, `MAINTENANCE_MESSAGE` | registration on; maintenance off |
| Feature-control bootstrap | `FEATURE_UPLOADS_ENABLED`, `FEATURE_WEBHOOKS_ENABLED`, `FEATURE_COMMUNITY_TOOLS_ENABLED`, `FEATURE_VOICE_ENABLED`, `FEATURE_AI_ENABLED` | all on except AI; community-tools also bootstraps workspaces |
| Free tier | `FREE_MAX_UPLOAD_BYTES`, `FREE_STORAGE_BYTES`, `FREE_UPLOADS_PER_DAY`, `FREE_WEBHOOKS_PER_SERVER` | 25 MiB, 250 MiB, 20/day, 5/server |
| Premium tier | `PREMIUM_MAX_UPLOAD_BYTES`, `PREMIUM_STORAGE_BYTES`, `PREMIUM_UPLOADS_PER_DAY`, `PREMIUM_WEBHOOKS_PER_SERVER` | 250 MiB, 10 GiB, 100/day, 25/server |

Persisted admin runtime controls override only the registration, maintenance,
and feature-toggle startup values once application state is available. Tier
limits remain deployment configuration. Keep all Stripe values blank until
Stripe is ready; checkout must remain unavailable while a required billing
value is absent.

`wrangler.staging.jsonc` uses a separate Worker name, `staging` state namespace,
and `wyvern-*-staging` R2 buckets. It starts with registration disabled and a
deliberately invalid CORS origin. Before its first deploy, replace that origin
with the approved staging origin, set a staging-only `ADMIN_ALLOWLIST`, and set
a Stripe **test-mode** Price ID plus the three approved staging return URLs. Do
not reuse the production Stripe Price ID, R2 buckets, or SMTP2GO credentials in
staging.

## Secrets and external services

Secret values never belong in `wrangler*.jsonc`, a commit, a deployment log,
or shell history. Copy `.dev.vars.example` only to the ignored local
`.dev.vars` file for local development. Set production and staging secrets
interactively, per Worker config:

```bash
npx wrangler secret put JWT_SECRET_KEY --config wrangler.jsonc
npx wrangler secret put SMTP2GO_API_KEY --config wrangler.jsonc
npx wrangler secret put MAIL_WORKER_SECRET --config wrangler.jsonc
npx wrangler secret put STRIPE_SECRET_KEY --config wrangler.jsonc
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.jsonc
```

`WYV_SHARED_SECRET` is required whenever the Wyv bridge token-introspection
endpoint is enabled; it fails closed when absent. `MALWARE_SCANNER_SECRET`
is required only when malware scanning is enabled. Repeat the required commands
with `--config wrangler.staging.jsonc` for isolated staging values.

For SMTP2GO, verify the `noreply@wyvernhub.net` sender/domain, create a
send-only API key, and confirm a verification email reaches a controlled
recipient. Staging must use a separate SMTP2GO sandbox or test sender and only
approved test recipients. Never log verification codes or SMTP2GO credentials.

For Stripe, create exactly one USD recurring **$4.99/month** Price in each
mode. Put the live Price ID in production configuration and the test Price ID
in staging configuration. Register the mode-matched endpoint
`POST /api/v1/billing/webhook`, supply its signing secret as
`STRIPE_WEBHOOK_SECRET`, and test checkout completion, renewal/update,
payment-failure, cancellation, and duplicate-event delivery. The webhook must
be reachable during maintenance because it maintains entitlement state.

## Staging, monitoring, and readiness

Create the staging buckets once, then deploy the isolated configuration:

```bash
npx wrangler r2 bucket create wyvern-media-staging
npx wrangler r2 bucket create wyvern-backups-staging
npx wrangler deploy --config wrangler.staging.jsonc
```

Before every production deployment, complete the staging smoke suite with
verified email, message/report/moderation flows, tier-limit boundaries,
Stripe test checkout, WebSocket reconnects, and the configured kill switches.
Run the 10-minute 5, 10, 25, and 50 concurrent-user scenarios with the
included harness and retain the latency, error-rate, Durable Object, R2, and
projected-cost results with the release record:

```bash
export STAGING_BASE_URL="https://staging.example.com"
# Include at least as many distinct pre-verified accounts as the concurrency
# run (50 accounts for the 50-user run).
export LOAD_USERS_JSON='[{"email":"verified-load-1@example.com","password":"..."}, {"email":"verified-load-2@example.com","password":"..."}]'
export LOAD_ADMIN_TOKEN="..." # optional, enables admin report/control probes
export LOAD_INCLUDE_UPLOADS=true
export LOAD_INCLUDE_WEBSOCKETS=true
export LOAD_INCLUDE_STRIPE_CHECKOUT=true # only after test Stripe is configured
npm run load:staging:matrix
```

Use only pre-verified staging accounts and delete generated load-test servers
after capturing results. Supply at least one distinct account per concurrent
worker; the harness deliberately refuses smaller pools so account-level rate
limits do not contaminate the result. It covers sign-in, messages, paced
cross-account reports, moderation/admin probes, optional uploads, WebSocket
reconnects, and optional Stripe test checkout; it refuses to send traffic
without an explicit target and account list.

Cloudflare Workers observability is enabled in both deployment configs. Enable
Workers request/error logs, Analytics, and account billing alerts in the
Cloudflare dashboard. Logs must include request ID, route, status, latency,
error code, and a redacted actor identifier; do not place credentials, raw
verification codes, authorization headers, or payment payloads in logs.

Create a Better Uptime HTTPS monitor for
`<production-app-base-url>/healthz`. Expect HTTP 200, alert after two
consecutive failures, and test the alert route before launch. Use `/healthz`
only for external availability checks. Administrators should use authenticated
`GET /api/v1/readiness` after deployment to confirm Durable Object/R2 bindings,
SMTP2GO and Stripe configuration presence, and active runtime controls without
revealing secrets. Also inspect authenticated
`GET /api/v1/runtime/diagnostics` for the detailed runtime status.

## Backup, deployment, and rollback

Scheduled production backups run daily at 03:00 UTC. Before a deployment,
import, or restore, create a manual state backup and record both its returned
R2 key and the currently deployed Worker version. State restore is a complete
replacement; it does not restore R2 media objects.

Perform a restore drill in staging before public launch: create a known test
record, make a backup, alter the record, restore the backup, verify the state
and media separately, and record the result. Never use production as the drill
target.

Production release order:

1. Confirm CI passed: TypeScript, API Vitest, realtime Vitest, and Playwright.
2. Confirm the staging smoke/load evidence, Stripe live webhook delivery,
   Better Uptime alert delivery, ownership/renewal status, and backup drill.
3. Create and record a production backup; deploy only after the backup succeeds.
4. Verify `/healthz`, authenticated readiness/diagnostics, login, verification,
   billing, reporting/moderation, uploads, and realtime behavior.
5. Record the deployed version, release time, monitor status, and backup key.

If a deployment must be rolled back:

1. Enable maintenance and disable registration plus affected expensive features
   through the admin runtime controls.
2. Promote the previously recorded healthy Worker version with Wrangler or the
   Cloudflare dashboard.
3. Restore application state only when the failure includes bad state, using the
   known pre-deploy backup; restore or synchronize R2 media separately if needed.
4. Verify `/healthz`, readiness, diagnostics, authenticated smoke flows, Stripe
   webhook delivery, and Better Uptime recovery before lifting maintenance.

Do not treat a code rollback as a reason to restore data automatically.
