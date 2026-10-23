# Paisa API endpoint guide

Base URL: `http://127.0.0.1:8000/api/v1`. Except registration/login/refresh/health, routes require `Authorization: Bearer <access_token>`. JSON errors follow `{ "error": { "code", "message", "details", "request_id" } }`.

## Auth

| Method | Path | Request | Success |
|---|---|---|---|
| POST | `/auth/register` | `{ "email", "password" }` | 201 token envelope; duplicate email is 409 |
| POST | `/auth/login` | `{ "email", "password" }` | token envelope; invalid credentials 401 |
| POST | `/auth/refresh` | `{ "refresh_token" }` | new access token and same refresh token; expired/revoked 401 |
| POST | `/auth/logout` | `{ "refresh_token" }` | `{ "ok": true }`; revokes this refresh session |
| GET | `/auth/me` | — | `{ "id", "email", "role", "is_active" }` |

Token envelope: `{ "user": {...}, "access_token": "...", "token_type": "bearer", "expires_in": 900, "refresh_token": "..." }`.

## Categories, transactions, budgets

CRUD create/patch responses are JSON resource objects. Category and budget lists return `{ "items": [...] }`; transaction lists also return page metadata. CRUD IDs are UUIDs (the sync adapter also understands existing mobile category aliases `cat-0` through `cat-8`). Deletes are soft deletes. Create requests for these resources require client `id`, `created_at`, and `updated_at` fields.

| Method | Path | Request/query | Notes |
|---|---|---|---|
| GET | `/categories` | `include_deleted` (default `false`) | Current user's categories |
| POST | `/categories` | `{ "id", "name", "color?", "icon?", "type?", "is_archived?", "sort_order?", "created_at", "updated_at" }` | Creates category |
| GET | `/categories/{id}` | UUID path | 404 for missing or another user's row |
| PATCH | `/categories/{id}` | partial category object | Updates own category |
| DELETE | `/categories/{id}` | UUID path | Soft deletes own category |
| GET | `/transactions` | `from?`, `to?` (`YYYY-MM-DD`), `category_id?`, `q?`, `kind?` (`expense`/`income`), `page?` (default 1), `page_size?` (default 50, max 100), `sort?` (`date_desc`/`date_asc`) | Date range, category and text filters; returns items/page/page_size/total/pages |
| POST | `/transactions` | `{ "id", "category_id", "amount_paise", "transaction_date", "kind", "created_at", "updated_at", "merchant?", "place?", "note?", "payment_mode?" }` | Amount is positive integer paise; kind is expense/income/refund |
| GET | `/transactions/{id}` | UUID path | Own transaction |
| PATCH | `/transactions/{id}` | partial transaction object | Own transaction |
| DELETE | `/transactions/{id}` | UUID path | Soft delete |
| GET | `/budgets` | `month?` (`YYYY-MM`) | Returns current user's budgets |
| POST | `/budgets` | `{ "id", "month" (YYYY-MM-01), "amount_paise", "created_at", "updated_at", "category_id?" }` | Overall or category budget |
| GET | `/budgets/{id}` | UUID path | Own budget |
| PATCH | `/budgets/{id}` | partial budget object | Own budget |
| DELETE | `/budgets/{id}` | UUID path | Soft delete |

Summary/report endpoints are deliberately absent: the mobile engine calculates them from synced records.

## Sync

`POST /sync/push` accepts up to 500 changes and returns a per-record status. Example:

```json
{
  "changes": [{
    "resource": "transaction", "id": "b36bd1e0-28e4-4f5c-aea9-515b64940256",
    "op": "upsert", "updated_at": "2026-10-23T10:00:00Z",
    "data": {"id":"b36bd1e0-28e4-4f5c-aea9-515b64940256", "amount": 25000,
      "categoryId":"cat-0", "place":"Cafe", "note":"Lunch", "paymentMode":"upi",
      "date":"2026-10-23", "time":"15:30", "createdAt":"2026-10-23T10:00:00Z",
      "provenance":"user"}
  }]
}
```

Resources: `category`, `transaction`, `budget_period`, `budget_allocation`, `budget_transfer`, `person`, `group_bill`, `settlement`, `attachment`, `user_settings`, `place_rule`. Each change has `resource`, `id`, `op` (`upsert`/`delete`), timezone-aware `updated_at`, and `data` (empty on delete); optional `group_id` makes changes atomic. Results include `status` (`applied`, `unchanged`, `stale`, `rejected`), `sync_seq`, and `reason_code` when rejected.

`GET /sync/pull?cursor=0&limit=500` returns `{ "changes": [...], "next_cursor": 123, "has_more": false }`. Each entry includes resource/id/op/sync_seq/timestamps/data. Cursor 0 bootstraps current state. Continue with `next_cursor`; if retention has expired, response is 410 `cursor_too_old` and the client performs a full pull.

## Attachments

| Method | Path | Request | Success |
|---|---|---|---|
| PUT | `/attachments/{uuid}` | raw JPEG/PNG/WebP bytes; `X-Checksum-SHA256` header | metadata JSON; max 5 MiB, decoded and metadata-stripped |
| GET | `/attachments/{uuid}` | — | authenticated private image bytes; another user's ID is 404 |

## AI drafts

Every AI route is authenticated, checks the user's master and feature toggles, and returns `{ "type", "payload", "confidence", "reason", "provider" }`. None of these routes creates or modifies a transaction.

| Method | Path | JSON request |
|---|---|---|
| POST | `/ai/parse-entry` | `{ "text", "context": {"now?", "timezone?", "recent_places?", "categories?"} }` |
| POST | `/ai/suggest-category` | `{ "place", "categories": [{"id","name"}] }` |
| POST | `/ai/propose-budget` | `{ "total_paise", "start_day", "history": [...], "categories": [...] }` |
| POST | `/ai/draft-split` | `{ "text", "people": [{"id","name"}], "categories": [...] }` |
| POST | `/ai/ask` | `{ "question", "categories": [...], "periods": [...] }`; returns a structured query only |
| POST | `/ai/month-narrative` | `{ "report": {...}, "categories": [...] }`; report must be pre-aggregated by mobile |
| POST | `/ai/parse-receipt` | multipart field `file`, or JSON `{ "attachment_id": "uuid" }` |

AI limit errors return 429 with `Retry-After`; unavailable provider/toggle returns 503 `ai_unavailable`. Send the Anthropic key in `apps/api/.env.local` as `ANTHROPIC_API_KEY`; an empty key selects deterministic mock AI.

## Health and interactive docs

`GET /health` returns `{ "status": "ok" }`. OpenAPI and Swagger UI are served at `/openapi.json` and `/docs`.
