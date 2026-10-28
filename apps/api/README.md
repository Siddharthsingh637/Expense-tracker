# Financer API

FastAPI backend for Financer's local-first mobile app. The phone remains the source of truth for balances, split calculations, summaries, and anomaly detection. The API handles accounts, sync storage, private receipt files, and optional AI drafts.

## Requirements and first run

Install Node/pnpm, Python 3.12+, uv, and PostgreSQL. Docker is optional. The Docker convenience setup creates a private `apps/api/.env.local` if missing, starts only this project's Postgres container on `127.0.0.1:54329`, and installs Python dependencies in `apps/api/.venv`.

```sh
# Docker-backed setup:
pnpm api:setup
pnpm dev
```

Without Docker, start a local PostgreSQL service, configure `DATABASE_URL` and `JWT_SECRET`, then run `pnpm dev`; the API task applies migrations and starts FastAPI. See the repository [no-Docker setup](../../README.md#run-api-and-mobile-locally-without-docker-macoshomebrew) for the exact commands. `pnpm api:dev` starts only the API without Docker; `pnpm --filter @expense-tracker/api dev:docker` starts the Docker-backed API. API docs are at `http://127.0.0.1:8000/docs`; liveness is `/health`.

The default AI provider is Meta Model API (Muse Spark). Add your `MODEL_API_KEY` to `apps/api/.env.local` to enable live AI calls; until then, Financer uses the deterministic built-in mock. `MODEL_API_BASE_URL` defaults to `https://api.meta.ai`, and the default fast and smart models are both `muse-spark-1.3`. The existing Anthropic integration remains available with `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. `.env.local` is ignored by Git and initialized with local-only random credentials.

## Neon PostgreSQL

Financer uses the existing Neon project `solitary-brook-48067519`, organization `org-damp-mode-82101357`, branch `production`. The API connects with the pooled `DATABASE_URL`; Alembic uses `DATABASE_URL_UNPOOLED` (direct) when present. Set `MIGRATION_DATABASE_URL` only when your hosting environment names the direct URL differently or you need an explicit override. The settings normalize Neon `postgresql://` URLs to the installed `psycopg` v3 driver while preserving query parameters.

After installing the current Neon CLI and authenticating with `neon auth`, link this repository and pull only PostgreSQL variables into the API's ignored local environment file:

```sh
neon link --org-id org-damp-mode-82101357 --project-id solitary-brook-48067519 --branch production --no-env-pull --no-config
neon env pull --service postgres --file apps/api/.env.local
pnpm api:migrate
```

For production hosting, configure `DATABASE_URL` with Neon's pooled connection string and `DATABASE_URL_UNPOOLED` with its direct connection string. Keep both secret values out of Git. Run migrations with `pnpm api:migrate` during release/deployment so Alembic selects the direct URL. No Neon Auth, Realtime, or other Neon service is used by this API.

## Common commands

Run from the repository root:

```sh
pnpm api:migrate    # apply Alembic migrations
pnpm api:test       # isolated SQLite tests
pnpm api:lint       # Ruff
pnpm api:seed       # add the idempotent demo account and sample data
pnpm api:smoke      # exercise the live API, including mock AI
pnpm api:openapi    # export apps/api/openapi.json
pnpm api:client     # export OpenAPI and regenerate packages/api-client
```

The demo credentials are `demo@paisa.local` / `paisa-demo-pass-123`. Seed data includes the A–E party example: ₹8,500 total, ₹1,700 equal shares, and settlements. Keep this account on a local development database.

## API behavior

- All endpoints are under `/api/v1` except `/health`.
- Auth uses Argon2 password hashes, short-lived JWT access tokens, and refresh tokens stored as server-side hashes. A single `get_current_user` dependency resolves authenticated users.
- Synced data uses client IDs/timestamps, per-user increasing `sync_seq`, soft deletes, tenant-scoped references, and last-write-wins by `updated_at`. Group pushes are atomic; transfers and settlements are insert-only with void/payment progress fields.
- Attachments accept JPEG, PNG, or WebP up to 5 MiB, validate and decode the image, strip metadata, and store privately under `ATTACHMENT_DIR`. The local disk backend implements a replaceable storage interface.
- AI responses are unpersisted drafts. AI usage records contain endpoint/model/token/latency/status metadata only; prompts and images are not logged. The API asks the model for structured Pydantic output and retries invalid output once. The mock is selected when the configured provider key is empty or `AI_PROVIDER=mock`.
- The API does not compute balances, summaries, settlement plans, or anomalies. `/ai/ask` defaults to a structured query for the mobile engine; `mode: "conversation"` returns a schema-validated natural-language chat response without sending transaction records. `/ai/month-narrative` accepts an already aggregated report.
- Errors use `{ "error": { "code", "message", "details", "request_id" } }`.

See [manual endpoint guide](../../docs/api-endpoints.md) for methods, parameters, payloads, and examples, and [design](../../docs/api-design-v2.md) for the full data and sync contract.

## Layout

```text
src/expense_tracker_api/
  main.py                 FastAPI app, middleware, errors, OpenAPI
  api/v1/                 API router registration and compatibility re-exports
  features/               Feature-oriented domain modules
    auth/                 Registration, login, sessions, tokens (router, service, schemas)
    expenses/             Categories and transactions CRUD (router, service, schemas)
    budgets/              Budget creation and management (router, service, schemas)
    sync/                 Push, pull, cursors, tombstones (router, service, schemas)
    groups/               Group bills, splits, and settlements (service, schemas)
    attachments/          Image upload, download, quotas (router, service, schemas)
    ai/                   7 AI endpoints, rate limits, prompts (router, service, schemas)
  shared/                 Common error handling, serialization, and date utilities
  core/                   Configuration, security, and auth dependencies
  db/session.py           SQLAlchemy engine and session factory
  models.py               Tables, constraints, and indexes
  schemas.py              Base/shared validation schemas
  schemas_v2.py           Sync/AI validation contracts
  services/storage.py     Private image validation and storage interface
alembic/                  Append-only migration history
tests/                    Pytest suite, mobile golden fixtures
scripts/                  Environment, seed, smoke, and OpenAPI tools
```

## Stage 2 deferred

Google sign-in, email verification, password reset, refresh-token rotation, general rate limiting, security headers, production CORS policy, audit logging, account deletion/export, and admin endpoints remain deferred. AI endpoints have configurable per-user minute and daily limits now.
