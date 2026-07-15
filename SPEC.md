# Renewal Screening Workbench — MVP Prototype Spec

Status: **Draft v1 — for review with Shane before handoff to VS Code**
Author: Shane O'Donoghue (Plain Concepts), drafted with Claude
Date: 2026-07-13

> **Prerequisite — do not start the build until this is satisfied:** real screening files for all four countries (DK, NO, SE, FI) must be present in `REAL_DATA_DIR` (§10) before running the anonymization script. As of this draft, only the Denmark file has been provided. This was a deliberate decision (2026-07-13) over the alternatives of building DK-only or synthesizing the missing countries — confirmed with Shane specifically to avoid fabricating country data with no real basis. If you're an agent picking this up and NO/SE/FI aren't there yet, stop and ask, don't improvise.

---

## 1. Purpose

Replace the current manual "workbench" — three unlocked columns (`Assigned Underwriter`, `Status`, `Comments`) in an otherwise-protected Excel file — with a real, multi-user web application for reviewing and actioning Financial Lines policy renewals.

This is **not** a rebuild of the scoring engine. The existing `catalyst-renewal-screening` backend already computes flags, routing, and attention for each policy — the workbench does not re-implement that business logic. Its job is the human workflow layer on top: visibility, review, decisioning, ownership, comments, and audit trail.

To be explicit, since this is easy to misread: **the app itself does not run on Excel.** The only place Excel appears anywhere in this spec is as the one-time source format for building the MVP's seed data (§8) — a screening file gets read once (or re-read, if new country files arrive) to populate the app's own database. At runtime, the workbench reads and writes its own schema (§7), stored in Turso; nothing in the running app parses or generates `.xlsx` files. Whether a *future*, post-MVP version integrates with the live backend by parsing its rendered Excel output or by the backend exposing a JSON API instead is an open architectural question — not one this MVP needs to answer, since it runs on static seed data either way. See §8 for how seed data is produced and §12 for this noted as an open item.

**A note on `catalyst-renewal-screening`, for whoever/whatever builds this:** that name refers to a separate, existing Go repository — the real production backend this workbench is a UX layer for. This spec was written after reviewing that repo directly, and everything from it relevant to this build (domain rules in §3, data shapes in §7) has already been captured in this document. **Building this MVP does not require access to that repo** — treat it as provenance/history, not a dependency. If you *do* want to be able to cross-reference it directly while building (e.g. to sanity-check an edge case this spec doesn't cover), open both folders in the same VS Code workspace before starting; otherwise no setup is needed.

### Goals for this MVP
- Prove the review/decision workflow end-to-end with real (anonymized) data shape, for underwriters and stakeholders to react to.
- Replace the shared-Excel-file editing model with structured status, ownership, and comment history.
- Structure the app so a later swap from mock/seed data to the real `catalyst-renewal-screening` API is a data-layer change, not a rewrite.

### Explicit non-goals for this MVP
- Re-implementing the scoring/rules engine (Stage 1/2 flags, routing, attention are pre-computed and ingested as-is).
- Real authentication, real D&B/Trino calls, the real Temporal pipeline, or SharePoint/Blob output.
- Multi-user real-time sync (no websockets/live collaboration — last-write-wins is fine for MVP).
- A senior underwriter/lead role tier (flagged as a possible future need, not built now).
- Simulating the monthly "add a new month" append mechanic (static seed dataset instead).

---

## 2. Background (why this exists)

Today, Financial Lines underwriters manually screen ~230 renewal policies per country per month, three months forward. A backend batch pipeline (`catalyst-renewal-screening`) already automates the data assembly and scoring: it pulls policy data, checks Dun & Bradstreet financial health via an internal wrapper API, applies deterministic rules, and produces a scored Excel workbook per country per run.

The remaining manual step is the human review layer: underwriters open the Excel file, read the flags, and type into three unlocked columns to record who's working a policy, what state it's in, and any notes. This is fragile — no history, no concurrency safety, no structured status, no per-user "my work" view, and no separation between policies that need a judgment call and policies that just need someone to click a button in Navins.

---

## 3. Core domain concepts

These map directly onto the real backend's logic and the real screening file structure (`20260709_DK_RenewalsScreening_004.xlsx`, 129 rows, verified 2026-07-13) — the workbench must not contradict this model.

### 3.1 Routing (pre-computed, read-only)

| Routing value | Meaning | Derivation |
|---|---|---|
| `RPUX Auto Renew` | Clean policy, RPUX will auto-renew it | Zero Stage 1 + Stage 2 flags, policy number starts with `RPX` (case-insensitive) |
| `NAVINS Renew` | Clean policy, but Navins has no auto-renew toggle — someone must manually action it | Zero Stage 1 + Stage 2 flags, policy number does **not** start with `RPX` |
| `Manual Review` | Needs underwriting judgment | One or more Stage 1/Stage 2 flags fired, regardless of policy number prefix |

### 3.2 Attention (pre-computed, read-only)

| Attention | Meaning | Derivation |
|---|---|---|
| `High` | Needs priority attention | `Open Claim` or `Premium Unpaid` fired |
| `Medium` | Needs review, not urgent | Any other flag fired (Renewal Type Manual, Listed Company, any Stage 2 D&B flag, Data Incomplete) |
| `—` (none) | Nothing to review | No flags fired |

Attention-only flags (`D&B Predictor Concern` i.e. low Failure Score, `D&B Significant Event`, `D&B Listed Status Unknown`, `Data Incomplete`) never get their own Y/N column and never move Attention above `Medium` on their own — they only ever appear as `Attention: <label>` inside the Flag Reasons text. **This is intentional design in the real system, not a defect** — do not "fix" this by adding columns for them.

### 3.3 Stage 1 / Stage 2 flags (pre-computed, read-only)

Stage 1 (BI-sourced): Open Claim, Premium Unpaid, Renewal Type Manual, System Listed Company.
Stage 2 (D&B-sourced): D&B No Match, D&B Status Inactive, D&B Rating Below A, Latest Profit Negative, Assets Moved >25% YoY, D&B Listed Company.
`Is Frame` is a column but **not a flag** — informational only, never fires, never affects routing/attention. Display it, don't treat it as a rule.

### 3.4 Flag Reasons (pre-computed, read-only)

A single comma-separated string in fixed rule order, e.g. `"Open Claim, Premium Unpaid, D&B Rating Classification below A"`. Attention-only rules are prefixed `"Attention: "`. Display verbatim; don't try to re-parse or re-derive it beyond splitting on commas for display chips if useful.

### 3.5 Country boundary (access control, not a filter)

Every policy, user, and review record belongs to exactly one country. A user scoped to Sweden must never see Denmark's data — this is an access boundary enforced server-side on every request, not a UI dropdown a user can override or a filter the client applies to data it already received. See §4 for how this is enforced without building real authentication.

### 3.6 Cohort model

Append-only, one instance per active renewal. New months' renewals get added; existing policies already under review are never duplicated or reset by a later add. The MVP uses a static seed dataset per country (no simulated monthly append).

---

## 4. Users, roles, and permissions

- **Single flat role: Underwriter.** No senior/lead tier in MVP.
- Country-scoped: a logged-in user belongs to one country and only ever sees that country's policies, queues, and other users.
- No real authentication (no passwords, no identity provider) — but the "log in as" picker is not purely cosmetic either. Picking an identity sets a signed, httpOnly session cookie recording the chosen user ID and country. Every API route reads that cookie server-side and filters/validates against it — a request for another country's data is rejected by the server regardless of what the UI shows or what the client asks for. This is the fix for the gap flagged in the SA review: the country boundary is genuinely enforced by the backend, not just hidden by the frontend, without needing a real auth system.
- **The identity picker is a persistent "Acting as: [Name] ([Country]) ▾" control**, always visible (e.g. in the app header), not a one-time landing-page choice — switchable at any point in the session. This matters for actually testing the multi-user acceptance criteria (§11) solo: open two incognito/private windows, pick a different mocked identity in each, and confirm both see the same shared state.
- Any underwriter in a country can self-assign any unassigned item in that country, reassign items to a teammate, and act on anything already assigned to them. (Reassigning someone else's actively-assigned item — allow it for MVP simplicity; don't gate this.)

---

## 5. Screens & functional requirements

### 5.1 My Queue — descoped (removed 2026-07-15)

A separate "My Queue" screen was originally specified and built as the app's default landing page: everything assigned to the logged-in user, across Manual Review and Navins Renew, sorted by renewal date, with a Navins Renew row opening an inline mark-done action rather than a separate detail page. It has been **removed**. Team View (§5.3) is now the landing page, and its "Assigned to" filter defaults to the acting-as user on load — the same personal view, without a second screen showing largely the same underlying data. The Navins Renew inline mark-done behavior is preserved as-is in Team View's Navins Renew tab, which already worked that way.

### 5.2 Month navigation (shared across 5.3–5.5)

Team View, Navins Renew Queue, and the Auto-Renew Log all share a persistent month-tab bar above their tables, rather than each screen inventing its own filtering. Tabs are derived from whatever renewal-date months are actually present in the country's data (naturally 2-3 at a time, matching the rolling window), each labelled with a count (e.g. "October (18)"), plus an **All** tab for the full spread. Default tab on entry: the soonest month that still has outstanding (non-Closed / non-Done) work — not "All" — so underwriters land on what's most urgent rather than an unsorted pile. The selected month is reflected in the URL (e.g. `/review/manual?month=2026-10`) so a specific month's queue is bookmarkable/shareable.

**Renewal Month derivation (business rule, confirmed 2026-07-15):** Renewal Month is not simply the calendar month of `renewalDate` — it's `month(renewalDate) + 1`, with year rollover (a December `renewalDate` produces a Renewal Month of January in the following year). Example: `renewalDate` of 2027-03-29 → Renewal Month of April 2027. This derived value is what drives the month-tab bucketing/labelling here — not the raw month of `renewalDate`. Apply this consistently across every screen that shows or filters by month.

### 5.3 Team View (default landing page, since 2026-07-15)

Team View is now the app's landing page (`/`) — there is no separate personal queue (§5.1). On load, its **"Assigned to" filter defaults to the acting-as user**, not "All" — this is what replaces My Queue's former role as the personal view. This default is a plain filter value, nothing more: it stays scoped to the currently-selected month like every other view here (no bypassing the month-tab bar, §5.2), and Manual Review / Navins Renew remain two separate tabs (no combined cross-routing list). Switching "Assigned to" to "All" or to a specific teammate works exactly like changing any other filter.

Page hierarchy, top to bottom: month-tab bar (§5.2) → filters → **Manual Review** / **Navins Renew** tab buttons → table. Two tabs (or two sections on one page), each a filterable/sortable table scoped to the user's country and the currently-selected month. Which filters are shown still depends on which tab is active underneath (attention and flag-type only apply to Manual Review) — this is a visual reordering of where the filters sit relative to the tab buttons, not a change to which filters are relevant when.

Filters: attention (High/Medium/None, Manual Review only), status, assigned-to (including "Unassigned"), flag type (multi-select against the flags present in Flag Reasons, Manual Review only). Sort: renewal date, attention, status.

Row actions: self-assign (if unassigned), reassign (dropdown of country's users), open detail (Manual Review) or mark done (Navins Renew).

### 5.4 Manual Review Detail

Full policy record, organized to mirror the source file's section bands:
- **Identity & Context** — policy number, customer name, customer identifier (CVR/org number), broker name, end date, currency, premium.
- **Stage 1 flags** — each of the 4, shown as Y/N with a short label, plus `Is Frame` shown separately/informationally.
- **Stage 2 flags** — each of the 6, shown as Y/N with a short label, plus its synthesized supporting figure alongside (§7.1) — e.g. "D&B Rating Below A: Y (B3)", "Latest Profit Negative: Y (–140,000 DKK)".
- **Derived** — Stage 1 Flags count, Stage 2 Flags count, Routing, Attention, full Flag Reasons text.
- **Underwriter Workspace** (this is the new part the workbench owns):
  - Status control — dropdown/stepper through the workflow (§6).
  - Assigned-to control — dropdown of the country's users, or "Unassigned."
  - Comment thread — chronological list of comments (author, timestamp, text), with an add-comment box. No editing/deleting past comments (append-only, matches the audit intent).
  - Activity log — a read-only chronological feed of status changes, assignment changes, and comments, each timestamped and attributed. This is the workbench's answer to the real backend's `run_events` audit table, extended to cover things the backend doesn't currently audit (attention-only flag visibility, human decisions).

### 5.5 Navins Renew Queue — descoped (removed 2026-07-15)

A standalone Navins Renew Queue screen was originally specified and built here: a checklist table (policy number, customer name, renewal date, assigned-to, status) with multi-select bulk actions (bulk-assign, bulk-mark-done). It has since been **removed** — redundant once My Queue surfaced a user's assigned Navins Renew items directly (with an inline mark-done action, §5.1) and Team View's Navins Renew tab covered the country-wide view (self-assign, reassign, mark done per row, §5.3). A third screen showing the same underlying data added navigation without adding capability.

**Trade-off accepted, not silently dropped:** the standalone screen's *multi-select bulk actions* (acting on several Navins Renew policies in one operation) go away with it. Navins Renew items are now actioned one row at a time, via My Queue or Team View. If bulk-assign/bulk-mark-done turn out to matter in practice at real volume, the right place to reintroduce them is Team View's existing Navins Renew tab (adding multi-select there), not a fourth screen.

### 5.6 Auto-Renew (RPUX) Log

Also sits below the month-tab bar (§5.2). Read-only, filterable, no actions. Table: policy number, customer name, renewal date, premium. Each row expandable to show which data sources were checked and confirmed clean (Stage 1 flags all N, Stage 2 flags all N), including the synthesized clean-state figures from §7.1 (e.g. "D&B Rating: AA2", "Latest Profit: +140,000 DKK") — preserving the "never silently pass" principle from the original design intent, even though there's nothing to do about it.

---

## 6. Status workflows

**Manual Review** (corrected 2026-07-15 — Escalated used to be a dead end, see below):

```
New → In Review → Renewed     → Closed
              → Not Renewed → Closed
              → Escalated   → Renewed     → Closed
                            → Not Renewed → Closed
                            → Closed
```

- `New`: default state when a policy enters Manual Review, unassigned.
- `In Review`: **assignment and status are fully independent controls — assigning someone does not automatically change status.** A user moves a policy to `In Review` explicitly via the status control, separately from assigning it. This is a deliberate simplification: no hidden side effects where changing one field silently changes another.
- `Renewed` / `Not Renewed`: decision outcomes, not terminal — each still requires its own separate move to `Closed` to finish the item, same whether reached directly from `In Review` or via `Escalated`.
- `Escalated`: underwriter needs more input/second opinion before deciding (no separate role to escalate *to* in MVP — it just stays visible in Team View with this status). **Not a dead end**: it resolves to `Renewed` or `Not Renewed` once the second opinion lands on a decision (each still requiring its own `Closed` step after), or goes straight to `Closed` for cases that genuinely don't resolve to a clean decision. The earlier version only allowed `Escalated → Closed`, which lost the actual outcome of an escalation — fixed.
- `Closed`: the only truly immutable end state, reachable from `Renewed`, `Not Renewed`, or `Escalated` directly. No outgoing transitions from here.

**Navins Renew:**

```
Pending → Done
```

That's it — no judgment states needed.

---

## 7. Data model

### 7.1 `Policy` (read-only, sourced from seed data — mirrors the real `ScoredRow`)

| Field | Type | Source column (real file) |
|---|---|---|
| `id` | string (PK) | Policy No. |
| `country` | enum (DK/NO/SE/FI) | filename / sheet origin |
| `customerName` | string | Customer Name |
| `customerIdentifier` | string | Customer Identifier |
| `brokerName` | string | Broker Name |
| `renewalDate` | date | End Date (Renewal Due) — found unpopulated (null on every row) in the seed generation as built 2026-07-15; must be fixed at the seed script, not just the UI layer. See §5.2 for the separate "Renewal Month" derivation rule (month(renewalDate) + 1) used for display/tab-grouping. |
| `currency` | string | Currency |
| `premium` | number | Premium (incl. tax) |
| `openClaim` | boolean | Open Claim |
| `premiumUnpaid` | boolean | Premium Unpaid |
| `renewalTypeManual` | boolean | Renewal Type Manual |
| `systemListedCompany` | boolean | System Listed Company |
| `isFrame` | boolean (informational only) | Is Frame |
| `dnbNoMatch` | boolean | D&B No Match |
| `dnbStatusInactive` | boolean | D&B Status Inactive |
| `dnbRatingBelowA` | boolean | D&B Rating Below A |
| `latestProfitNegative` | boolean | Latest Profit Negative |
| `assetsMovedSignificant` | boolean | Assets Moved >25% YoY |
| `dnbListedCompany` | boolean | D&B Listed Company |
| `stage1FlagCount` | number | Stage 1 Flags |
| `stage2FlagCount` | number | Stage 2 Flags |
| `routing` | enum (RPUX Auto Renew / NAVINS Renew / Manual Review) | Routing |
| `attention` | enum (High / Medium / None) | Attention |
| `flagReasons` | string | Flag Reasons |

**Synthesized evidence fields (not in the source export — see §8):** the real screening export only has the Y/N flags above; it doesn't carry the underlying D&B figures that produced them. Per the SA review decision, the anonymization/seed-generation step fabricates plausible supporting values, consistent with each flag's fired/not-fired state, so Manual Review Detail and the Auto-Renew Log have something concrete to show:

| Field | Type | Consistency rule when synthesizing |
|---|---|---|
| `dnbRating` | string (e.g. "AA2", "B3", "NORAT1") | Must be in the below-A set when `dnbRatingBelowA` is true, at-or-above-A otherwise |
| `failureScorePercentile` | number (1-100) | < 30 when the "D&B Predictor Concern" attention flag is present in Flag Reasons, ≥ 30 otherwise |
| `latestNetIncome` | number | Negative when `latestProfitNegative` is true, positive otherwise |
| `assetsChangePercent` | number | \|value\| > 25 when `assetsMovedSignificant` is true, within ±25 otherwise |
| `dnbOperatingStatusLabel` | string ("Active" / "Inactive") | Matches `dnbStatusInactive` |
| `dnbListedExchange` | string, nullable | Populated (fake ticker) when `dnbListedCompany` is true, null otherwise |

These are clearly synthesized, not real D&B data even in anonymized form. Rather than tagging individual fields in the UI (unnecessary clutter for a handful of numbers), a single app-wide "this is a demo application" banner (§9) covers this along with everything else in the app that's illustrative.

### 7.2 `ReviewState` (mutable, workbench-owned — one per Policy)

`policyId` (FK), `status` (enum per §6, scoped to routing — Auto-Renew policies have no ReviewState at all), `assignedUserId` (FK, nullable).

**Created at seed time, not lazily.** Every Manual Review policy gets a `ReviewState` row at `New`/unassigned when the seed data loads; every Navins Renew policy gets one at `Pending`/unassigned. The app should never need to handle "policy with no `ReviewState` row yet" as a special case — if you find yourself writing that check, the seed script is missing something.

### 7.3 `Comment`

`id`, `policyId` (FK), `userId` (FK), `text`, `createdAt`.

### 7.4 `ActivityLogEntry`

`id`, `policyId` (FK), `eventType` (status_change / assignment_change / comment_added), `userId` (FK), `detail` (JSON — e.g. `{from: "New", to: "In Review"}`), `createdAt`.

**Bulk actions (Navins Renew) write one `ActivityLogEntry` per affected policy**, not one entry for the whole batch — same `createdAt` timestamp across the batch, but each policy's own history stays complete and consistent whether it was actioned individually or as part of a bulk operation. No separate "batch" table/entity for MVP.

### 7.5 `User`

`id`, `name`, `country`.

**Seed roster:** 3 mocked underwriters per country (12 total across DK/NO/SE/FI), plausibly named, created by the seed script alongside the policy data. Exact names aren't load-bearing — pick anything sensible per country.

---

## 8. Mock/seed data & anonymization

Excel's role in this project is strictly as a **one-time ETL source**, not a runtime dependency of the app (see the clarification in §1). A screening file is read once — by a script, outside the running app — to populate the app's own database (§7). The app never opens, parses, or writes `.xlsx` files while running.

**The source files are real RiskPoint policy data**, not synthetic mock data (confirmed 2026-07-13) — real company names, CVR/org numbers, premiums, broker relationships. This has a direct consequence for how the repo is structured:

- Real files (e.g. `20260709_DK_RenewalsScreening_004.xlsx` and the NO/SE/FI equivalents when provided) are kept **entirely outside the project directory tree** (e.g. referenced via an absolute path in a local `.env` var like `REAL_DATA_DIR=/Users/shane/riskpoint-real-data`), not just gitignored inside it. Belt-and-suspenders: a `.gitignore` typo or a careless `git add -A` shouldn't be the only thing standing between real client data and a public commit.
- A one-time (re-runnable) **anonymization script** (`scripts/anonymize-seed-data.ts`, using the `xlsx` (SheetJS) package to read the source workbooks — same ecosystem as the rest of the app, no need for a separate Python toolchain) reads the real files and produces an anonymized dataset with the same shape and statistical distribution:
  - Fake company names (generated, not real-sounding-by-coincidence) and scrambled customer identifiers.
  - **Broker Name is also anonymized/pseudonymized** — Nordic specialty insurance brokers are a small, recognizable set, so leaving real broker names in place while faking customer names would still make specific policies traceable to anyone at RiskPoint who knows which broker handles which accounts.
  - Policy numbers re-numbered but prefix pattern (`RPX...` vs not) preserved so routing logic demos correctly.
  - Premiums lightly jittered (not just preserved as-is) — an unjittered, highly distinctive premium value combined with routing/flag outcome could still point back to a real, identifiable policy even with the name changed.
  - All flags/routing/attention/flag-reasons preserved exactly (since they drive the review workflow being demoed).
  - The synthesized evidence fields from §7.1 are generated at this step too, following the consistency rules in that table.
  - **Renewal dates are synthetically spread across a 2-3 month window (decision confirmed 2026-07-15).** All four real source files, as of this build, have `renewalDate` exclusively in a single month (October 2026), which is not representative of the real rolling 2-3-month window and would make the month-tab bar show only one populated tab. The anonymization script fabricates a plausible multi-month spread on top of the real dates for demo purposes, deterministically. Disclosed via the demo banner (§9), not per-field tagging.
- The anonymized output (`/data/seed/`) **is** committed to the repo and is what the deployed Vercel build uses. This is the only dataset that should ever reach the public link.
- If more real country files arrive later, re-run the anonymization script — don't hand-edit the seed data.
- A lightweight **validation check** should run as part of (or immediately after) the anonymization script: confirm flag/routing/attention distributions match the real data exactly, and grep the output for any real company/broker names that might have leaked through a bug — a manual eyeball isn't a reliable enough check given what's at stake here. **This now exists as `scripts/validate-seed-data.ts` (`npm run validate-seed`), added 2026-07-15** — it re-parses the real source XLSX files directly, compares row counts / routing distribution / attention distribution against the current `data/seed/*.json` per country, and cross-references customer names, broker names, customer identifiers, and policy numbers from the real files against the anonymized `all.json` for leaks. Exits non-zero on any mismatch or leak. **Run this after every re-anonymization** (new country files, script changes, re-generation) — don't rely on a one-time manual check like the earlier ad hoc pass that motivated writing this script.

## 9. Technical architecture

- **Framework:** Next.js (React + TypeScript), single app.
- **API layer:** Next.js API routes, named/shaped sensibly around the data model in §7 (`/api/policies`, `/api/policies/[id]/comments`, `/api/policies/[id]/status`, `/api/navins-queue/bulk-action`, etc.). **Do not design speculative abstraction for a hypothetical future backend integration** — there's no known real API contract to mirror (see the open item in §12), so building an adapter/plugin layer for it now would be guessing at a shape that doesn't exist. Plain REST routes over this spec's own data model are enough; the "data-layer change, not a rewrite" goal in §1 is served by keeping the frontend's data-fetching isolated (e.g. one hooks/query layer), not by pre-building an integration nobody has specified yet.
- **Persistence:** Turso (libSQL/SQLite-compatible, serverless-friendly) rather than a local SQLite file. This is a firm decision, not a hedge: the MVP is explicitly meant to demo shared, multi-user state (one underwriter's assignment/comment/status change visible to another, across sessions and browsers) — a plain file-based SQLite DB won't reliably persist writes on Vercel's serverless functions (ephemeral filesystem), and client-only state (localStorage) can't be shared across browsers at all. Turso gives the same SQL/schema simplicity locally and once deployed.
- **Data access:** Drizzle ORM (not Prisma) — lighter weight, good TypeScript inference, and a natural fit for libSQL/Turso. Schema defined in `drizzle` schema files, migrations generated via `drizzle-kit`.
- **Session:** a signed httpOnly cookie set by the identity picker (§4), carrying user ID and country, checked server-side on every API route. No passwords, no identity provider — just enough to make the country boundary and "who did what" actually real rather than UI-only.
- **Styling:** Tailwind CSS + shadcn/ui components (tables, dialogs, badges, tabs, dropdowns).
- **Branding:** no existing RiskPoint brand kit was found in the project files. Use a placeholder professional palette (navy/insurance-blue primary, neutral greys, clean sans-serif) with a text wordmark ("RiskPoint") rather than a logo file — easy to swap once real brand assets are available.
- **Demo disclosure:** one persistent, unobtrusive "this is a demo application — data and figures are illustrative" banner (e.g. a slim strip in the app header/footer), rather than tagging individual synthesized fields throughout the UI. Covers the synthesized D&B evidence figures (§7.1) and the anonymized identities in one place, without cluttering the review screens.
- **Deployment:** Vercel, using only the anonymized seed dataset (§8). Local dev can point at either the seed or real data via an env var (`DATA_SOURCE=seed|real`), with `real` only ever used locally.

---

## 10. Environment, tooling & setup

Covers the details a developer needs to actually start building, rather than guess.

**Runtime:** Node.js 20.x (pinned, not just "LTS" — that drifts), npm as the package manager (no strong reason to prefer pnpm/yarn here — pick npm for the fewest moving parts). Scaffold with `create-next-app` (TypeScript, App Router, Tailwind).

**Turso: local dev needs no account at all.** libSQL (what Turso is built on) can point at a plain local file — `TURSO_DATABASE_URL=file:./local.db` — with zero signup, zero token, works immediately after `npm install`. A **real Turso cloud database and auth token is only needed for the Vercel deployment**, and that's a step for Shane to do himself (create a free Turso account, provision a database, put the URL/token into Vercel's environment settings) — not something an agent can provision on his behalf. Don't treat "no Turso credentials available" as a blocker for local development; it isn't one.

**Environment variables** (`.env.local` for dev, configured in Vercel for deployment):
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — `file:./local.db` and unset/empty locally; real cloud values only in Vercel's environment settings (set by Shane, not committed anywhere).
- `REAL_DATA_DIR` — absolute path to real screening files, **outside the repo**, used only by the anonymization script, only ever set locally, never in Vercel.
- `DATA_SOURCE` — `seed` (default, committed anonymized data) or `real` (local-only, reads from `REAL_DATA_DIR`).

**Suggested folder structure** (adjust as needed, this isn't gospel — just removes "where does this go" churn):
```
/app                    — Next.js App Router pages (my-queue, team, navins-renew, auto-renew log, policy/[id])
/app/api                — API routes
/components             — shared UI (tables, badges, status control, comment thread, month-tab bar)
/lib/db                 — Drizzle schema + client
/lib/session            — identity cookie helpers, country-boundary enforcement
/data/seed               — committed anonymized dataset (JSON or SQL seed)
/scripts                — anonymize-seed-data.ts, seed-db.ts
/drizzle                — generated migrations
```

**Testing:** no automated test suite is expected for this MVP — the priority is speed to a working demo, not test coverage (unlike the real `catalyst-renewal-screening` backend, which has strong test discipline for good reason: it's production infrastructure, this is a prototype). If time allows, a single smoke test confirming the seed data loads and the four core screens render is worthwhile; don't invest beyond that.

**Small consistency decisions**, so the build doesn't drift between screens:
- Store all timestamps in UTC; display in the browser's local time. Renewal dates are date-only (no time component), so timezone shifting isn't a concern there.
- No optimistic UI updates — actions (status change, assignment, comment, bulk action) wait for the server response before updating the screen. Simpler, avoids race conditions, and the data volumes here don't make the wait noticeable.

**Suggested build order** (commit at each milestone rather than one large initial commit — makes the build reviewable as it goes):

1. Scaffold the Next.js app; confirm `npm run dev` runs with nothing else configured.
2. Define the Drizzle schema for `Policy`/`ReviewState`/`Comment`/`ActivityLogEntry`/`User` (§7); generate and run the initial migration against the local file DB.
3. Confirm all four countries' real files are present in `REAL_DATA_DIR` (see prerequisite at the top of this document) — stop and ask if not.
4. Write the anonymization script (§8); produce `/data/seed` and run its validation check (flag/routing/attention distributions match, no real names/brokers leaked).
5. Write and run the seed-loading script — commit `/data/seed`.
6. Build the identity/session layer (§4): the "Acting as" picker, the signed cookie, server-side country-boundary enforcement on every route.
7. Build the API routes (§9) over the seeded data.
8. Build the screens in this order: My Queue → Team View + month-tab bar → Manual Review Detail → Auto-Renew Log. *(A standalone Navins Renew Queue screen, incl. bulk actions, was originally built at this point too — removed 2026-07-15 as redundant once My Queue and Team View's Navins Renew tab both covered the same ground; see §5.5.)*
9. Add the demo-application banner and the placeholder branding pass.
10. **Self-verify against every item in §11 before calling this done** — walk the checklist directly (including the two-browser-session test), don't treat "the code compiles" as equivalent to "the acceptance criteria pass."
11. Deploy to Vercel against the seed dataset; confirm no `REAL_DATA_DIR`/real-data env vars are set in Vercel's environment.

**Human-in-the-loop checkpoints — read this before starting, not just when you hit these steps.** Two of the steps above (3 and 11) depend on Shane doing something only he can do — an account login, or providing files only he has. Don't stall silently waiting for these, and don't try to work around them. Stop, explain plainly what's needed and why, and wait for confirmation before continuing.

- **At step 3 (data files):** check `REAL_DATA_DIR` for all four country files (DK, NO, SE, FI). If any are missing, tell Shane exactly which ones, remind him of the exact path from `.env.local`, and stop there — don't proceed with partial data, and don't synthesize the missing countries (see the prerequisite note at the top of this document; that was a deliberate decision, not an oversight to route around).
- **At step 11 (deployment):** this is the point where Shane needs to do things no agent can do for him — prove his own identity to Vercel and Turso. Walk him through it one step at a time, in plain language, confirming each is done before moving to the next, rather than dumping the whole list at once and assuming it happened:
  1. "Do you have a Vercel account? If not, go to vercel.com and sign up — GitHub login is easiest, and it'll let Vercel deploy straight from your repo." Wait for confirmation.
  2. "Do you have a Turso account? If not, run `turso auth login` in your terminal — it'll open a browser for you to log in. Let me know once you're logged in." Wait for confirmation.
  3. "Now run `turso db create renewal-screening-workbench` (or similar) to create a database." Wait for confirmation.
  4. "Run `turso db show <name> --url` and `turso db tokens create <name>` — you'll get a URL and a token. Don't paste those into our chat; go straight to Vercel's project settings → Environment Variables and add them there as `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`." This is the one point worth being explicit about: the secret shouldn't land in the conversation with the agent at all, only in Vercel's own settings screen.
  5. "Push the repo to GitHub, then import it in Vercel's dashboard (or run `vercel` locally and log in when prompted)." Confirm the deploy succeeds before considering this milestone done.

## 11. Acceptance criteria (Definition of Done for MVP)

- [ ] A user can pick a mocked identity (name + country) and see only that country's data thereafter.
- [ ] Team View (the landing page, §5.3) defaults its "Assigned to" filter to the acting-as user on load, showing their own Manual Review + Navins Renew items — across both tabs, still scoped to the current month — without any extra filter clicks; switching "Assigned to" to "All" or a specific teammate still works normally. **(Reworded 2026-07-15 — replaces the removed My Queue screen, §5.1.)**
- [ ] Team View shows the full country list for both queues, with working filters (attention, status, assigned-to, flag type) and sort.
- [ ] Team View and Auto-Renew Log all share the month-tab bar (§5.2), with accurate counts per tab, an "All" option, a sensible default (soonest month with outstanding work), and the selected month reflected in the URL.
- [ ] A user can self-assign an unassigned item and reassign an assigned one.
- [ ] Manual Review Detail shows the full flag/evidence breakdown (Stage 1, Stage 2, Is Frame informational, derived fields) matching the source data exactly.
- [ ] A user can move a Manual Review item through the full status workflow (§6) and see the change reflected immediately in Team View (both under its default self-filtered view and after switching "Assigned to" to "All"). **(Reworded 2026-07-15 — was "My Queue / Team View" before My Queue was removed, §5.1.)**
- [ ] A user can add multiple comments to a Manual Review item, each showing author and timestamp, in chronological order.
- [ ] The Activity Log on a Manual Review item accurately reflects every status change, assignment change, and comment in order.
- ~~[ ] Navins Renew Queue supports bulk-assign and bulk-mark-done across multiple selected rows.~~ **Removed 2026-07-15** — the standalone Navins Renew Queue screen was descoped (§5.5); bulk actions went with it. Navins Renew items are now actioned one row at a time via Team View's Navins Renew tab (including its self-filtered default view, §5.3).
- [ ] Auto-Renew (RPUX) Log is browsable, filterable, and read-only, with expandable rows showing what was checked and cleared.
- [ ] All changes persist across a page reload (not just in-memory client state).
- [ ] The app is deployed to a public Vercel URL running against anonymized seed data only; no real customer data is present in the deployed build or the committed repo.
- [ ] Country-boundary enforcement is verified server-side, not just in the UI: attempting to fetch another country's data via the API directly (not through the app's own UI) is rejected based on the session cookie, not the request parameters.
- [ ] Two different browser sessions (simulating two underwriters, e.g. two incognito windows each with a different "Acting as" identity) both see the same assignment/status/comment changes on a shared policy **after a reload** — proving persistence is real and shared, not per-browser. This does not require live/real-time sync (explicitly out of scope per §1) — a manual refresh showing the other session's change is sufficient.
- [ ] A single persistent "demo application" banner is present app-wide (not per-field tagging), and the anonymization validation check (§8) confirms no real names/brokers leaked into the seed data.

---

## 12. Open items / assumptions to confirm before or during the build

- Only the Denmark file (`20260709_DK_RenewalsScreening_004.xlsx`, 129 rows) has been reviewed in detail as of this draft, and per the prerequisite at the top of this document, **the build should not start until Norway, Sweden, and Finland files are also provided** — this was a deliberate decision, not an oversight. The app should still be built country-generically so adding the remaining files is a data step, not a code change.
- Reassigning another underwriter's actively-in-progress item is allowed without restriction in MVP — revisit if this causes confusion in practice.
- No notifications (in-app or email) are in scope for MVP — this is a pull-based tool (users check their queue), not a push-based one.
- "Escalated" has no distinct destination/owner in MVP (no senior role) — it's a visible status only. If stakeholder feedback says this isn't good enough even for a prototype, that's a Phase-2-of-the-prototype conversation, not a rebuild.
- **Future backend integration point undecided (post-MVP):** when this graduates from static seed data to the live `catalyst-renewal-screening` backend, the integration could either parse the backend's rendered Excel output (no backend changes, but fragile — coupling to a human-facing render format) or have the backend expose a JSON API for scored policies (cleaner, but requires backend work). Not a blocker for this MVP either way; flagging so it isn't forgotten.
