# Expense Tracker — Project Overview

> Working title: **Expense Tracker**. A local-first personal finance app with an AI assistant, built as a mobile app, an API, and a web admin/download site.

---

## 1. Project Story

### The problem
Most people don't track their spending because it's tedious. Opening an app, picking a category, typing an amount, and choosing a date for a ₹30 chai feels like too much work, so the habit dies in a week. Existing apps are also often cloud-only (useless without internet), cluttered with features, or hungry for personal financial data.

### The vision
An expense tracker where **adding an expense takes five seconds**, **works with no internet**, and has an **AI assistant that removes the boring parts**: typing, categorizing, and making sense of the numbers.

### Who it's for
- **Primary user:** an individual (student, professional, freelancer) who wants a simple, fast way to see where their money goes.
- **Admin:** the person running the system, who manages users and distributes the app.

### Core principles
1. **Speed first.** The most common action (add an expense) must be the fastest thing in the app.
2. **Local-first.** The phone is the source of truth. The app is fully usable offline; the server adds sync, backup, and AI.
3. **AI assists, never decides alone.** AI suggests; the user confirms. AI never does the math, because totals and statistics are computed by code.
4. **Money is exact.** Amounts are stored as integers in the smallest unit (paise), never as decimals or floats.
5. **Privacy-minded.** Send the minimum data to any AI service. No account numbers, no personal identifiers.
6. **Small and finishable.** Build the useful core first and add extras later.

### The three parts, in one line each
- **Mobile app:** where the user lives day to day (log, view, budget).
- **API:** the backend that stores, syncs, secures, and powers AI features.
- **Web app:** the admin panel and download page (built last).

---

## 2. Main Workflows and Use Cases

### UC-1: Get the app and create an account
1. User opens the download page (web) and installs the Android app.
2. User registers with email and password, then logs in.
3. App creates a local database and loads default categories (Food, Transport, Bills, Shopping, Health, Entertainment, Other).
4. User lands on an empty home screen with a prompt to add a first expense.

### UC-2: Quick-add an expense (core workflow)
1. User taps **Add**.
2. Enters the amount, taps a category chip, optionally edits the note and date (defaults to today).
3. Saves. The expense is stored locally and appears instantly in the list.
4. If online, it syncs to the server in the background.

### UC-3: Add expenses by typing naturally (AI)
1. User types or dictates: *"chai 30, auto 120 yesterday, groceries 850"*.
2. App sends the text to the API, which returns draft transactions (amount, category, date, note).
3. User reviews the drafts, edits if needed, and confirms.
4. Confirmed items are saved like any other expense.

### UC-4: Scan a receipt (AI)
1. User photographs a receipt.
2. API extracts merchant, total, and date.
3. User reviews the pre-filled expense and confirms.

### UC-5: Use the app offline
1. User has no internet (travelling, poor signal).
2. Adds, edits, and deletes expenses normally. Everything works.
3. A small indicator shows "pending sync".
4. When connectivity returns, the app syncs automatically. AI features are unavailable offline and show a clear message.

### UC-6: Sync across devices
1. User logs in on a second device.
2. App pulls all their data from the server.
3. Later changes on either device sync both ways. If the same record was edited on both, the most recent edit wins.

### UC-7: Review spending
1. User opens the **Summary** screen.
2. Sees total spent this month, a breakdown by category, and a trend against previous months.
3. Taps a category to see the transactions behind it.
4. Filters by date range, category, or search text.

### UC-8: Set and track budgets
1. User sets a monthly budget (overall and/or per category).
2. Home screen shows progress ("₹8,200 of ₹10,000 used").
3. App warns when a category nears or exceeds its limit.

### UC-9: Get AI insights
1. User opens **Insights**.
2. The system computes the statistics (totals, changes vs. last month, biggest categories).
3. The AI turns them into a short plain-language explanation, e.g. *"Food spending is up 32% vs. last month, mostly on weekends."*
4. Unusual or duplicate transactions are flagged for review.

### UC-10: Fix categorization and teach the system
1. An expense is auto-categorized wrongly.
2. User changes the category.
3. The system remembers the correction for that merchant or keyword next time.

### UC-11: Import and export data
1. User imports a bank or UPI statement as CSV (web or mobile).
2. System maps columns, auto-categorizes, and shows a preview.
3. User confirms the import. Duplicates are detected and skipped.
4. User can export all data as CSV at any time.

### UC-12: Admin manages the system (web)
1. Admin logs in to the web panel.
2. Views the user list, disables or enables accounts, and triggers a password reset.
3. Views basic usage numbers (user count, activity).
4. Publishes a new app version on the download page.

---

## 3. What Each Part Contains

### 3.1 Mobile App (Android, React Native + Expo)

**Purpose:** the main product. Fast, offline-capable expense tracking.

**Screens**
- Login / Register
- Home: this month's total, budget progress, recent transactions, floating **Add** button
- Add / Edit expense
- Transactions list: search, filter by date and category, swipe to delete
- Summary: category breakdown and monthly trend charts
- Budgets: set and view budgets
- Insights: AI-written summary and flagged items
- AI Quick Entry: natural-language input and draft review
- Receipt scan: camera and review
- Categories: add, rename, and recolor categories
- Settings: account, currency, export data, sync status, log out

**Capabilities**
- Local SQLite database as the source of truth
- Background sync engine with pending-changes indicator
- Secure token storage
- Offline-first behaviour for all core features
- Camera access for receipts (permission requested only when used)

### 3.2 API (FastAPI)

**Purpose:** secure storage, sync, and AI services. The mobile app works without it, but it enables backup, multi-device use, and AI.

**Areas of responsibility**
- **Authentication:** register, login, token refresh, logout, password change and reset
- **Users:** profile, roles (user / admin), account enable/disable
- **Categories:** create, read, update, delete (default + custom)
- **Transactions:** create, read, update, soft-delete, with filtering and pagination
- **Budgets:** monthly overall and per-category budgets
- **Summaries:** deterministic totals and breakdowns (by month, category, date range)
- **Sync:** push local changes, pull changes since a cursor, last-write-wins conflict handling
- **Import / Export:** CSV import with preview and duplicate detection, CSV export
- **AI services:**
  - Parse natural-language text into draft transactions
  - Suggest a category for a transaction (rules first, AI as fallback)
  - Extract data from a receipt image
  - Generate monthly insights from computed statistics
  - Flag anomalies and duplicates
- **Admin:** user list and management, usage statistics, app-version info for the download page

**Cross-cutting rules**
- Every query is scoped to the authenticated user
- Amounts are integers in paise
- Consistent error format and input validation
- Rate limiting on auth and AI endpoints
- AI can be switched off by configuration

### 3.3 Web App (React + Vite) — built last

**Purpose:** a download page for the app and an admin panel, plus an optional dashboard for users.

**Public**
- Landing and download page: app description, APK download, version and changelog

**User (optional)**
- Login
- Dashboard: monthly charts and category breakdown
- Transactions table with filters
- CSV import and export

**Admin**
- User management: list, search, enable/disable, reset password
- Usage overview: user counts and activity
- Release management: update the published app version and notes

---

## 4. AI Feature Summary

| Feature | Where it appears | Type |
|---|---|---|
| Natural-language entry | Mobile quick-add | LLM, user confirms |
| Auto-categorization | On every new expense | Rules first, LLM fallback, learns from corrections |
| Receipt scan | Mobile camera | Vision model, user confirms |
| Monthly insights | Insights screen | Code computes numbers, LLM explains |
| Anomaly / duplicate flags | Insights and import | Mostly statistical |
| Budget forecast | Home / Budgets | Simple projection, no LLM |
| Chat with your data | Later phase | LLM calling predefined, safe queries |

**AI guardrails:** the user always confirms AI-created data, the LLM never calculates totals, sensitive identifiers are never sent, and every AI feature degrades gracefully when offline or disabled.

---

## 5. Scope

### MVP (must have)
- Register / login
- Quick-add, edit, and delete expenses
- Categories
- Transactions list with filters
- Monthly summary
- Offline use with sync
- Natural-language entry
- Auto-categorization

### Phase 2
- Budgets and alerts
- Insights and anomaly flags
- CSV import and export
- Receipt scanning
- Web admin panel and download page

### Later / Maybe
- Recurring expenses (rent, subscriptions)
- Multiple accounts or wallets
- Shared expenses between people
- Chat with your data
- Local (on-device or self-hosted) AI model option
- iOS version

### Out of scope (for now)
- Automatic SMS or UPI reading
- Direct bank account linking
- Investment or tax tracking
- Multi-currency conversion

---

## 6. Success Criteria

- Adding an expense takes under 5 seconds.
- All core features work with airplane mode on.
- Data created offline syncs correctly with no loss or duplication.
- Totals are always exact.
- AI suggestions are right often enough that users mostly just tap confirm.