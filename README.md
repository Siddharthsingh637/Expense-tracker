# Expense Tracker

pnpm and Turborepo manage the JavaScript workspaces. The FastAPI service is managed independently with `uv`.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.10.0 (or Corepack)
- Python 3.12 or newer
- uv

## Install

```sh
corepack pnpm install
uv sync --project apps/api
```

Copy `apps/api/.env.example` to `apps/api/.env.local` and set local values as needed. Do not commit environment files.
Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and set `EXPO_PUBLIC_API_URL` to the API address reachable from the simulator/device. Use `http://10.0.2.2:8000` for the Android emulator; physical devices need the computer's LAN address. Expo embeds `EXPO_PUBLIC_` values into the app bundle, so this URL must not contain secrets.

The API expects PostgreSQL for normal development. Create the `expense_tracker` database/user to match `DATABASE_URL`, then apply the initial schema migration from the repository root:

```sh
uv run --project apps/api alembic -c apps/api/alembic.ini upgrade head
```

## Workspace commands

```sh
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

These commands run scripts declared by the pnpm workspaces through Turborepo. `pnpm dev` starts the web app, Expo app, and FastAPI service together. PostgreSQL must be running first; `pnpm api:dev` runs migrations and starts the API without Docker. To start the API and its PostgreSQL container together, use `pnpm --filter @expense-tracker/api dev:docker`. The API listens on `http://127.0.0.1:8000`, with interactive API docs at `/docs` and a health check at `/health`. API dependencies are managed in `apps/api` with `uv`, independently from pnpm.

Use `pnpm api:lint` and `pnpm api:test` for the Python checks. `uv sync --project apps/api` creates the API's local `.venv` and resolves its dependencies. Python 3.12 or newer is required.

The Expo lint command requires ESLint and `eslint-config-expo` to be installed in `apps/mobile`. Expo may offer to add these automatically when they are missing. Install them as workspace dev dependencies before running `pnpm lint`; avoid accepting an automatic install if pnpm reports a store-location mismatch.

## Run API and mobile locally without Docker (macOS/Homebrew)

Install and start PostgreSQL once, then create the local Paisa role and database. The API's checked-in local defaults use port `54329`:

```sh
brew install postgresql@17
brew services start postgresql@17
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
createuser -p 5432 -s paisa
psql -p 5432 -d postgres -c "ALTER ROLE paisa WITH LOGIN PASSWORD 'paisa';"
createdb -p 5432 -O paisa paisa_dev
```

Use port `5432` in this example and apply migrations. Keep this shell open so Turbo passes these local settings to the API task:

```sh
cd ~/Desktop/projects/mini-projects/expense-tracker-app
export DATABASE_URL='postgresql+psycopg://paisa:paisa@127.0.0.1:5432/paisa_dev'
export JWT_SECRET="$(openssl rand -hex 32)"
uv sync --project apps/api
uv run --project apps/api alembic -c apps/api/alembic.ini upgrade head
pnpm dev
```

`pnpm dev` starts the web app, Expo, and the API after migrating. For API only, use `pnpm api:dev`. To use a physical phone, start the API with `uv run --project apps/api uvicorn expense_tracker_api.main:app --app-dir apps/api/src --host 0.0.0.0 --port 8000` in place of `pnpm dev`, then start Expo in another terminal and use the computer's LAN IP:

```sh
cd ~/Desktop/projects/mini-projects/expense-tracker-app
# Choose the command for the target device:
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm --filter mobile start # iOS simulator
EXPO_PUBLIC_API_URL=http://10.0.2.2:8000 pnpm --filter mobile start # Android emulator
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 pnpm --filter mobile start # physical phone; replace with this computer's LAN IP
```

The Homebrew service manages PostgreSQL startup across reboots; stop it with `brew services stop postgresql@17`. The commands above intentionally use port 5432 while the sample `.env.example` defaults to 54329; keep the exported `DATABASE_URL` in the shell that runs `pnpm dev`, or change the value in `apps/api/.env.local` to match your chosen port and credentials.

The Stage 1 API routes are documented in [docs/api-design.md](docs/api-design.md). OpenAPI is available at `/docs` when the API is running.
