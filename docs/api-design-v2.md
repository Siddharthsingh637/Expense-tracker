# Paisa API design v2 — implemented contract

Status: implemented in `apps/api`; the manual endpoint reference is in `docs/api-endpoints.md`. This document records the approved mobile mapping and design risks for future changes.

## 1. Mobile contract findings

`apps/mobile/src/engine/types.ts` is the canonical domain contract. `Paise` is a TypeScript `number`, but persisted values must be safe non-negative integers in PostgreSQL `BIGINT`; transaction `amount` is a signed integer by the mobile comment (positive expense, negative income/refund), whereas the requested API model says positive magnitude plus `kind`. Proposed wire format normalizes this as `amountPaise` positive magnitude with `kind` (`expense|income|refund`) while an adapter maps to/from the app's signed `amount`. This is a breaking-contract point to resolve before implementation. Other differences: mobile transaction has `date` and `time` (local calendar/time), while the request calls for `occurred_at` UTC; mobile budgets use `MonthBudget{month,totalPaise,startDay}` and `BudgetAllocation{month,categoryId,allocatedPaise}` rather than period ids/date bounds; mobile GroupBill does not store total or computed shares (total is `sum(payments)` and shares are derived); mobile settlement tracks partial paid amount/status.

Enums in the mobile engine: `PaymentMode = cash|upi|card`; `TransactionProvenance = user|ai_confirmed|ai_edited`; `CategoryType = fixed|variable|savings`; `SplitMethod = equal|custom|percent|shares|itemized`. Category also has `icon`, `color`, `isArchived`, `sortOrder`. Transaction has `id, amount, categoryId, place, note, paymentMode, billPhotoUri?, date, time, createdAt, provenance, splitId?, isTransfer?`. `isTransfer` is explicitly described as intra-budget category transfer; the new design forbids budget transfers being transactions. This field should be omitted from persisted transaction payloads and legacy local values must be normalized/ignored during sync. `GroupBill` exact shape is `id,title,date,personIds,payments,method,customShares?,percentShares?,shareWeights?,items?,taxPaise?,tipPaise?,categoryId?,isSettled,createdAt`; `SplitItem` is `id,description,amountPaise,assignedPersonIds`. `BillSettlement` is `id,groupBillId,fromPersonId,toPersonId,amountPaise,paidAmountPaise,isPaid,paidAt?`. `Person` is `id,name,upiId?,isMe,isArchived`; the engine's reserved owner id is literal `me` in examples, and `isMe` means it is represented in the person's list (the API request instead says `me` is not a row).

The AI interface in `apps/mobile/src/ai/types.ts` is six methods, not seven: parseEntry, suggestCategory, proposeBudget, draftSplit, answerQuestion, monthNarrative. The API proposal adds receipt parsing as the seventh endpoint. Mobile's generic envelope is `{data,confidence,reason,latencyMs}`; the proposed server envelope `{type,payload,confidence,reason,provider}` needs a client adapter (including mapping `payload` to `data` and latency metadata) or an intentional mobile contract update. Current mock behavior is in `apps/mobile/src/ai/mock.ts`: parsing guesses one positive amount, merchant, payment mode, today's date; category uses keyword rules and defaults to Other; budget uses category history ratios or a 50/30/20 template; split parsing returns an equal draft with unresolved person names; question answering computes from local transactions/allocations; narrative derives from `MonthReport`. The server must not reproduce local calculations for question answering; the replacement `/ai/ask` returns only a structured query for the engine. Golden cases are present in `engine/__tests__/splits.test.ts`, `allocate.test.ts`, and `budget.test.ts`.

## 2. Existing API inventory: reuse and migration

Reuse the package and layering in `apps/api/src/expense_tracker_api`: FastAPI application and `/api/v1` composition; Pydantic settings; SQLAlchemy 2 session/base; one `get_current_user`; Argon2/JWT auth helpers; sync sequence helper; common serialization/error helpers; Alembic environment; pytest fixtures and auth/resource/sync/summary coverage; existing setup README and seed script. Existing v1 routes are `auth`, `categories`, `transactions`, `budgets`, `summaries`, and `sync`.

Keep migration history `0001_stage1_core` and `0002_stage2_auth_security` immutable and add forward migrations only. Extend/replace ORM models and schemas through a migration: existing `Category` is missing mobile `type/isArchived/sortOrder`; `Transaction` currently uses `transaction_date/merchant`, allows only expense/income, and omits payment mode, time, provenance, split, receipt; `Budget` is a monthly overall/category row, not period/allocation/transfer; existing sync accepts only category/transaction/budget and has no operations/group atomicity/retention. `RefreshSession` already stores a token hash, but current security extras (`AuthActionToken`, email verification, Google provider flow, auth rate limits, `token_version`, `family_id`) are beyond the requested stage and must not be exposed or required. Retain only provider-neutral seams and refresh revocation needed for logout. Existing summaries and CRUD routes must be documented as legacy convenience APIs and either adapted to the mobile wire shapes or removed only after client references are checked. Do not retain server-side balance/settlement/report calculations: mobile engine owns them.

Current files to extend/review: `models.py`, `schemas.py`, `api/v1/{router,auth,categories,transactions,budgets,summaries,sync,common}.py`, `core/{config,dependencies,security,auth_providers,rate_limit,email,action_tokens}.py`, `db/session.py`, Alembic revisions, tests, `apps/api/README.md`, and `scripts/seed_demo.py`. The router and config currently include Stage 2 email, Google, CORS and general auth rate-limit settings; remove those route behaviors/config requirements from this scope. Existing workspace has untracked project files (`git status` showed `.gitignore`, project files, `apps/`, `docs/`, package files); preserve them. Current implementation uses `.env.local` and a hardcoded local JWT fallback; proposed setup changes these safely via a non-overwriting initializer.

## 3. Conventions and shared types

- API root `/api/v1`; JSON `snake_case` at the wire, UUIDs as canonical strings. A typed client can map to mobile camelCase.
- Money: integer paise only, `BIGINT` storage and JSON integer; reject booleans, fractions, unsafe integers, NaN, and values outside signed 64-bit range. No computed balances or reports in API.
- Instants: RFC 3339/ISO 8601 UTC with `Z`, PostgreSQL `timestamptz`. Date-only values use `YYYY-MM-DD`. The mobile transaction's date and time represent local wall time; preserve those separately and require an IANA `timezone` on transaction if converting to UTC is necessary. Do not silently reinterpret a date/time without its timezone.
- Errors: `{ "error": { "code": "...", "message": "...", "details": [...] } }`; validation uses code `validation_error`. Auth errors are generic. AI unavailable is HTTP 503/code `ai_unavailable`; throttles are 429 with `Retry-After`.
- All resource lookups and uniqueness checks include `user_id`; composite FKs use `(user_id,id)` where references are persisted. A client never supplies `user_id` or `sync_seq`.
- Common synced-record columns: `id UUID PK` (client generated), `user_id UUID NOT NULL FK users`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL` (client value clamped if > server now + 5 minutes), `deleted_at timestamptz NULL`, `sync_seq BIGINT NOT NULL`. Index `(user_id,sync_seq)` unique per record table and `(user_id,updated_at)` where helpful. A per-user counter row is locked and incremented inside each committed unit of work; allocate sequence only for applied mutations.
- `id` for the reserved owner participant is literal `me`, not a UUID. Therefore person IDs are text IDs, and references to people are strings. Other resource IDs remain UUID. Proposed all client-generated synced IDs use UUID except this explicit mobile sentinel.

## 4. Tables (proposed PostgreSQL columns)

Notation `synced` means the common columns above. All business resource rows have a composite unique `(user_id,id)` for tenant-safe FKs. Indexes listed are additional to PK/unique indexes.

### users

`id UUID PK`, `email VARCHAR(320) NOT NULL UNIQUE` (normalized lowercase), `password_hash TEXT NOT NULL`, `role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK user|admin`, `is_active BOOLEAN NOT NULL DEFAULT true`, `auth_provider VARCHAR(40) NULL`, `provider_user_id VARCHAR(255) NULL`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`. Unique partial `(auth_provider,provider_user_id)` where both non-null. No verification fields for this stage.

### categories

`synced`; `name VARCHAR(60) NOT NULL`, `type VARCHAR(10) NOT NULL CHECK fixed|variable|savings`, `icon VARCHAR(40) NOT NULL`, `color CHAR(7) NOT NULL` (hex), `is_archived BOOLEAN NOT NULL DEFAULT false`, `sort_order INTEGER NOT NULL DEFAULT 0`. Index `(user_id,sort_order)`, case-insensitive unique active name per user (partial where `deleted_at IS NULL`). Registration seeds Food, Transport, Bills, Shopping, Health, Entertainment, Other in that order; exact icons/colors come from `apps/mobile/src/lib/constants.ts` and should be exported, not guessed.

### transactions

`synced`; `amount_paise BIGINT NOT NULL CHECK > 0`, `category_id UUID NOT NULL`, `place VARCHAR(120) NOT NULL DEFAULT ''`, `note VARCHAR(500) NOT NULL DEFAULT ''`, `payment_mode VARCHAR(8) NOT NULL CHECK cash|upi|card`, `local_date DATE NOT NULL`, `local_time TIME NOT NULL`, `timezone VARCHAR(64) NOT NULL`, `kind VARCHAR(10) NOT NULL CHECK expense|income|refund`, `provenance VARCHAR(16) NOT NULL CHECK user|ai_confirmed|ai_edited`, `group_bill_id UUID NULL`, `attachment_id UUID NULL`. Composite same-user FKs to category, group bill, attachment; these references are validated after all rows in the sync atomic group are staged. Indexes `(user_id,local_date,id)`, `(user_id,category_id,local_date)`, `(user_id,updated_at)`. Mobile signed `amount` maps `expense => +amount_paise`, `income/refund => -amount_paise`; confirm this mapping with client before coding. `splitId` maps to `group_bill_id`; `billPhotoUri` maps to private attachment ID, never a device URI.

### budget_periods

`synced`; `start_date DATE NOT NULL`, `end_date DATE NOT NULL CHECK end_date >= start_date`, `total_paise BIGINT NOT NULL CHECK >= 0`, `status VARCHAR(8) NOT NULL CHECK open|closed`, `closed_at timestamptz NULL`; unique `(user_id,start_date)` for non-deleted rows. Mobile `MonthBudget{month,totalPaise,startDay}` maps to period dates calculated by mobile `parseBudgetPeriod(month,startDay)`; persist `month CHAR(7)` and `start_day SMALLINT CHECK 1..28` in addition to dates so roundtrip keeps the exact mobile source values. Unique partial `(user_id,month)` where active.

### budget_allocations

`synced`; `period_id UUID NOT NULL`, `category_id UUID NOT NULL`, `amount_paise BIGINT NOT NULL CHECK >= 0`, `rollover BOOLEAN NOT NULL DEFAULT false`; same-user composite FKs; unique `(user_id,period_id,category_id)` active. Mobile uses `month` rather than period ID and `allocatedPaise`; wire adapter resolves period by month. Do not require allocation sum <=/== period total.

### budget_transfers

`synced`; `period_id UUID NOT NULL`, `from_category_id UUID NOT NULL`, `to_category_id UUID NOT NULL`, `amount_paise BIGINT NOT NULL CHECK > 0`, `note VARCHAR(500) NOT NULL DEFAULT ''`, `voided_at timestamptz NULL`; same-user FKs; `CHECK(from_category_id <> to_category_id)`. Insert-only by ID: duplicate identical retry is unchanged; same ID with different immutable fields rejects `invariant_violation`; void is append/update of `voided_at`. Not a mobile `Transaction`.

### people

`id VARCHAR(80)` (client ID; reserved `me` is virtual and never stored), `user_id UUID`, common timestamp/tombstone/sync fields, `name VARCHAR(100) NOT NULL`, `upi_id VARCHAR(255) NULL`, `is_archived BOOLEAN NOT NULL DEFAULT false`; unique `(user_id,id)`, index `(user_id,name)`. API returns a synthetic `me` participant descriptor where needed, without a row. Mobile `isMe` is a client-side marker; server must not allow creating the sentinel.

### group_bills

`synced`; `title VARCHAR(160) NOT NULL`, `bill_date DATE NOT NULL`, `person_ids JSONB NOT NULL` (ordered string IDs), `payments JSONB NOT NULL` (participant ID to non-negative integer paise), `method VARCHAR(10) NOT NULL CHECK equal|custom|percent|shares|itemized`, `custom_shares JSONB NULL`, `percent_shares JSONB NULL`, `share_weights JSONB NULL`, `items JSONB NULL` (array `{id,description,amountPaise,assignedPersonIds}`), `tax_paise BIGINT NOT NULL DEFAULT 0 CHECK >=0`, `tip_paise BIGINT NOT NULL DEFAULT 0 CHECK >=0`, `category_id UUID NULL`, `is_settled BOOLEAN NOT NULL DEFAULT false`. Same-user category FK. One JSON document gives mobile whole-document LWW. Total is derived from payments (matching engine `totalPaid`), and shares/balances/debt simplification are derived client-side; do not persist computed `shares[]`. Checks: unique participants; all amounts non-negative integers; payment keys must be participants; at least one participant; item assignments refer to participants; itemized sums/tax/tip should be validated against total according to mobile algorithm (see risk below). Index `(user_id,bill_date)`.

### settlements

`synced`; `group_bill_id UUID NOT NULL`, `from_person_id VARCHAR(80) NOT NULL`, `to_person_id VARCHAR(80) NOT NULL`, `amount_paise BIGINT NOT NULL CHECK > 0`, `paid_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK 0..amount`, `is_paid BOOLEAN NOT NULL DEFAULT false`, `paid_at timestamptz NULL`, `voided_at timestamptz NULL`; same-user FK to bill; distinct from/to; participant membership validated against bill at group commit. Insert-only except `paid_amount_paise/is_paid/paid_at` progress and void; this is the mobile `BillSettlement`, so settlement status is mutable. Concurrent updates need a monotonic merge rule for paid amount (max) or explicit conflict rejection; see decisions.

### attachments

`synced`; `transaction_id UUID NOT NULL`, `mime_type VARCHAR(32) NOT NULL CHECK image/jpeg|image/png|image/webp`, `size_bytes BIGINT NOT NULL CHECK 0..5242880`, `checksum_sha256 CHAR(64) NOT NULL`, `upload_status VARCHAR(12) NOT NULL CHECK pending|uploaded|failed`, `storage_key TEXT NULL`; unique `(user_id,transaction_id)` if one receipt per transaction (mobile provides one `billPhotoUri`). Same-user transaction FK, index `(user_id,checksum_sha256)`. Raw bytes live in storage backend; metadata sync only. Do not permit arbitrary synced `storage_key` updates.

### user_settings

One row per user, server-generated stable UUID for uniform sync; user_id unique FK. `budget_start_day SMALLINT NOT NULL CHECK 1..28`, `ai_enabled BOOLEAN NOT NULL DEFAULT true`, `entry_parsing_enabled BOOLEAN NOT NULL DEFAULT true`, `categorization_enabled BOOLEAN NOT NULL DEFAULT true`, `split_drafting_enabled BOOLEAN NOT NULL DEFAULT true`, `budget_suggestions_enabled BOOLEAN NOT NULL DEFAULT true`, `summaries_enabled BOOLEAN NOT NULL DEFAULT true`, plus `created_at,updated_at,deleted_at,sync_seq`. Maps exactly to mobile `budgetStartDay,aiEnabled,aiFeatureToggles`.

### place_rules

`synced`; `place_pattern VARCHAR(200) NOT NULL`, `category_id UUID NOT NULL`; same-user category FK; unique `(user_id,place_pattern)` active; index `(user_id,category_id)`. Case folding/substring semantics must match mobile rules when rule lookup is added; there is currently no mobile persisted rule schema, so treat as optional future-compatible resource.

### refresh_tokens

`id UUID PK`, `user_id UUID NOT NULL FK`, `token_hash BYTEA NOT NULL UNIQUE`, `created_at timestamptz NOT NULL`, `expires_at timestamptz NOT NULL`, `revoked_at timestamptz NULL`. Index `(user_id,expires_at)`. Access JWT includes `sub,iat,exp,jti`; logout revokes presented refresh record. No rotation in this scope.

### ai_usage

`id BIGINT GENERATED ALWAYS AS IDENTITY PK`, `user_id UUID NOT NULL FK`, `endpoint VARCHAR(40) NOT NULL`, `model VARCHAR(120) NOT NULL`, `tokens_in INTEGER NOT NULL DEFAULT 0`, `tokens_out INTEGER NOT NULL DEFAULT 0`, `latency_ms INTEGER NOT NULL`, `status VARCHAR(16) NOT NULL CHECK success|invalid_output|provider_error|rate_limited`, `created_at timestamptz NOT NULL`. Index `(user_id,created_at)` and `(user_id,endpoint,created_at)`. Store no prompt, image, response, merchant string, or query text. Usage records also provide fixed-window per-user AI limit counters.

### sync_state

`user_id UUID PK FK`, `last_sync_seq BIGINT NOT NULL DEFAULT 0`, `retained_from_seq BIGINT NOT NULL DEFAULT 0`, `updated_at timestamptz NOT NULL`. Sequence monotonic per user and shared across all synced resource tables; cursor expiry determined by retained tombstone/history boundary. For correctness, pull requires a unified append-only `sync_changes(user_id,sync_seq,resource,record_id,operation,snapshot_json,created_at)` change log, or an equivalent table-level union scan. Recommend change log with one row per visible mutation; it avoids holes when a resource is hard-purged and makes retention/cursor validation deterministic. Snapshot contains metadata only, no attachment bytes.

## 5. Sync contract

### Push

`POST /api/v1/sync/push`, bearer auth. Request:

```json
{
  "changes": [
    {"resource":"transaction","id":"UUID","op":"upsert","updated_at":"2026-10-22T10:00:00Z","data":{"amount_paise":3500,"category_id":"UUID","place":"Chai","note":"","payment_mode":"upi","local_date":"2026-10-22","local_time":"09:55:00","timezone":"Asia/Kolkata","kind":"expense","provenance":"user","group_bill_id":null,"attachment_id":null}},
    {"resource":"category","id":"UUID","op":"delete","updated_at":"2026-10-22T10:01:00Z","data":{},"group_id":"move-uuid"}
  ]
}
```

Allowed resource names: `category,transaction,budget_period,budget_allocation,budget_transfer,person,group_bill,settlement,attachment,user_settings,place_rule`. `id` identifies the row; for `person`, string IDs except reserved `me`; `data` contains all resource fields except id/user/timestamps/seq. Delete is a tombstone, not SQL delete. Upsert creation includes `created_at` in data; update timestamps are the envelope timestamp. Unknown/immutable/server-controlled fields reject. Maximum 500 changes and 1 MiB request body.

Response `{ "results": [{"resource":"...","id":"...","status":"applied|unchanged|stale|rejected","sync_seq":123|null,"reason_code":null|"invariant_violation|missing_reference|validation_error|stale","message":"..."}] }`. Whole request returns 200 when accepted for processing; malformed envelope returns 422. Each ungrouped change is an independent savepoint. Each `group_id` forms one atomic unit: validation and writes are staged, same-user references resolved across staged+stored records, then all commit or all return rejected. Rejection never commits a partial group. Response ordering mirrors input.

LWW compares UTC-normalized `updated_at`; a timestamp > server-now + 5 minutes is clamped to server-now. Newer applies; older returns stale and current version reference; equal timestamp plus identical canonical data is unchanged (retry-safe); equal timestamp with different data returns stale with deterministic tie-break policy required (recommend compare a canonical SHA-256 of normalized JSON and choose lexicographically larger hash, but this may surprise devices; decide before coding). Every applied upsert/tombstone gets a new user sync_seq regardless of client clock.

`budget_transfer` and `settlement` are insert-only in identity/content. Exact retry is unchanged. Conflicting duplicate id is rejected. A void is a later explicit `voided_at` update; for settlements, mobile also needs partial-payment status updates, so only payment-progress fields are mutable and merge by max paid amount, with `is_paid` derived or validated. GroupBill is one whole-document LWW unit; no field merge.

### Pull

`GET /api/v1/sync/pull?cursor=0&limit=500`, bearer auth. Response:

```json
{"changes":[{"resource":"transaction","id":"UUID","op":"upsert","sync_seq":101,"created_at":"...","updated_at":"...","deleted_at":null,"data":{}}],"next_cursor":101,"has_more":true}
```

Query unified sync log where `(user_id=current_user, sync_seq > cursor)`, order ascending, fetch `limit+1`, return at most `limit`; `next_cursor` is last returned seq (unchanged cursor for empty page). Full pull starts at 0. If cursor predates `retained_from_seq`, return 410 `{error:{code:"cursor_too_old",...}}`; app clears remote replica and starts from zero. Tombstones are retained at least 90 days; purge only when cursor retention boundary advances safely. Cursor is a decimal per-user sequence, never a timestamp.

Worked examples (IDs abbreviated):

1. **Retry:** Device A upserts transaction T at 10:00. Server assigns seq 22. A retries identical payload after lost response; equal timestamp+same normalized data returns `unchanged`, remains seq 22, no duplicate.
2. **Two-device conflict:** A and B pull T at 10:00. A edits note at 10:05; B edits place at 10:06. B pushes first, seq 23. A pushes older timestamp, gets `stale` and must pull seq 23 then present/reapply its edit. If clocks tie exactly, tie policy above applies; timestamps alone cannot infer true edit order under clock skew.
3. **Atomic category move:** A sends two allocation upserts plus one transfer under `group_id=G`. One references a missing category; server rejects all three as `missing_reference`, and no sequence values are consumed. After category is synced, retry group; all three apply with three consecutive sync_seq values. Both devices subsequently pull all three changes.

## 6. Auth and settings endpoints

All paths under `/api/v1`; access token short-lived JWT; refresh token opaque random secret stored only as SHA-256 hash; bearer access required except register/login/refresh. Schemas:

- `POST /auth/register`: `{email,password}` -> `{user:{id,email,role,is_active},access_token,token_type:"bearer",expires_in,refresh_token}`. Email normalized lowercase; password Argon2; create defaults and UserSettings in same transaction. Errors 409 `email_exists`, 422 validation.
- `POST /auth/login`: `{email,password}` -> same token envelope. 401 generic `invalid_credentials`; 403 `account_inactive`.
- `POST /auth/refresh`: `{refresh_token}` -> new access JWT + same refresh token (no rotation). 401 invalid/expired/revoked.
- `POST /auth/logout`: `{refresh_token}` -> `{ok:true}`; revoke matching user token idempotently. Requires bearer auth.
- `GET /auth/me`: -> `{id,email,role,is_active}`.

## 7. AI gateway schemas

Every endpoint auth required, feature toggle required, enforces configurable per-user minute and daily limits before provider call. Request failures map to 422 schema, 429 `ai_rate_limited` with `Retry-After`, 503 `ai_unavailable`. Standard response `{type,payload,confidence:0..1,reason,provider:"mock"|"anthropic"}`; `latency_ms` belongs in response metadata only if mobile needs it; persist AIUsage only. Prompts are versioned at `src/expense_tracker_api/ai/prompts/vN/...`; all structured provider results validated as Pydantic. On validation failure retry once with schema repair instruction, then return 503 and metadata status invalid_output.

1. `POST /ai/parse-entry`: `{text,context:{recent_places:string[],categories:[{id,name,type}],now:datetime,timezone:string}}` -> `type:"transaction"`, payload `{amount_paise?:int,place:string,note?:string,payment_mode?:cash|upi|card,local_date?:date,local_time?:time,kind?:expense|income|refund,category_id?:UUID}`. Draft only. Mock must mirror current one-amount regex behavior and category/date convention; mobile can map positive/negative sign.
2. `POST /ai/suggest-category`: `{place:string,categories:[{id,name,type}]}` -> `type:"category"`, payload `{category_id:UUID}`. Do not send amount (mobile currently has amount arg but mock ignores it).
3. `POST /ai/propose-budget`: `{total_paise:int>=0,start_day:1..28,history:[{category_id,average_paise:int>=0}],categories:[{id,name,type}]}` -> `type:"budget_allocations"`, payload `{allocations:[{category_id,amount_paise:int>=0,reason:string}]}`. API may deterministically scale/round output via largest remainder so sum <= total; never ask model to calculate authoritative totals. For no history mock follows app's 50/30/20 pattern, but exact template constants must be read from `src/lib/constants.ts` and supplied IDs matched, not fabricated `cat-*` IDs.
4. `POST /ai/draft-split`: `{text,people:[{id,name}],categories:[{id,name}]}` -> `type:"group_bill"`, payload partial mobile GroupBill plus `unmatched_names:string[]`; method enum exact. Model output cannot assert unresolved names as real IDs. Mock currently extracts title/amount/names, defaults equal, `payments:{me:amount}`, `isSettled:false`.
5. `POST /ai/ask`: `{question:string,categories:[{id,name}],periods:[{month,start_date,end_date}]}` -> `type:"query"`, payload `{intent:"spending_total|category_total|budget_remaining|transaction_count|comparison|unknown",category_id?:UUID,period?:{start_date,end_date},filters:{payment_mode?:enum,place?:string}}`; no computed numeric answer. Mobile engine executes query locally. This is intentionally a new mobile adapter contract, replacing `answerQuestion(question,ctx)` which currently receives local data and returns a markdown string.
6. `POST /ai/month-narrative`: `{report:{month,totalSpentPaise,totalAllocatedPaise,totalBudgetPaise,savedOrOverspentPaise,cashPaidOutPaise,categoryBreakdown:[{categoryId,allocatedPaise,spentPaise,remainingPaise,isOverBudget}],biggestChanges:[{categoryId,currentPaise,previousAvgPaise,deltaPercent}],duplicateSuspects:[{txnIds,reason}]},categories:[{id,name}]}` -> `type:"narrative"`, payload `{text:string,suggestions:string[]}` max 3. Server verifies each numeric token in text is present among report's approved formatted values; if not, returns deterministic template narrative. No raw transactions or user names sent.
7. `POST /ai/parse-receipt`: multipart `{file}` OR JSON `{attachment_id:UUID}` -> `type:"receipt"`, payload `{merchant:string|null,total_paise:int|null,date:date|null,items:[{description,amount_paise:int|null}]}`. Images are decoded and size/type checked; source attachment must belong to user. No extracted data persisted.

Anthropic integration: use official `anthropic` Python SDK `client.messages.parse(..., output_format=PydanticModel)` for JSON schema constrained output, then validate against original Pydantic constraints. This is Anthropic's current documented helper. User's requested default model names `claude-haiku-5-5` and `claude-sonnet-5-5` are currently valid aliases; keep configurable. Sources: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Models overview](https://platform.claude.com/docs/en/models/overview). PII minimization: no account numbers, no person names except the explicit people list needed for split matching, and never log prompt/image or provider response.

## 8. Attachments

`PUT /api/v1/attachments/{id}` raw body, auth, headers `Content-Type`, `Digest: sha-256=<base64>` (or documented `X-Checksum-SHA256` hex), and query/metadata fields `transaction_id`; response `{id,transaction_id,mime_type,size_bytes,checksum_sha256,upload_status:"uploaded"}`. Same ID+checksum returns success; same ID with different bytes returns 409. Limit 5 MiB and configurable per-user quota. Decode JPEG/WebP/PNG, reject malformed/polyglot/oversized dimensions, re-encode pixels without EXIF to strip GPS, calculate checksum over canonical stored bytes (specify this precisely in implementation). Store under configurable root via `AttachmentStorage` interface, path derived from UUID and never user-supplied. `GET /attachments/{id}` checks user ownership and returns bytes with safe content type and private/no-store cache. Never emit public URLs. Sync only metadata; upload bytes separately.

## 9. Local-first invariants, validation and unresolved risks

- Defer same-push references to validation after staged records; PostgreSQL FKs should remain immediate for committed state. Use savepoints per atomic group. Reject cross-user references as `missing_reference` without revealing whether another user's row exists.
- GroupBill mobile computes total from payments and shares through `engine/splits.ts`; equal/custom/percent/shares/itemized algorithm is in `engine/allocate.ts` and `splits.ts`. The requested “payers sum to total, shares sum to total” is inconsistent because the mobile schema has no explicit total/shares. Proposal: require payment values to sum to optional submitted `total_paise` only if a new client field is approved; otherwise total is their sum and validate derived shares sum to that total. For custom shares, mobile silently normalizes invalid totals via weighted allocation; server should validate invariants without changing a user-confirmed document. Itemized mobile logic targets payment total when >0, otherwise item sum + tax + tip; decide if server accepts that exact behavior or tightens it.
- Transaction has no mobile `kind` field; signed `amount` encodes expense/income/refund ambiguously, and `isTransfer` is an old mobile flag. New API additions require a client mapping change. Preserve both signed amount and new kind in API only if the client team agrees; otherwise breaking mismatch.
- Mobile stores bill photo as local URI, and sync must turn it into attachment UUID. The mobile repository/sync layer currently has no documented remote contract; add adapter explicitly during implementation.
- Mobile settlement is mutable (`paidAmountPaise`, `isPaid`, `paidAt`); “insert-only except void” conflicts. Need field merge semantics. Suggested payment progress is monotone (`max(paid_amount)`), `is_paid` consistent with amount, or require new settlement revision IDs.
- Mobile date/time are local; API UTC-only requirement loses local wall time around timezone changes. Proposed local date/time/timezone fields preserve calculations while audit timestamps remain UTC.
- Tombstone retention requires a unified change log/watermark. Deleting rows after 90 days without recording the lowest retained seq makes old-cursor detection unreliable. Keep sync log snapshots/tombstones for at least 90 days and report `cursor_too_old` if cursor < retained watermark.
- AI numeric validation in narrative must compare normalized monetary values and percentages, not substring matches (e.g. `10` must not validate `100`). Template fallback must be generated from report fields only.
- AI quota race safety requires atomic DB counter updates; cap limits, window timezone (UTC), and whether provider errors count toward daily cap must be fixed config defaults.
- Image verification/re-encoding needs a pinned decoder (e.g. Pillow) and decompression/dimension cap; checksum semantics must be the same on upload retry after EXIF stripping.
- PostgreSQL runtime dependency means “works out of box” requires Docker Compose to start both isolated dev and test databases. `.env.example` can leave only `ANTHROPIC_API_KEY` blank if local-only generated secrets are written by `scripts/init_env.py`; never commit generated `.env`.
- Stage 2 exclusions: no Google login, email verification/reset, refresh rotation, general request rate limits, security headers, production CORS lockdown, audit log, account deletion/export, or admin endpoints. Preserve extension hooks only.

## 10. Developer setup and later implementation sequence

Compose provides Postgres databases `paisa_dev` and `paisa_test`, bound to localhost, with persistent named volumes. `scripts/init_env.py` copies defaults without overwriting `.env`, creates random JWT/database passwords, and prints the exact local-only setup path. Commands: `setup` (initialize env + start DB + sync deps), `dev` (migrate then API reload), `migrate`, `test` (test DB), `seed`, `smoke` (all routes including Mock AI), `openapi`, and root `api:client` to generate `packages/api-client` from `/api/v1/openapi.json` with a pinned generator. No deployment files.

Seed user credentials must be documented local demo credentials; seeded demo has default categories, month budget, allocations, transactions, party bill, and settlement rows. Party fixture: total `850000` paise; payments A-E `[500000,70000,20000,10000,250000]`; each equal share `170000`; net balances `[330000,-100000,-150000,-160000,80000]`. The engine tests do not assert a unique simplified settlement sequence, only at most four transfers and net zero; seed should use engine-compatible transfers and golden test should assert conservation, not a particular ordering. Golden JSON fixtures should copy party and 100-rupee/3-person cases plus month boundary cases from mobile tests.

Planned API modules: `api/v1/auth.py` auth; `sync.py` atomic push/pull; `attachments.py` private receipt bytes; `ai.py` endpoints; `models/` ORM tables; `schemas/` request/draft contracts; `services/sync.py` conflicts/groups/cursor; `services/attachments.py` storage and image sanitation; `services/ai/{provider,mock,anthropic,limits}.py`; `core/config.py`, `dependencies.py`, `security.py`, `errors.py`; `ai/prompts/v1`; `tests/` per feature and cross-user matrix; `scripts/seed_demo.py`, `smoke.py`, `init_env.py`.

## 11. Resolved design choices and remaining risks

1. Transactions preserve the mobile signed integer amount, local `date`/`time`, and provenance at sync; the server stores positive integer paise plus `kind` and returns the signed mobile amount. This does not reinterpret the local calendar time as UTC.
2. Budget periods retain the mobile `month`, `totalPaise`, and `startDay`, and also persist derived start/end dates. Allocations reference the period UUID internally and use month at the mobile boundary.
3. `me` remains virtual and is never persisted as a Person row. Other person IDs are strings to preserve existing local IDs.
4. Group bill total is the sum of payer payments; optional total/shares are validated against it. The server preserves the split document and does not recalculate shares.
5. Settlement payment progress is monotone (`paid_amount_paise` never decreases); voiding is represented by `voided_at`.
6. Equal `updated_at` values with differing content are rejected as stale. Clients should use a strictly increasing timestamp for each record edit; a retry of identical content is unchanged.
7. Server summaries/report endpoints were removed. Clients compute those values locally; `/ai/ask` returns only a structured local query.
8. AI response envelopes are documented as `{type,payload,confidence,reason,provider}`. A mobile adapter maps that draft into its local AI interface.
9. Registration seeds the mobile defaults. Legacy IDs `cat-0` through `cat-8` map to each user's server-generated UUID category rows.

Remaining implementation risks: the production database is PostgreSQL and was unavailable in this environment (Docker is not installed), so the final migration was exercised against an isolated SQLite database, not PostgreSQL. The real Anthropic path is skipped without a key. The local smoke script requires a listening service; sandbox policy blocked loopback sockets during verification.

Implementation and local verification are complete. See the endpoint guide and API README for run instructions.
