# Paisa API

FastAPI backend for Paisa's local-first mobile app. The phone remains the source of truth for balances, split calculations, summaries, and anomaly detection. The API handles accounts, sync storage, private receipt files, and optional AI drafts.

## Requirements and first run

Install Node/pnpm, Python 3.12+, uv, and Docker Desktop (or Docker Engine with Compose). The setup command creates a private `apps/api/.env.local` if missing, starts only this project's Postgres container on `127.0.0.1:54329`, and installs Python dependencies in `apps/api/.venv`.

```sh
pnpm api:setup
pnpm dev
```

`pnpm dev` runs workspace development tasks together. To start only the API, use `pnpm api:dev`. API docs are at `http://127.0.0.1:8000/docs`; liveness is `/health`.

Only `ANTHROPIC_API_KEY` needs a human value. Leave it empty to use the deterministic built-in mock. To use Anthropic, paste the key into `apps/api/.env.local`; the default model aliases are `claude-haiku-5-5` and `claude-sonnet-5-5`. `.env.local` is ignored by Git and initialized with local-only random credentials.

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
- AI responses are unpersisted drafts. AI usage records contain endpoint/model/token/latency/status metadata only; prompts and images are not logged. The API asks the model for structured Pydantic output and retries invalid output once. The mock is selected when the key is empty or `AI_PROVIDER=mock`.
- The API does not compute balances, summaries, settlement plans, or anomalies. `/ai/ask` returns a structured query for the mobile engine; `/ai/month-narrative` accepts an already aggregated report.
- Errors use `{ "error": { "code", "message", "details", "request_id" } }`.

See [manual endpoint guide](../../docs/api-endpoints.md) for methods, parameters, payloads, and examples, and [design](../../docs/api-design-v2.md) for the full data and sync contract.

## Layout

```text
src/expense_tracker_api/
  main.py                 FastAPI app, middleware, errors, OpenAPI
  api/v1/                 Auth, CRUD, sync, attachment, and AI routers
  ai/                     Provider interface, Mock/Anthropic providers, prompts
  core/                   Settings, security, and auth dependencies
  db/session.py           SQLAlchemy engine and session factory
  models.py               Tables, constraints, and indexes
  schemas.py              CRUD/auth validation
  schemas_v2.py           Sync/AI validation contracts
  services/storage.py     Private image validation and storage interface
alembic/                  Append-only migration history
tests/                    Pytest suite, mobile golden fixtures
scripts/                  Environment, seed, smoke, and OpenAPI tools
```

## Stage 2 deferred

Google sign-in, email verification, password reset, refresh-token rotation, general rate limiting, security headers, production CORS policy, audit logging, account deletion/export, and admin endpoints remain deferred. AI endpoints have configurable per-user minute and daily limits now.
