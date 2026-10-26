# API Design — Stage 1

Scope: core accounts, categories, transactions, budgets, summaries, and offline sync. No rate limiting, Google/OAuth login, email verification flow, or password reset implementation in this stage.

## 1. Data model

PostgreSQL; SQLAlchemy 2.0 typed mappings; UUIDs stored as `UUID`; timestamps as `TIMESTAMPTZ`; money as integer paise (`BIGINT`) only. All primary and foreign keys are non-null unless stated otherwise. Every user-owned table has `user_id`; every read, update, delete, aggregate, and sync query includes the authenticated `user_id` predicate. Composite foreign keys prevent cross-user references.

| Table | Columns and rules | Indexes / relationships |
|---|---|---|
| `users` | `id UUID PK` (server-generated); `email VARCHAR(320) NOT NULL`; `password_hash TEXT NOT NULL`; `auth_provider TEXT NULL`; `provider_user_id TEXT NULL`; `role TEXT NOT NULL DEFAULT 'user' CHECK role IN ('user','admin')`; `is_active BOOLEAN NOT NULL DEFAULT true`; `email_verified_at TIMESTAMPTZ NULL`; `token_version BIGINT NOT NULL DEFAULT 0`; `created_at`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` | Unique lowercased email index and unique partial `(auth_provider, provider_user_id)` when non-null. Token version revokes outstanding access tokens. |
| `categories` | Client UUID `id PK`; `user_id UUID NOT NULL`; `name VARCHAR(60) NOT NULL`; `color VARCHAR(7) NULL`; `icon VARCHAR(40) NULL`; `created_at`, `updated_at TIMESTAMPTZ NOT NULL` supplied by client; `deleted_at TIMESTAMPTZ NULL` supplied by client; `sync_seq BIGINT NOT NULL` server-assigned | Unique `(user_id,id)` for composite references; unique active name `(user_id, lower(name)) WHERE deleted_at IS NULL`; pull index `(user_id,sync_seq)`. |
| `transactions` | Client UUID `id PK`; `user_id UUID NOT NULL`; `category_id UUID NOT NULL`; `kind TEXT NOT NULL CHECK kind IN ('expense','income')`; `amount_paise BIGINT NOT NULL CHECK amount_paise > 0`; `transaction_date DATE NOT NULL` (user-selected calendar date); `merchant VARCHAR(120) NULL`; `note VARCHAR(500) NULL`; synced timestamps, tombstone, and `sync_seq` as above | Composite FK `(user_id,category_id)` → categories `(user_id,id)`; unique `(user_id,id)`; pull index `(user_id,sync_seq)`; list index `(user_id,transaction_date DESC,id)`; category/date index `(user_id,category_id,transaction_date DESC)`. Search uses PostgreSQL trigram index on normalized merchant/note if enabled. |
| `budgets` | Client UUID `id PK`; `user_id UUID NOT NULL`; `category_id UUID NULL` (null means overall budget); `month DATE NOT NULL CHECK day(month)=1`; `amount_paise BIGINT NOT NULL CHECK amount_paise > 0`; synced timestamps, tombstone, and `sync_seq` as above | Composite FK `(user_id,category_id)` → categories `(user_id,id)`; unique `(user_id,id)`; partial unique overall `(user_id,month) WHERE category_id IS NULL AND deleted_at IS NULL`; partial unique category `(user_id,category_id,month) WHERE category_id IS NOT NULL AND deleted_at IS NULL`; pull index `(user_id,sync_seq)`. |
| `user_sync_state` | `user_id UUID PK/FK`; `last_sync_seq BIGINT NOT NULL DEFAULT 0` | Internal per-user counter. Increment under row lock in the same transaction as each accepted synced-record change; unique `(user_id,sync_seq)` on synced tables makes cursor ordering enforceable. |
| `refresh_sessions` | `id UUID PK`; `user_id UUID NOT NULL`; `family_id UUID NOT NULL`; `token_hash BYTEA NOT NULL UNIQUE`; `created_at`, `expires_at TIMESTAMPTZ NOT NULL`; `revoked_at TIMESTAMPTZ NULL` | `(user_id,expires_at)` index; token values are random opaque secrets and only hashes are stored. Reuse of a rotated token revokes its family. |
| `auth_action_tokens` | `id UUID PK`; `user_id UUID NOT NULL`; `purpose TEXT NOT NULL CHECK` for verification/reset; `token_hash BYTEA NOT NULL UNIQUE`; `created_at`, `expires_at TIMESTAMPTZ NOT NULL`; `consumed_at TIMESTAMPTZ NULL` | User/purpose index. Verification/reset tokens are hashed and single-use. |
| `rate_limit_buckets` | `bucket_key VARCHAR(64) PK`; `window_start BIGINT NOT NULL`; `request_count BIGINT NOT NULL` | Window index; atomic database upsert supports multiple API workers. Key hashes action and client IP. |

Registration creates the default categories on the server with server-generated UUIDs; subsequent category changes follow the same sync contract. User-created offline categories still use client-generated UUIDs. `sync_seq` is allocated per user, not from client time. Its row-lock serialization makes committed sequence order monotonic for that user.

## 2. Endpoint list

All paths below are under `/api/v1`. JSON uses `snake_case`. Protected means a valid access token and active user are required. `401` means missing/invalid/expired access token; `403` means inactive account or insufficient role. Error envelope is specified under Conventions.

| Method + path | Request → response | Auth | Main errors |
|---|---|---|---|
| `POST /auth/register` | `{email,password}` → `201 {user,verification_required,...tokens?}` | Public | `409 email_exists`; `422 validation_error` |
| `POST /auth/login` | `{email,password}` → same token response | Public | `401 invalid_credentials`; `403 account_inactive`; `422` |
| `POST /auth/refresh` | `{refresh_token}` → rotated token response | Refresh token | `401 refresh_invalid_or_expired`; `403 account_inactive` |
| `POST /auth/logout` | `{refresh_token}` → `204` | Access + matching refresh token | `401`; repeated logout is safe and returns `204` |
| `GET /auth/me` | — → `{id,email,role,is_active,created_at}` | Protected | `401`; `403` |
| `POST /auth/verify-email` | `{token}` → confirmation | Public | `400 action_token_invalid`; `429` |
| `POST /auth/resend-verification` | `{email}` → generic `202` confirmation | Public | `429` |
| `POST /auth/google` | `{id_token}` → token response | Public | `401 google_credential_invalid`; `409 account_exists`; `503 google_login_unavailable` |
| `POST /auth/password/forgot` | `{email}` → generic `202` confirmation | Public | `429` |
| `POST /auth/password/reset` | `{token,new_password}` → confirmation | Public | `400 action_token_invalid`; `422`; `429` |
| `POST /auth/password/change` | `{current_password,new_password}` → confirmation | Protected | `400 current_password_invalid`; `401`; `429` |
| `POST /auth/logout-all` | — → confirmation | Protected | `401`; `429` |
| `GET /categories` | `?include_deleted=false` → `{items:[category...]}` | Protected | `401` |
| `POST /categories` | `{id,name,color?,icon?,created_at,updated_at}` → `201 category` | Protected | `409 duplicate_name_or_id`; `422` |
| `GET /categories/{id}` | — → `category` | Protected | `404 not_found` (including another user's ID) |
| `PATCH /categories/{id}` | mutable fields + `updated_at` → `category` | Protected | `404`; `409 stale_or_duplicate`; `422` |
| `DELETE /categories/{id}` | `{updated_at}` → `category` tombstone | Protected | `404`; `409 stale`; `422` |
| `GET /transactions` | filters below → page envelope of transactions | Protected | `400 invalid_date_range`; `422` |
| `POST /transactions` | transaction fields incl client `id`, `created_at`, `updated_at` → `201 transaction` | Protected | `404 category_not_found`; `409 duplicate_id`; `422` |
| `GET /transactions/{id}` | — → `transaction` | Protected | `404` |
| `PATCH /transactions/{id}` | mutable fields + `updated_at` → `transaction` | Protected | `404`; `409 stale`; `422` |
| `DELETE /transactions/{id}` | `{updated_at}` → transaction tombstone | Protected | `404`; `409 stale`; `422` |
| `GET /budgets` | `?month=YYYY-MM` → `{items:[budget...]}` | Protected | `422` |
| `POST /budgets` | `{id,category_id?,month,amount_paise,created_at,updated_at}` → `201 budget` | Protected | `404 category_not_found`; `409 budget_exists`; `422` |
| `PATCH /budgets/{id}` | mutable fields + `updated_at` → `budget` | Protected | `404`; `409 stale_or_budget_exists`; `422` |
| `DELETE /budgets/{id}` | `{updated_at}` → budget tombstone | Protected | `404`; `409 stale`; `422` |
| `GET /summaries/monthly` | `?month=YYYY-MM` → `{month,spent_paise,income_paise,net_paise,by_category:[{category_id,name,spent_paise,count}]}` | Protected | `422` |
| `GET /summaries/trend` | `?months=6&through=YYYY-MM` → `{months:[{month,spent_paise,income_paise,net_paise}]}` oldest first | Protected | `422` for months outside `1..24` |
| `POST /sync/push` | Push envelope below → `{results:[{entity,id,status,record?}]}` | Protected | `413 payload_too_large`; `422 invalid_change`; `403 account_inactive` |
| `GET /sync/pull?cursor=0&limit=500` | — → pull envelope below | Protected | `400 invalid_cursor`; `422 limit_out_of_range` |

Transaction filters: `from`, `to` (inclusive `YYYY-MM-DD`), `category_id`, `q` (case-insensitive substring over merchant/note), `kind`, `page` (1-based), `page_size` (default 50, max 100), and `sort` (`date_desc` default or `date_asc`). Responses include `{items,page,page_size,total,pages}`. A `404` never confirms whether a foreign user's record exists.

Category, transaction, and budget schemas return `id,user_id,...,created_at,updated_at,deleted_at,sync_seq`. The client does not send `user_id` or `sync_seq`; identity comes from auth and sequence from the server.

## 3. Sync contract

### Push shape

`POST /api/v1/sync/push` accepts up to 500 full snapshots per request. Each synced entity has a client UUID and all fields for that entity, including client timestamps and nullable tombstone. `entity` is `category`, `transaction`, or `budget`; `user_id` and `sync_seq` are omitted.

```json
{
  "changes": [
    {
      "entity": "transaction",
      "record": {
        "id": "2a50a8df-95c6-4fd4-a95c-eef2a4cd20b1",
        "category_id": "9d9959cf-7e07-4eec-a9cc-131a6ef81e2e",
        "kind": "expense",
        "amount_paise": 3000,
        "transaction_date": "2026-10-20",
        "merchant": "Chai shop",
        "note": null,
        "created_at": "2026-10-20T10:00:00Z",
        "updated_at": "2026-10-20T10:00:00Z",
        "deleted_at": null
      }
    }
  ]
}
```

Response item `status` is `applied`, `unchanged`, or `conflict`; applied/unchanged/conflict results include the canonical server `record`, including `sync_seq`. A conflict returns the current server winner so clients replace their local snapshot. Batch items are validated and committed atomically; one invalid item rejects the batch. Limits: 500 changes and 1 MiB JSON body.

### Conflict, replay, and deletion rules

1. A client UUID is stable for the life of a record. First valid push inserts it; another user cannot claim or read it. Same-user repeat with an identical or older snapshot is safe and does not create duplicates.
2. Compare incoming `updated_at` with the stored value. Strictly newer wins (last-write-wins); strictly older loses and returns `conflict` plus the server snapshot. Equal timestamps with identical content return `unchanged`; equal timestamps with different content deterministically keep the existing server snapshot and return `conflict`.
3. A successful insert or winning content change gets the next server `sync_seq`. An unchanged or losing push does not increment it. The server preserves client `created_at`/`updated_at`; it never uses these clocks as pull cursors.
4. Delete is a normal snapshot with `deleted_at` set and `updated_at` advanced by the client. Tombstones remain pullable and are not physically removed during Stage 1. An explicit later snapshot with newer `updated_at` and `deleted_at:null` is an intentional restore. Category deletion does not cascade transactions; it prevents selecting the category for new transactions, while history remains intact.
5. Category and budget uniqueness conflicts are rejected with `409`; they are not silently merged. An entity reference must belong to the authenticated user.

### Pull shape and cursor

`cursor` is a per-user integer, initially `0`; `limit` defaults to 500 and is capped at 1000. The server returns the earliest rows with `sync_seq > cursor`, ordered ascending, including tombstones. `next_cursor` is the highest returned sequence (or the input cursor for an empty page); `has_more` says whether another page is already available. The client repeats with `cursor=next_cursor` until `has_more=false`, then stores that cursor. The next sync starts there. A record changed after an earlier page receives a later sequence and is delivered again. Clients upsert by entity UUID and apply tombstones. Pull queries are always scoped to the authenticated user.

```json
{
  "changes": [{"entity": "transaction", "record": {"id": "...", "sync_seq": 42, "deleted_at": null}}],
  "next_cursor": 42,
  "has_more": false
}
```

### Worked examples

1. **Retry:** Device A creates UUID `T1`, timestamp `10:00`, amount `₹30`. Server accepts it with `sync_seq=7`. A network timeout causes the exact push to be retried. The server returns the same record as `unchanged`, leaves `sync_seq=7`, and creates no duplicate.
2. **Two-device conflict:** A and B both have `T1`. A edits note at `10:05`; B edits amount at `10:07` while offline. A syncs first and gets sequence 8. B's later timestamp wins when pushed, so server stores B's complete snapshot at sequence 9. B gets `applied`; A's next pull receives sequence 9 and replaces its snapshot. If B had the older timestamp, B would receive A's winner instead.
3. **Delete propagation:** A deletes `T1` at `11:00`, pushing `deleted_at=11:00` and `updated_at=11:00`. Server stores a tombstone at sequence 10. B pulls it and hides `T1` locally. If B later intentionally restores it with `updated_at=11:05` and `deleted_at=null`, that newer snapshot wins and is delivered as a live record with a new sequence.

## 4. Conventions

- **Versioning:** prefix all routes with `/api/v1`; breaking API changes use `/api/v2`.
- **Errors:** `{ "error": { "code": "invalid_credentials", "message": "Email or password is incorrect.", "details": [], "request_id": "..." } }`. `details` contains field/path and validation message, never secrets. Stable machine-readable `code`; status codes follow endpoint table.
- **Auth:** short-lived signed bearer access token; refresh token is high-entropy opaque secret, returned once and stored securely by mobile. Passwords are hashed with Argon2id. Never log credentials or tokens.
- **Time:** API timestamps are UTC ISO 8601 with `Z` (e.g. `2026-10-20T10:00:00Z`) and PostgreSQL `TIMESTAMPTZ`. Client timestamps are required on sync records. Dates/months are ISO calendar values (`YYYY-MM-DD`, `YYYY-MM`); transaction dates are not shifted by timezone conversion.
- **Validation:** trim and normalize email to lowercase; password minimum 12 characters, maximum 128; names 1–60 chars; color `#RRGGBB`; notes max 500 chars; amount positive integer paise and bounded to PostgreSQL `BIGINT`; reject unknown enum values, naive datetimes, invalid UUIDs, inverted date ranges, and timestamps whose `updated_at < created_at`. Never coerce money from decimal/float.
- **Pagination:** page-number format for filtered transaction browsing; cursor format for sync. Stable transaction ordering includes `id` as a tie-breaker.
- **Naming:** Python modules/functions `snake_case`; SQL tables/columns `snake_case`; Pydantic schemas `PascalCase`; JSON fields `snake_case`; enum values lowercase.
- **Authorization:** derive `user_id` from the authenticated principal, never trust it from request JSON. Admin-only future routes check role explicitly; every query still scopes to a user unless intentionally handling an admin operation.

## 5. Stage 2 implementation

- **Rate limiting:** auth-sensitive routes use atomic database-backed fixed windows. Configure with `AUTH_RATE_LIMIT_PER_MINUTE` and `AUTH_RATE_LIMIT_PER_HOUR`; buckets are keyed by action and client IP.
- **Pluggable auth provider:** `core/auth_providers.py` defines an `IdentityProvider` protocol and Google implementation. Production token verification uses `google-auth`; tokeninfo is a development fallback.
- **Email verification:** `email_verified_at` is enforced by login and `get_current_user` when `REQUIRE_EMAIL_VERIFICATION=true` (default). Tokens are hashed, single-use, and expire after 24 hours. Delivery uses SMTP or the development console.
- **Refresh revocation:** refresh sessions store token hashes and family IDs. Reuse revokes the family; password reset/change and logout-all increment `token_version` to revoke access tokens too.
- **Password reset:** one-time hashed tokens expire after 30 minutes. Forgot-password responses are generic to avoid account enumeration.

## 6. Implemented `apps/api` layout

```text
apps/api/
  alembic/                  # database migration revisions and env setup
  src/expense_tracker_api/
    main.py                 # app assembly, middleware, errors, OpenAPI
    api/v1/router.py        # mounts the domain routers
    api/v1/auth.py          # account and authentication endpoints
    api/v1/categories.py    # category endpoints
    api/v1/transactions.py # transaction endpoints and filters
    api/v1/budgets.py       # budget endpoints
    api/v1/summaries.py     # monthly SQL summaries and trends
    api/v1/sync.py          # sync push/pull contract
    api/v1/common.py        # shared API helpers and token response
    core/config.py          # pydantic-settings configuration
    core/security.py        # Argon2 passwords and API tokens
    core/dependencies.py   # one current-user dependency and DB session
    core/auth_providers.py  # pluggable identity provider and Google verifier
    core/action_tokens.py  # hashed verification/reset token lifecycle
    core/email.py           # SMTP and local console delivery
    core/rate_limit.py      # database-backed auth request throttling
    db/session.py           # SQLAlchemy engine and session factory
    models.py               # SQLAlchemy table mappings and constraints
    schemas.py              # Pydantic v2 request/response models
  tests/
    conftest.py             # isolated in-memory SQLite test fixture
    test_auth*.py           # auth, verification, password, Google, rate limit tests
    test_resources.py       # CRUD and cross-user isolation tests
    test_summaries.py       # calculation boundaries and empty months
    test_sync.py            # retry, conflict, cursor and isolation tests
  scripts/seed_demo.py      # opt-in local sample data
```

Domain routers are separate, but currently keep request handling and their SQL/domain operations together. Shared serialization, errors, sync sequence allocation, and token response helpers are in `api/v1/common.py`; reusable security mechanisms are in `core/`. Models have no HTTP behavior. Tests use SQLite, so PostgreSQL-specific concurrency and migration behavior still needs validation against a real PostgreSQL instance.

## 7. Open questions and risks

1. **Currency:** assume INR only for Stage 1. Confirm whether currency must be stored per user/transaction before schema migrations; multi-currency later is not a safe implicit extension of paise.
2. **Income:** this design includes `kind=income` and summary net totals. Confirm whether Stage 1 is expense-only; removing income later would be a breaking semantic change.
3. **Timestamp trust:** client clock drives conflict resolution. Decide whether to reject timestamps too far in the future (protects against a bad clock poisoning LWW) and what tolerance to use; strict rejection can block offline sync.
4. **Sync payload atomicity:** proposed all-or-nothing batches simplify retries but one invalid item blocks the batch. Confirm versus per-item partial success.
5. **Category delete policy:** proposed soft-delete only and retain historical transactions. Confirm whether deleting a category should require reassignment first.
6. **Search:** trigram indexes speed substring search but add PostgreSQL extension/migration requirements. Confirm whether basic `ILIKE` is sufficient for initial data volume.
7. **Budget month:** assumes calendar month, with one overall and at most one budget per category. Confirm whether custom periods or multiple budget plans are needed.
8. **Refresh sessions:** access token lifetime and refresh lifetime are operational/security choices; choose values before implementation. Rotation is recommended; concurrent refresh from two devices needs a per-session policy.
9. **User deletion/retention:** no account deletion or data-retention policy is defined. Decide whether this is a Stage 1 requirement before production.
