# Wyvern Workers

Cloudflare Workers migration target for `Wyvern/wyvern-backend`, with `Wyvern/landing` intentionally left out of scope.

## Scope

This Workers project is the active rewrite of the Python/FastAPI backend and the app-shell hosting layer.
It does **not** migrate `landing`.

## Current implementation

The current Workers app includes:

- Workers-native API surface under `/api/v1`
- edge API alias under `/edge/api/v1`
- app-shell and static asset hosting from `public/`
- MCP/OAuth compatibility endpoints
- legacy `/openai/v1` compatibility shutdown responses pointing callers to Wyv
- a test-safe websocket upgrade shim for `/ws` and `/edge/ws`
- route coverage for auth, users, servers, channels, DMs, messages, webhooks, workspaces, runtime, admin, sync, uploads, and Wyv internal endpoints
- event-log and live-event emission paths aligned with the copied shell reducer contract
- runtime diagnostics under `/api/v1/runtime/diagnostics`

## Config split

This project now uses two Wrangler configs:

- `wrangler.jsonc`
  - production-oriented config
  - includes `APP_STATE_ROOM` for state persistence
  - includes `MEDIA_BUCKET` for R2-backed media storage
- `wrangler.test.jsonc`
  - test-oriented config used by Vitest
  - excludes the extra persistence Durable Object binding because current Cloudflare Vitest isolated-storage behavior is fragile around additional Durable Object storage and websocket-style DO setups

`vitest.config.ts` points to `wrangler.test.jsonc` so local verification remains stable.

Additional targeted configs exist for deeper runtime verification:

- `wrangler.realtime-test.jsonc` for DO-backed realtime verification
- `wrangler.storage-test.jsonc` as a storage/runtime-oriented config scaffold

## Active bindings

Production/runtime-oriented bindings:

- `ASSETS` static asset binding
- `MEDIA_BUCKET` R2 bucket (optional runtime path)
- `PRESENCE_ROOM` Durable Object
- `APP_STATE_ROOM` Durable Object
- `REALTIME_HUB` Durable Object

## Persistence

The app repository layer in `src/lib/state.ts` supports two modes:

- in-memory/global state fallback
- Durable-Object-backed state via `APP_STATE_ROOM`

The production config is wired for the Durable Object persistence path.
The validated local Vitest configuration still uses the test-safe path because of current Durable Object isolation limitations in the Cloudflare Vitest pool.

The runtime diagnostics endpoint reports which path is active:

- `persistence_mode`: `memory` or `durable_object_with_fallback`
- `realtime_mode`: `shim` or `durable_object`
- `media_mode`: `app_state` or `r2_with_fallback`

Additional runtime verification endpoints exist for production-like deployments:

- `/api/v1/runtime/verify/state-room`
- `/api/v1/runtime/verify/realtime-hub`
- `/api/v1/runtime/verify/realtime-connect`
- `/api/v1/runtime/verify/media-bucket/:uploadId`

In the test config these correctly return `503` because the bindings are intentionally absent.

For storage/runtime verification in a real Worker process with `APP_STATE_ROOM` and `MEDIA_BUCKET` bound, use:

- `npm run verify:storage-runtime`
- `npm run verify:runtime`

after starting the Worker with Wrangler, for example against `http://127.0.0.1:8787` or another `WYVERN_VERIFY_BASE_URL`.

This verifier is now exercised successfully against a real local `wrangler dev` process.

Media storage in `src/lib/media.ts` also supports two modes:

- R2-backed object storage via `MEDIA_BUCKET`
- app-state fallback for the validated local path

The sane app-data split is:

- live app state in `APP_STATE_ROOM`
- media blobs in `MEDIA_BUCKET`
- backups and migration snapshots in `BACKUP_BUCKET`

Runtime data migration endpoints now include:

- `GET /api/v1/runtime/export-state`
- `POST /api/v1/runtime/import-state`
- `POST /api/v1/runtime/backup-state`
- `POST /api/v1/runtime/restore-state`

All four state-management endpoints require an authenticated user whose `username#discriminator` is present in `ADMIN_ALLOWLIST`.

## Uploads and media

New application uploads use `multipart/form-data` with a field named `file`:

```bash
export WYVERN_BASE_URL="https://app.wyvernhub.net"
export WYVERN_ACCESS_TOKEN="replace-with-user-access-token"

curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer ${WYVERN_ACCESS_TOKEN}" \
  --form "file=@./example.png;type=image/png" \
  "${WYVERN_BASE_URL}/api/v1/uploads"
```

The response contains the media ID, stable `/media/...` URL, filename, MIME type, and size. The Worker stores the file in the `MEDIA_BUCKET` R2 binding and stores its metadata in application state.

Allowed uploads currently include images, audio, video, plain text, Markdown, JSON, PDF, and ZIP files. Active-content types and extensions such as HTML, JavaScript, SVG, XHTML, and XML are rejected. The application-level limit is 1 GiB, but the effective request limit may be lower depending on the Cloudflare plan and upload path.

### Import legacy media into R2

The legacy backend stores files below `Wyvern/wyvern-backend/media`. Preserve the relative path exactly so existing database references such as `/media/1/example.jpg` continue to work.

From `Wyvern/wyvern-workers`:

```bash
set -euo pipefail

MEDIA_ROOT="../wyvern-backend/media"

while IFS= read -r -d '' source_file; do
  relative_path=${source_file#../wyvern-backend/}
  mime_type=$(file --brief --mime-type "$source_file")

  npx wrangler r2 object put \
    "wyvern-media/${relative_path}" \
    --file "$source_file" \
    --content-type "$mime_type" \
    --cache-control "public, max-age=31536000, immutable" \
    --remote \
    --force
done < <(find "$MEDIA_ROOT" -type f -print0 | sort -z)
```

This maps `Wyvern/wyvern-backend/media/1/avatar.jpg` to the R2 object key `media/1/avatar.jpg` and the application URL `https://app.wyvernhub.net/media/1/avatar.jpg`.

Verify imported objects through the Worker rather than an R2 development URL:

```bash
curl --fail --head \
  "https://app.wyvernhub.net/media/1/avatar.jpg"
```

For a single direct R2 upload:

```bash
npx wrangler r2 object put \
  "wyvern-media/media/1/avatar.jpg" \
  --file "../wyvern-backend/media/1/avatar.jpg" \
  --content-type "image/jpeg" \
  --remote \
  --force
```

State exports do not embed R2 media bytes. A complete migration or disaster-recovery copy must include both the application-state JSON and the contents of `wyvern-media`. Wrangler can retrieve a known object with `wrangler r2 object get`; for a complete bucket export, use the R2 S3-compatible API, an S3-compatible synchronization tool, or a Cloudflare-managed bucket migration workflow.

## State export, import, backup, and restore

Application state lives in the `APP_STATE_ROOM` Durable Object. Backups are JSON objects stored in `wyvern-backups`. State import and restore replace the complete active state for the configured `ENVIRONMENT` namespace, so create and record a pre-import backup first.

### Obtain an admin bearer token

The production configuration currently grants migration access to `sayori#9491` through `ADMIN_ALLOWLIST`. Log in with that account and extract the short-lived access token:

```bash
export WYVERN_BASE_URL="https://app.wyvernhub.net"
read -r -p "Admin email: " WYVERN_ADMIN_EMAIL
read -r -s -p "Admin password: " WYVERN_ADMIN_PASSWORD
printf '\n'

export WYVERN_ADMIN_TOKEN=$(
  curl --fail-with-body --silent \
    --request POST \
    --header "Content-Type: application/json" \
    --data "$(jq -n \
      --arg email "$WYVERN_ADMIN_EMAIL" \
      --arg password "$WYVERN_ADMIN_PASSWORD" \
      '{email: $email, password: $password}')" \
    "${WYVERN_BASE_URL}/api/v1/auth/login" \
  | jq -r '.data.tokens.access_token'
)

test -n "$WYVERN_ADMIN_TOKEN" && test "$WYVERN_ADMIN_TOKEN" != "null"
unset WYVERN_ADMIN_PASSWORD
```

Do not save the token in the repository, shell history, Wrangler config, or a committed `.env` file. Access tokens expire after `ACCESS_TOKEN_EXPIRE_MINUTES`; log in again if an operation returns `401`.

### Create an R2 backup of live state

Run this before every import, restore, or risky deployment:

```bash
curl --fail-with-body --silent \
  --request POST \
  --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
  "${WYVERN_BASE_URL}/api/v1/runtime/backup-state" \
  | tee wyvern-backup-result.json \
  | jq

export WYVERN_BACKUP_KEY=$(jq -r '.data.key' wyvern-backup-result.json)
echo "$WYVERN_BACKUP_KEY"
```

The returned key has the form `state/<environment>/<timestamp>.json` and is written to the `wyvern-backups` R2 bucket.

### Export live Worker state

The endpoint response includes metadata around the state. Extract only `.data.state` when creating an importable file:

```bash
curl --fail-with-body --silent \
  --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
  "${WYVERN_BASE_URL}/api/v1/runtime/export-state" \
  | jq '.data.state' \
  > workers-state-export.json

jq -e '.users and .servers and .channels and .messages' \
  workers-state-export.json >/dev/null
```

Keep this file private. It contains user records, password hashes, refresh-token records, API-token records, messages, memberships, and other application data.

### Export the legacy PostgreSQL database

Install the legacy backend dependencies, then run its SQLAlchemy exporter with a reachable PostgreSQL URL:

```bash
cd Wyvern/wyvern-backend

export DATABASE_URL="postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/wyvern"
export WYVERN_EXPORT_OUTPUT="$PWD/workers-state-export.json"

python scripts/export_workers_state.py
jq -e '.users and .servers and .channels and .messages' \
  "$WYVERN_EXPORT_OUTPUT" >/dev/null
```

If PostgreSQL is only inside Docker Compose, execute the exporter in the backend container or expose the database port and use a host-reachable URL. The exporter converts `postgresql+asyncpg://` to a synchronous SQLAlchemy PostgreSQL URL internally.

### Import a state JSON file

First create a pre-import R2 backup as shown above. Then run the migration client from `Wyvern/wyvern-workers`:

```bash
export WYVERN_IMPORT_BASE_URL="https://app.wyvernhub.net"
export WYVERN_IMPORT_ACCESS_TOKEN="$WYVERN_ADMIN_TOKEN"
export WYVERN_IMPORT_STATE_JSON="../wyvern-backend/workers-state-export.json"

npm run import:legacy-state
```

The `import:legacy-state` command runs `scripts/migrate-legacy-db.mjs`. It sends the JSON to `/api/v1/runtime/import-state` and creates a second R2 backup after the import. The import is a full replacement, not a merge. Do not run two imports concurrently.

For a direct API import without the helper script:

```bash
jq -n \
  --slurpfile state workers-state-export.json \
  '{state: $state[0]}' \
| curl --fail-with-body \
    --request POST \
    --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
    --header "Content-Type: application/json" \
    --data-binary @- \
    "${WYVERN_BASE_URL}/api/v1/runtime/import-state"
```

After importing state, separately import the legacy media directory into R2 using the media procedure above.

### Restore an R2 state backup

Use the exact backup key returned by `/runtime/backup-state`:

```bash
jq -n --arg key "$WYVERN_BACKUP_KEY" '{key: $key}' \
| curl --fail-with-body \
    --request POST \
    --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
    --header "Content-Type: application/json" \
    --data-binary @- \
    "${WYVERN_BASE_URL}/api/v1/runtime/restore-state"
```

Restoring state does not modify media objects in `wyvern-media`. Restore or synchronize the media bucket separately when recovering from media loss.

### Post-import checks

At minimum, verify runtime bindings, identity, servers, and DMs:

```bash
curl --fail-with-body --silent \
  "${WYVERN_BASE_URL}/api/v1/runtime/diagnostics" | jq

curl --fail-with-body --silent \
  --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
  "${WYVERN_BASE_URL}/api/v1/users/me" | jq

curl --fail-with-body --silent \
  --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
  "${WYVERN_BASE_URL}/api/v1/servers" | jq

curl --fail-with-body --silent \
  --header "Authorization: Bearer ${WYVERN_ADMIN_TOKEN}" \
  "${WYVERN_BASE_URL}/api/v1/dms" | jq
```

Also sign into the browser and verify server navigation, DM navigation, message history, avatars, attachments, and a new upload before retiring the legacy backend.

### Migrated and intentionally excluded tables

The exporter intentionally migrates the live app domain model into Worker state and does **not** force these legacy-only tables into hot Worker state:

- recommendation embeddings/signals/recommendations
- replication ledgers and outbox records
- OAuth client registrations
- release flag and promotion audit rows
- ID migration map rows

Those can be archived separately if needed, but they are not part of the sane live data model for the deployed Worker app.

DM hidden-state rows are part of the live domain model and are migrated into `dmHiddenStates`.

## Production deployment

The production Worker is configured by `wrangler.jsonc` and serves the custom domain `app.wyvernhub.net`. `Wyvern/landing` is not deployed by this project.

### Prerequisites

1. Install Node.js 20 or newer and run `npm ci` in `Wyvern/wyvern-workers`.
2. Authenticate Wrangler with `npx wrangler login`, then verify the selected account with `npx wrangler whoami`.
3. Ensure `wyvernhub.net` is in the selected Cloudflare account and its DNS is managed by Cloudflare.
4. Enable R2 for the account.
5. Review `wrangler.jsonc`, especially the Worker name, custom domain, environment namespace, R2 bucket names, bindings, and `ADMIN_ALLOWLIST`.

### Create required R2 buckets

Bucket creation is only required once per Cloudflare account:

```bash
cd Wyvern/wyvern-workers
npx wrangler r2 bucket create wyvern-media
npx wrangler r2 bucket create wyvern-backups
npx wrangler r2 bucket list
```

The bucket names must match the `MEDIA_BUCKET` and `BACKUP_BUCKET` entries in `wrangler.jsonc`.

### Configure production secrets

Set secrets interactively so values do not appear in command history:

```bash
cd Wyvern/wyvern-workers
npx wrangler secret put JWT_SECRET_KEY
```

Use the original backend JWT secret during migration if existing JWT compatibility is required. Rotating this secret invalidates existing access tokens. If signed Wyv bridge or sync endpoints are enabled, also configure their secret:

```bash
npx wrangler secret put WYV_SHARED_SECRET
```

Do not put secret values in `wrangler.jsonc`. Non-secret settings such as `CORS_ORIGINS` and `ADMIN_ALLOWLIST` belong under `vars`.

### Validate before deployment

Run all checks from `Wyvern/wyvern-workers`:

```bash
npm ci
npm run check
npm test
npm run test:realtime
npm run verify:runtime
npx wrangler deploy --dry-run
```

`verify:runtime` starts a local Wrangler process and verifies Durable Object and R2 behavior using local development storage. It does not alter production state.

### Deploy to `app.wyvernhub.net`

```bash
cd Wyvern/wyvern-workers
npx wrangler deploy
```

The deploy creates or updates the Worker named by `name` in `wrangler.jsonc`, applies Durable Object migrations, uploads static app-shell assets from `public/`, binds both R2 buckets, and attaches the custom domain route. A successful deploy prints the deployed Worker version ID and the `app.wyvernhub.net` trigger.

The custom domain must remain `app.wyvernhub.net`; do not add a route for the landing site or deploy `Wyvern/landing` from this project.

### Verify production after deployment

```bash
curl --fail-with-body --silent \
  "https://app.wyvernhub.net/api/v1/runtime/diagnostics" | jq

npx wrangler versions list
```

Then perform authenticated checks using the admin-token procedure above. Confirm that diagnostics report the expected Durable Object and R2 bindings, and manually verify login, servers, DMs, realtime messaging, avatars, attachments, and uploads.

### Rollback

- State rollback: call `/api/v1/runtime/restore-state` with a known pre-deploy R2 backup key.
- Media rollback: restore or synchronize the affected objects in `wyvern-media`; state restoration does not roll back R2 media.
- Worker-code rollback: inspect available versions with `npx wrangler versions list` and use Wrangler's version deployment commands to redeploy a known-good version.

Always record the pre-deploy state backup key and deployed Worker version ID in the deployment log.

## Realtime

The current validated runtime uses a websocket upgrade shim that:

- upgrades `/ws` and `/edge/ws`
- emits `connected` with a backend marker and `pong`
- accepts shell action vocabulary such as `subscribe`, `unsubscribe`, `typing`, `join_voice`, `leave_voice`, `voice.status`, and `call.signal`
- exposes `/api/v1/ws/snapshot` for inspecting active socket state

The Durable Object realtime hub also tracks recent socket lifecycle events in its snapshot output.

The project now also has a dedicated DO-backed realtime test suite via:

- `npm run test:realtime`

## Verification

Current local verification commands:

- `npm test`
- `npm run check`
- `npm run test:realtime`
- `npm run verify:storage-runtime` against a running Wrangler process
- `npm run verify:runtime` for an end-to-end local Wrangler verification

These use the test Wrangler config and validate the Workers rewrite without touching `landing`.

## Local runtime setup

Example local vars are provided in `.dev.vars.example`.

For a more production-like local run, configure:

- `JWT_SECRET_KEY`
- optional `WYV_SHARED_SECRET` for signed bridge-mode internal endpoints
- `MEDIA_BUCKET` via Wrangler R2 binding in `wrangler.jsonc`
- `APP_STATE_ROOM` via Durable Object binding in `wrangler.jsonc`
- `REALTIME_HUB` via Durable Object binding in `wrangler.jsonc`

When `WYV_SHARED_SECRET` is configured:

- `/api/v1/internal/wyv/session-exchange` requires valid `X-Wyv-Bridge-Timestamp` and `X-Wyv-Bridge-Signature` headers
- `/api/v1/internal/sync/*` requires valid `X-Wyvern-Bridge-Timestamp` and `X-Wyvern-Bridge-Signature` headers
- `/api/v1/auth/wyv-handoff` and `/api/v1/auth/edge-handoff` issue signed Wyv handoff JWT grants

## Important constraint

Do **not** migrate `Wyvern/landing` as part of this Workers project.
