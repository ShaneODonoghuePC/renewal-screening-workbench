# Renewal Screening Workbench — Prototype Spec

Status: **Living spec, tracking a deployed application** (superseded its original "Draft v1, pre-build" status long ago — kept current against the code rather than treated as a historical snapshot)
Author: Shane O'Donoghue (Plain Concepts), drafted with Claude
Originally drafted: 2026-07-13 · **Last reviewed: 2026-09-09**, verified against the code and `git log`, not against memory of what was asked for

Sections describe the app as it runs today unless explicitly labeled otherwise (provenance/history sections — §5.1, §5.5, §5.6, §6.4, parts of §12 — are intentionally kept as historical record and say so inline). Revision history lives in `git log`, not in this document's header.

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

**Confirmed exhaustively, not just assumed (2026-07-24, `scripts/lib/synthesizePlan.ts`, documented here 2026-09-09):** this table's rule was checked against all 337 original policies with zero exceptions while building the dataset's row-count/VAT synthesis fix — routing is fully and only determined by source system (RPX-prefixed id vs. the Navins id scheme, `{country}-10.101-{NNNNN}/25/01`) plus whether any flag fired, never sampled or set independently of that. This is the same rule stated above; it just went from an assumption to something the codebase has since verified row-by-row. A synthesis-generator bug that briefly violated this rule for a handful of generated rows (both directions: a flagged RPX row synthesized onto `RPUX Auto Renew`, and flag-free RPX rows synthesized onto `NAVINS Renew`) was found and corrected on both `local.db` and production Turso via a dry-run/apply script pair (§8) — see `scripts/fix-routing.ts` and `scripts/lib/fixRoutingPlan.ts`.

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

**Note (added 2026-09-09) — these six Stage 2 flags are not uniform once you're inside the Risk Assessment panel's own Company & Financial letter grade (§5.4), a workbench-only prototype feature distinct from this section's routing/attention rule (§3.1/§3.2, which does treat all six/`stage2FlagCount` uniformly and is unaffected by this note).** Within that grade specifically, D&B No Match and D&B Status Inactive don't count toward the letter grade at all — they instead gate whether the grade is computed in the first place (Data Confidence Unverified → Company & Financial shows "N/A," not a grade). Only D&B Rating Below A, Latest Profit Negative, Assets Moved >25% YoY, and D&B Listed Company feed the actual B/C thresholds. All six are styled identically in the panel's flag breakdown, which is what makes this easy to miss from the UI alone (§5.4). Separately, this "Data Confidence" gate is not the same computation as the panel header's Data Verified/Not Verified pill, which is an open product question — see §5.4.

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

A separate "My Queue" screen was originally specified and built as the app's default landing page: everything assigned to the logged-in user, across Manual Review and Navins Renew, sorted by renewal date, with a Navins Renew row opening an inline mark-done action rather than a separate detail page. It has been **removed**. Team View (§5.3) is now the landing page, and its "Assigned to" filter defaults to the acting-as user on load — the same personal view, without a second screen showing largely the same underlying data.

**Note (2026-07-22): the "Navins Renew inline mark-done behavior is preserved as-is" statement above no longer holds.** Navins Renew replaced its two-state Pending/Done toggle with a full six-state workflow (§6), so there's no longer a single "mark done" action — it's superseded by the same inline Underwriter Workspace row-expansion Manual Review uses (§5.3/§5.4), status-graph-aware to Navins Renew's own transitions.

### 5.2 Month navigation

**Note (2026-07-24, documented here 2026-09-09): this is no longer a tab bar, and no longer shared across multiple pages.** There is only one screen to share it with now (§5.3) — Assignment & Management, the Auto-Renew Log, and Closed Items were consolidated into it (§5.3). At the same time, the `Consolidate Manual Review/Navins/Auto-Renew/Closed into one list` commit deleted the `MonthTabBar` component entirely; the month control is now a plain `<select>` dropdown (`app/page.tsx`), not a row of clickable tabs. `buildMonthTabs` (`lib/monthTabs.ts`) still exists and still computes the same `{value, label, count}` list described below — only its consumer changed, from a tab strip to a `<select>`'s `<option>` list. Below, "tab" means one of these computed month entries, not a clickable UI tab.

Month entries are derived from whatever Renewal Month values are actually present in the currently routing/status-filtered set (§5.3) — naturally 2-3 at a time, matching the rolling window — each labelled with a count (e.g. "October 2026 (18)"), plus an **All** entry for the full spread. The selected month is reflected in the URL (e.g. `/?month=2026-10`) so a specific month's view is bookmarkable/shareable. `buildMonthTabs` itself no longer excludes terminal-status items when computing these counts (it did previously) — that exclusion decision now belongs entirely to the caller's Routing/Status filters (§5.3), since a closed item is no longer unconditionally hidden the way it used to be (§5.3a).

Default on entry: **"All"** (`app/page.tsx`, `pageDefaultMonth = 'all'`) — not the soonest-outstanding-month default described in earlier drafts of this document. This was changed on 2026-07-22 (`9810ec8`, predating the consolidation) because the time period being viewed was hard to tell at a glance under the soonest-month default; "All" makes it unambiguous. There is no longer a second page to diverge from — the old note about Assignment & Management and the Auto-Renew Log deliberately using different defaults no longer applies now that only one page exists.

**Renewal Month derivation (business rule, confirmed 2026-07-15, unchanged):** Renewal Month is not simply the calendar month of `renewalDate` — it's `month(renewalDate) + 1`, with year rollover (a December `renewalDate` produces a Renewal Month of January in the following year). Example: `renewalDate` of 2027-03-29 → Renewal Month of April 2027 (`lib/renewalMonth.ts`). This derived value is what drives the month-dropdown bucketing/labelling here — not the raw month of `renewalDate`.

### 5.3 Renewal Management (default landing page, since 2026-07-15; renamed from "Team View" 2026-07-22; consolidated 2026-07-24, documented here 2026-09-09)

**This section describes the app as of 2026-07-24 (`9036df2`, "Consolidate Manual Review/Navins/Auto-Renew/Closed into one list"), which superseded everything below it as written in earlier drafts of this document.** Renewal Management is a single unified, filterable list at `/` — there is no longer a Manual Review/Navins Renew tab split within the page, and no longer a separate Auto-Renew Log or Closed Items screen (§5.6, §5.3a below are now historical notes, not live screens). Navigation is down to one link, "Renewal Management," pointing at `/` (`components/HeaderNav.tsx`) — clicking it while already on `/` is a deliberate no-op that still shows the active-tab underline. The old `/review/auto-renew` and `/review/history` URLs are now redirect-only stubs to `/`, kept so a bookmarked link lands somewhere useful instead of 404ing.

There is no separate personal queue (§5.1). On load, the **"Assigned to" filter still defaults to the acting-as user**, not "All" — this is what continues to replace My Queue's former role as the personal view (this part is unchanged since 2026-07-15). Switching "Assigned to" to "All" or to a specific teammate works exactly like changing any other filter, and the default is applied once per identity, not re-forced if the user deliberately switches it away.

**Page hierarchy, top to bottom (current, verified against `app/page.tsx`):**
1. No page title/H1 — the single "Renewal Management" nav link identifies the page now, so a repeated on-page title was dropped.
2. **Month picker** (§5.2), on its own, above everything else.
3. Summary strip — **six** month-scoped counts, independent of every filter below it: Total renewals, Auto-renew, Navins Renew, Manual Review, **Closed** (added 2026-07-24, `4d57a69` — counts whatever the Status filter's "Closed" bucket would show, not a separate definition), Total flags raised.
4. The filter row — no tab split to condition it on anymore, so every filter below applies across all three routings at once: **Broker** (single-select, "All" default), **Assigned to** (single-select, "All" default, defaults to the acting-as user per above), **Status** (multi-select, options `Not Started` / `Started` / `Closed`, "All" default — see the distinction from the per-routing status graphs, §6), **Routing** (multi-select, options `Manual Review` / `Navins Renew` / `RPUX Auto-Renew`, "All" default), **Attention** (single-select, "All" default — no longer Manual-Review-only, since Attention is a column on every routing now that they're mixed in one table), **Flag type** (multi-select, "All" default, only rendered at all when the currently visible set has at least one flag reason to filter by), **Sort by** (Renewal date / Attention / Status) plus an ascending/descending toggle.
5. The table itself.

Both the Routing and Status filters default to **"All"** (changed 2026-07-24, `9810ec8`, predating the consolidation by a few hours) — a deliberate reversal of the previously-matched Manual Review + Navins Renew / Started + Not Started defaults, made explicitly so that nothing is hidden on first load. There is no deeper rationale beyond that stated intent; don't read one in.

**Table columns, current order:** expand caret, Policy, Broker, Customer, **VAT Number** (new to this table, reuses `customerIdentifier` — the same field the Risk Assessment panel's Identity & Context section reads), Renewal date, Assigned to, Status, Actions, Attention, **Routing** (new column).

The **Status column shows only "Not Started" / "Started" / "Closed"** at a glance (collapsed, computed via `getStatusBucket`, not stored) — the real granular state (`In Review`/`With Broker` for Manual Review, `Quote Sent`/`Policy Sent`/one of the three terminal values for Navins Renew) is only visible once a row is expanded into the Underwriter Workspace (§5.4b), where the (possibly disabled) Status `<select>` shows the real current value. RPUX Auto Renew rows show no Status or Assigned-to value at all (there is no `review_states` row for them) — see below.

**Row behaviour differs by routing and status — three distinct kinds, not two:**
- **RPUX Auto Renew rows:** no Assigned-to/Status cell content, no Actions controls. The expand caret reveals a read-only `FlagDetailPanel`, headed "Operational Review Flags (all clear)" / "Company & Financial Flags (all clear)" — this is what covers the former Auto-Renew Log's role (§5.6).
- **Closed rows** (Manual Review or Navins Renew that has reached one of its terminal statuses, §6.3): stay in this same table — selectable via the Status filter's "Closed" bucket — rather than moving to a separate screen. The expand caret reveals the same Underwriter Workspace component (§5.4b) any open row gets, but in a `readOnly` mode: the Status and Assigned-to `<select>`s are disabled (still showing the real current value), the comment-entry box is hidden entirely, and the mutation handlers themselves short-circuit on the `readOnly` flag as defense in depth, independent of the disabled attribute. **The read-only mechanism itself is deliberate, settled product behaviour** — reviewed live and accepted by Shane on 2026-07-24, not an interim state pending a proper Closed Items screen.
  ⚠️ **Two unresolved regressions from this same consolidation, not decisions — do not treat either as settled:**
  - The Actions column shows nothing at all for a closed row (no Review button, no Assign-to-me, no assigned-to select). For a closed Manual Review policy this means **the table itself no longer offers a way into the Risk Assessment panel** — the risk evidence (grades, flags, financials) that the original status decision was based on. The panel is still reachable directly via `/review/manual/[id]` (§5.4) for anyone who already has the policy id, since that standalone route has no closed-state gating of its own, but there is no link to it from the closed row. The comment thread and activity log (both still visible in the read-only workspace) survive; the risk evidence a reviewer would need to understand *why* a decision was made does not. This was flagged as an open design call in the consolidation commit's own message and has not been reviewed as a deliberate trade-off — treat it as a bug to fix, not a spec to build against.
  - **There is no longer a "date closed" figure surfaced anywhere in the UI.** The activity log inside the expanded (read-only) workspace still shows timestamped status-change history (so the information is technically recoverable by reading it), but nothing computes or displays a single "date closed" value the way the former Closed Items screen did.
- **Open Manual Review/Navins Renew rows** (not yet at a terminal status): the expand caret reveals the same Underwriter Workspace, fully interactive. The Actions column additionally shows, **Manual Review only**, a **"Review" button** opening the Risk Assessment panel (§5.4) as a slide-out; both routings get an "Assign to me" shortcut (when unassigned) and an assigned-to `<select>`. Navins Renew still has no Review button and no Risk Assessment panel — Navins Renew policies are clean at intake (zero flags, which is why they route here rather than to Manual Review), so there's no risk-quality judgment call to surface for them.

Across all three kinds, the **whole row is clickable to toggle the expand row** (not just the caret), while Review/Assign-to-me/the assigned-to select each stop click propagation so they don't also trigger the row toggle — this distinction predates the consolidation and is unchanged by it.

### 5.3a Closed items — status filter bucket, not a screen (folded into Renewal Management 2026-07-24, documented here 2026-09-09)

**There is no longer a dedicated Closed Items screen.** Earlier drafts of this document (and the app itself, between 2026-07-22 and 2026-07-24) had one at `/review/history`; it was consolidated into Renewal Management (§5.3) in the same pass that removed the Auto-Renew Log and the Manual Review/Navins Renew tab split. `/review/history` now redirects to `/`. What the old screen did — showing a policy's real terminal status and letting it be reviewed without further mutation — is now covered by: selecting "Closed" in the Status filter (§5.3), and expanding a closed row into its read-only Underwriter Workspace (§5.3a's behaviour is now documented as part of §5.3's row-behaviour breakdown above, not as its own screen). Two capabilities from the old screen did not carry over, and neither was a deliberate trade-off — see §5.3's regression callout for the full description: a dedicated "date closed" figure, and (for Manual Review) a table-level path into the Risk Assessment panel's risk evidence.

### 5.4 Risk Assessment (read-only panel; renamed from "Manual Review Detail" 2026-07-22, then from "Risk Quality & Recommendation" to "Risk Assessment" 2026-07-24, documented here 2026-09-09)

**Reached two ways, same component both times:** the "Review" button's slide-out on Renewal Management (open Manual Review rows only, §5.3), and the standalone `/review/manual/[id]` page. Both show identical content — the slide-out adds a Close button and its own header bar; the standalone page adds a "← Back to Renewal Management" link in the same position instead. **Manual Review only** — there's no equivalent for Navins Renew (§5.3).

This panel is **strictly read-only** — status, assignment, comments, and activity live in the separate Underwriter Workspace (§5.4b). **Section order, top to bottom (current, verified against `components/RiskQualityPanel.tsx`):**

- **Header** — title ("Risk Assessment," `text-2xl font-bold` — deliberately larger/bolder than the section headers below it, changed 2026-07-24 so the panel-level header reads as clearly above them rather than matching), a **Data Verified / Data Not Verified pill** (mapped from the `dnbNoMatch` flag: `false` → "Data Verified (D&B match found)", `true` → "Data Not Verified (D&B No Match)"), and the Attention badge. The pill and badge moved up into this row from Identity & Context on 2026-07-24 — they're policy-level status, not specific to that one section. There is no rating-explanation subtext here — it briefly sat next to the panel title (2026-07-22–2026-07-24) but was moved down to sit beside the "Risk Quality" section's own header instead (2026-07-24), one level below the panel title, and stays there.
- **Identity & Context** — Policy Number, **VAT Number** (label renamed from "Customer Identifier"), Customer Name, Broker Name, **Current Term End Date** (renamed from "End Date"). **Currency and Premium were dropped from this section on 2026-07-24** — Renewal Financials (below) now carries the premium figures, each formatted with its currency inline, so showing them twice added nothing.
- **Renewal Financials** (renamed from "Renewal Economics" 2026-09-09; internal order reversed 2026-07-24): Expiring Premium (with year), Renewal Proposed Premium (with year), % change — **in that order now**, with a "3 Year Loss Ratio Trend" sub-header and sparkline underneath, rather than the sparkline coming first as in earlier drafts of this document. The sparkline reads from the same `lossRatioHistory` data as the Historical Performance table further down (built once, shared, §7) — not a second, independently-generated trend. **The display name and the code diverge, deliberately: the underlying field is still `renewalEconomics`** (`RiskQuality.renewalEconomics` in `lib/mockRiskQuality.ts`, read as `riskQuality.renewalEconomics.{expiringPremium,renewalPremium,movementPercent}` in `RiskQualityPanel.tsx`) — renaming the key would touch the shape the panel consumes, which is out of scope for a display-only rename, so the code was deliberately left alone. Don't write `renewalFinancials` anywhere in this codebase on the strength of this document; the key to use is `renewalEconomics`.
- **Risk Quality** — h2 header, with the rating-explanation subtext (`describeRating()` — see below) sitting directly beneath it as this section's own subheading, not the panel's. The three graded dimensions (Operational, Company & Financial, **Historical Performance** — renamed from "Historical" 2026-07-24, deliberately reusing the exact name of the Historical Performance section further down; the commit that made the change calls this "intentional, not a collision to fix," since one is the grade card and the other is the section) each still shown individually as its own card. **The section container itself is colored by whichever of the three has the worst letter grade** (unchanged since 2026-07-22) — one C anywhere turns the whole section red even if the other two are A. This section keeps a boxed/bordered treatment specifically so that coloring reads as a section-level signal; every other section on the panel is unboxed. **Flag Reasons** (the full comma-separated text) sits as a closing line inside this same box, below the three grade cards.
  - **`describeRating()` replaced an earlier `computeRecommendation()` on 2026-07-24.** The old function produced an action-directive ("Escalate," "Renew as standard," "Auto-renew," etc.) alongside a suggested status; `describeRating()` is purely descriptive of what's driving the current grades/momentum — no action directive, no suggested status. This matches the panel being information-only now (§5.3's row actions are the only place a status decision actually gets made).
- **Flag breakdown** — headed **"Operational Review Flags" / "Company & Financial Flags"**, not "Stage 1 flags" / "Stage 2 flags" as earlier drafts of this document say. This rename happened 2026-07-24 (`72aa316`), not 2026-07-22 as previously documented here. Each flag shown as Y/N with a short label (the Stage 2-sourced ones also showing a synthesized supporting figure, §7.1). Triggered flags that count toward a grade fill their whole row with a severity color (critical — Open Claim, Premium Unpaid — red/white text; everything else that counts toward a grade, amber/dark text). `Is Frame` renders as a plain row in the same box as the other Stage 1 flags (folded in 2026-07-23, `0e1e272` — previously a separate line below the box) but stays visually plain/unfilled even when true, since it was never a real flag (§3.3) — see the graded-vs-informational breakdown below for exactly which rows this plain treatment applies to.
- ~~**Derived**~~ **— removed 2026-07-22, still removed.** This section used to show Stage 1/Stage 2 flag counts, Routing, and Attention alongside Flag Reasons — all four redundant with information shown elsewhere on the panel. Flag Reasons survived (see above) as the only place the four attention-only signals (Data Incomplete, D&B Predictor Concern, D&B Significant Event, D&B Listed Status Unknown) are visible at all (§3.2).
- **Historical Performance** — **substantially rewritten 2026-07-24, not "unchanged" as earlier drafts of this document say.** "3-Yr Loss Ratio" sub-header over a full table: Year / Gross Premium Written / Claims Incurred / Loss Ratio (highlighted) rows for three years oldest→newest, plus a 3-Yr Avg column — built from `lossRatioHistory` (§7, computed at request time, not a new persisted field). This table **replaced** the earlier standalone Loss ratio / Claims paid / Cumulative premium figures entirely (dropped, since the table now shows the same figures plus two more years of history) — those three no longer appear anywhere on the panel. Claim Frequency and Tenure survive, now in their own bordered "Policy Metrics" block (added 2026-07-24, `107a9b8`) matching the table's visual weight rather than trailing underneath as bare rows. **The "mocked and does not affect grade" claim in earlier drafts of this document is now wrong in the second half:** the Historical grade (in the Risk Quality section above) is computed directly from this same `lossRatioHistory`'s 3-year exposure-weighted aggregate — the two are now the same underlying data, not independent. The data itself is still mocked (no real prior-cycle claims trajectory exists yet), but it is no longer inert with respect to the grade.

**Graded dimensions — what each grade computation actually consumes (verified against `lib/mockRiskQuality.ts`, not against how a flag is styled in the UI — styling alone is misleading here, see below):**

- **Operational** (`computeOperationalGrade`) — consumes exactly the four Stage 1 flags: Open Claim, Premium Unpaid, Renewal Type Manual, System Listed Company. Open Claim or Premium Unpaid alone forces a C regardless of count; otherwise 1 flag → B, 2+ → C, 0 → A. `Is Frame` is not in this computation at all (§3.3 — it's not a flag).
- **Company & Financial** (`computeCompanyFinancialGrade`) — consumes exactly four booleans: D&B Rating Below A, Latest Profit Negative, Assets Moved >25% YoY, and **D&B Listed Company, added 2026-07-24** (`9810ec8`) — previously excluded from this computation, "informational only, same as the real methodology" per this document's own earlier text; that earlier text is now wrong. 1 fired → B, 2+ → C, 0 → A.
  - **This dimension is only computed at all when Data Confidence is Verified** (`computeDataConfidence`, `lib/mockRiskQuality.ts:81-83`, gating logic that earlier drafts of this document never named or documented) — Verified means **neither** D&B No Match **nor** D&B Status Inactive is true. When Unverified, `companyFinancial` is `null` (gated at the single call site, `mockRiskQuality.ts:280`): the card shows "N/A" and an explanation banner, and `describeRating()` appends "Company & Financial is not yet graded (Unverified)."
  - **Open product question (found 2026-09-09, not fixed here): the header's Data Verified/Not Verified pill (§5.4 Header, above) uses a *different, narrower* definition of "verified" than this gate does.** The pill is computed independently, directly in the component (`RiskQualityPanel.tsx:251`, `dnbVerified = !policy.dnbNoMatch`) — it consults only D&B No Match. `computeDataConfidence` consults **both** D&B No Match **and** D&B Status Inactive. The two definitions agree for every policy in the current dataset only because no policy currently has D&B Status Inactive true while D&B No Match is false (see the dataset check below) — but nothing in the code ties them together, and a policy in that combination would show a green "Data Verified" pill in the header while its Company & Financial card simultaneously showed "N/A" with no visible explanation connecting the two. This is a real product inconsistency, not intended design, and is not resolved by this document — flagging it for a decision (e.g., make the pill consult both flags, or make the gate consult only one).
    - **Dataset check (2026-09-09):** across the full live dataset (403 policies — the 337 original rows plus all 66 rows added by the synthesis fix, §8 — `local.db`, confirmed identical to production Turso): `dnbStatusInactive` is `true` on **zero** rows, and `dnbNoMatch` is `true` on exactly **one** (`RPX-DK-10079`, DK) — both figures unchanged from the 337-row original-only count, so the synthesis fix (§8) introduced no new instances of either flag. The specific inconsistent combination (D&B Status Inactive true, D&B No Match false) occurs on **zero** rows. The divergence above is real in the code but currently latent in the data.
    - **Test-coverage consequence, separate from the divergence itself:** the Unverified/"N/A" path (`companyFinancial: null`) is reached by exactly the one policy with D&B No Match true, out of 403 — everything else in this codebase's handling of that path (the banner copy, the `describeRating()` suffix, the grade card's "N/A" rendering) is exercised by a single row in the entire dataset. Treat this path as effectively untested by the data, not just under-documented.
  - **The trap this document was asked to check for, and found:** D&B No Match and D&B Status Inactive are both rendered in the flag breakdown with `severity="warning"` — the exact same full-row-fill treatment as D&B Rating Below A / Latest Profit Negative / Assets Moved / D&B Listed Company. Visually, all six Stage 2 flags look identical when fired. **They are not functionally identical.** Only four of the six feed the letter-grade tally; the other two (D&B No Match, D&B Status Inactive) instead gate whether that tally is computed at all. §3.3's flat list of six "Stage 2" flags does not currently distinguish these two roles.
- **Historical Performance** (`computeHistoricalGrade`) — consumes the 3-year exposure-weighted aggregate loss ratio from `lossRatioHistory` (see above): >75% → C, 55–75% → B, <55% → A (thresholds are a stated assumption, tuned to the shipped distribution's mean/SD, not a real actuarial standard). Fully mocked — no real prior-cycle claims data exists yet — but no longer independent of the 3-Yr Loss Ratio table now displayed alongside it.
- **Informational only, confirmed never consumed by any grade computation:** `Is Frame` (§3.3, unchanged) and the four attention-only Flag Reasons entries (Data Incomplete, D&B Predictor Concern, D&B Significant Event, D&B Listed Status Unknown, §3.2, unchanged) — these were already correctly documented as informational in earlier drafts of this document, and remain so.

### 5.4b Underwriter Workspace (relocated 2026-07-22; page renamed 2026-07-24, documented here 2026-09-09)

The status/assignment/comment/activity controls that used to live bundled inside Manual Review Detail live in a **separate component**, reached via an inline row-expansion (caret toggle) on Renewal Management's single table (§5.3) — for **both** Manual Review and Navins Renew, since it's routing-aware (it picks whichever status graph, §6, applies to the row it's rendering for). No schema change was needed for Navins Renew to gain this — `Comment` and `ActivityLogEntry` (§7.3/§7.4) were already generic per policy, not scoped to Manual Review.

**Note (2026-07-24, documented here 2026-09-09):** the component now also renders for closed (terminal-status) rows, in a `readOnly` mode — Status/Assigned-to disabled, comment entry hidden, mutation handlers short-circuited — rather than being unreachable for them. See §5.3's row-behaviour breakdown for the full description; this is deliberate, settled behaviour, not a gap.

Contents (interactive mode; see the note above for the read-only variant):
- Status control — a `<select>` offering the current status plus whatever it can legally transition to (§6), not a free choice of every status.
- Assigned-to control — dropdown of the country's users, or "Unassigned," plus an "Assign to me" shortcut.
- Comment thread — chronological, author + timestamp, append-only (no editing/deleting).
- Activity log — chronological, timestamped, attributed feed of status changes, assignment changes, and comments. Also surfaces `status_migration` entries (§7.4) where present — the one-time Phase 2A workflow migration's audit trail, so a policy whose status was reinterpreted under the old-to-new mapping shows that plainly rather than looking like an ordinary human status change.

### 5.5 Navins Renew Queue — descoped (removed 2026-07-15)

A standalone Navins Renew Queue screen was originally specified and built here: a checklist table (policy number, customer name, renewal date, assigned-to, status) with multi-select bulk actions (bulk-assign, bulk-mark-done). It has since been **removed** — redundant once My Queue surfaced a user's assigned Navins Renew items directly (with an inline mark-done action, §5.1) and Team View's Navins Renew tab covered the country-wide view (self-assign, reassign, mark done per row, in what was then §5.3). A third screen showing the same underlying data added navigation without adding capability.

**Trade-off accepted, not silently dropped:** the standalone screen's *multi-select bulk actions* (acting on several Navins Renew policies in one operation) go away with it. Navins Renew items are now actioned one row at a time, via Renewal Management's inline Underwriter Workspace (§5.4b) — updated 2026-07-24 for the page rename/consolidation, documented here 2026-09-09. If bulk actions turn out to matter in practice at real volume, the right place to reintroduce them is Renewal Management's Routing filter (select just `Navins Renew`, add multi-select there), not a fourth screen.

### 5.6 Auto-Renew (RPUX) Log — descoped as a separate screen (folded into Renewal Management 2026-07-24, documented here 2026-09-09)

**There is no longer a standalone Auto-Renew Log screen.** It sat below the month-tab bar (§5.2), read-only, filterable, no actions, with each row expandable to show which data sources were checked and confirmed clean — the description below is retained as historical record of what it did, since that capability didn't disappear, it moved. As of 2026-07-24 (`9036df2`), `RPUX Auto Renew` is one of three options in Renewal Management's Routing filter (§5.3) instead of its own page; `/review/auto-renew` now redirects to `/`. The former table's columns (policy number, customer name, renewal date, premium) are superseded by Renewal Management's own table columns (§5.3), which are the same core fields plus broker/VAT/assigned-to/status/attention/routing. The row-expansion behaviour is unchanged in substance: each RPUX Auto Renew row still expands into a read-only flag breakdown (Stage 1 flags all N, Stage 2 flags all N), including the synthesized clean-state figures from §7.1 (e.g. "D&B Rating: AA2", "Latest Profit: +140,000 DKK") — now headed "Operational Review Flags (all clear)" / "Company & Financial Flags (all clear)" to match the Risk Assessment panel's flag-section naming (§5.4) — preserving the "never silently pass" principle from the original design intent, even though there's nothing to do about it.

---

## 6. Status workflows

**Both workflows below were replaced outright in the Phase 2A redesign (2026-07-22)** — not relabeled, not extended. The graphs immediately below are what the app actually enforces today; the original MVP graphs (New/In Review/Escalated/Renewed/Not Renewed/Closed for Manual Review, Pending/Done for Navins Renew) are kept afterward for provenance/migration context only, since real production rows had to be mapped from the old shape to the new one and that mapping is part of this app's history.

**Two distinct status vocabularies exist in this app — do not conflate them (added 2026-09-09, to prevent a real mistake):**
1. **The per-routing state graphs below (§6.1, §6.2)** — the actual `reviewStates.status` values a policy can hold, enforced server-side by `isValidStatusTransition` (`lib/statusWorkflow.ts`) and offered by the Underwriter Workspace's Status `<select>` (§5.4b). Manual Review and Navins Renew each have their own graph with their own vocabulary (`Not Started`/`In Review`/`With Broker`/... vs. `Not Started`/`Quote Sent`/`Quote Declined`/...) — a policy is on exactly one graph, decided by its routing, never both.
2. **Renewal Management's Status *filter* buckets (§5.3)** — `Not Started` / `Started` / `Closed`, computed client-side by `getStatusBucket` (`app/page.tsx`) purely to let both routings' rows be filtered and displayed together in one table. `Not Started` means the real status is exactly `Not Started`; `Started` means any non-terminal status other than `Not Started` (`In Review`, `With Broker`, `Quote Sent`, `Policy Sent` all collapse into it); `Closed` means any terminal status on either graph (`isTerminalStatus`, §6.3). This bucket is a display grouping only — it is never written to `reviewStates.status`, and it has no transition rules of its own; it's a lens over whichever real graph applies to a given row, not a third graph.

### 6.1 Manual Review

```
Not Started → In Review → With Broker → Renewed
                                       → Not Renewed
```

- `Not Started`: default state when a policy enters Manual Review, unassigned. (Renamed from `New` — the data-model value itself changed, not just the label, to stay consistent with Navins Renew's `Not Started` below.)
- `In Review`: assignment and status remain fully independent controls, as in the original design — assigning someone does not automatically change status.
- `With Broker`: replaces the old `Escalated` state's role as the working, non-terminal "still in progress" state — there is no longer an escalation/second-opinion concept in the workflow itself.
- `Renewed` / `Not Renewed`: **terminal.** Unlike the original workflow, these are not intermediate decision outcomes requiring a separate `Closed` step — reaching either one is what the Status *filter bucket* (distinct concept, see above) calls "Closed." The row itself does not move anywhere (§5.3, §6.3) — it stays in Renewal Management's one table, now selectable only via the "Closed" bucket. There is no standalone `Closed` status value in this graph at all.

### 6.2 Navins Renew

```
Not Started → Quote Sent → Quote Declined
                          → Policy Sent → Renewed
                                        → Not Renewed
```

- `Not Started`: default state (renamed from `Pending`).
- `Quote Sent` / `Policy Sent`: working, non-terminal states — the granular vocabulary the expanded-row Status control offers (§5.4b); both collapse into the "Started" filter bucket at the table level (§5.3, and see the two-vocabularies note above).
- `Quote Declined`, `Renewed`, `Not Renewed`: **all three terminal** — same as Manual Review's terminal states, any of them is what the "Closed" filter bucket means for a Navins Renew row (§5.3, §6.3). Note there are three distinct terminal outcomes here, vs. two for Manual Review.

This graph is a best-guess model of a realistic quote-to-bind flow, not one confirmed against Navins' actual process end-to-end — flag it for review if real usage suggests a different shape is needed (e.g. a quote being revised rather than only sent-once, or a declined quote being revivable).

### 6.3 Terminal statuses (2026-07-24 behaviour: no longer a screen move, documented here 2026-09-09)

A status is terminal if it's `Renewed`, `Not Renewed` (either routing), or `Quote Declined` (Navins Renew only) — `isTerminalStatus()` in `lib/statusWorkflow.ts`. Reaching a terminal status is a display change, not a data-loss event: the underlying row is untouched. **As of 2026-07-24, that display change is no longer "moves to a separate screen."** The row stays exactly where it was, in Renewal Management's one table (§5.3) — it becomes selectable via the Status filter's "Closed" bucket (rather than "Not Started"/"Started"), and its inline Underwriter Workspace (§5.4b) switches to read-only (deliberate, settled — §5.3). Earlier drafts of this document described terminal items moving into a dedicated Closed Items screen that showed the real terminal value and a computed "date closed." That screen no longer exists (§5.3a); the real terminal value is still visible (as the current, disabled value of the expanded row's Status control), but the "date closed" figure is gone with no replacement — **an unresolved regression, not a decision (§5.3).**

### 6.4 Provenance: the original MVP graphs (superseded 2026-07-22)

Kept for historical/migration context only — **do not build against these**, they no longer exist in the running app.

Original Manual Review (corrected 2026-07-15 to make `Escalated` resolvable, then fully replaced 2026-07-22):
```
New → In Review → Renewed     → Closed
              → Not Renewed → Closed
              → Escalated   → Renewed     → Closed
                            → Not Renewed → Closed
                            → Closed
```

Original Navins Renew:
```
Pending → Done
```

**Migration mapping used when production rows were moved from the old graphs to the new ones (2026-07-22):** `New → Not Started` and `Pending → Not Started` (plain relabels). `Escalated → In Review` (no direct equivalent in the new graph; treated as a fallback, not a guess dressed up as one). Rows already at `Closed` were backfilled to `Renewed`/`Not Renewed` by reading the last status change recorded in their activity log before `Closed`, where recoverable; where not cleanly recoverable, they were provisionally mapped to `Renewed` and explicitly flagged (both to the person who ran the migration and via a `status_migration` activity-log entry, §7.4, on the affected row) rather than silently guessed. Rows at `Done` had no recorded signal for which of the three new terminal states they reached, so all were provisionally mapped to `Renewed` and flagged the same way. Every provisional/flagged mapping was confirmed by a human before being applied to the production database — this was treated as a data-integrity decision requiring sign-off, not something safe to automate silently.

---

## 7. Data model

**Note (verified 2026-09-09):** the persisted schema (`lib/db/schema.ts` — `policies`, `users`, `review_states`, `comments`, `activity_log`) has **not changed** since the initial commit; every table/column below is still accurate as a description of what's actually stored. This holds despite substantial changes elsewhere since 22 July (§5, §6) — those were UI/behaviour changes over the same stored shape, not schema changes. The Risk Assessment panel's 3-Yr Loss Ratio table and sparkline (§5.4, added 2026-07-24) are the one likely-looking exception worth calling out explicitly: they are **not** backed by new columns — `buildLossRatioHistory()` (`lib/mockRiskQuality.ts`) computes that data fresh on every request, deterministically seeded from the policy id, the same way the rest of §7.1's "synthesized evidence fields" work below.

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

**Synthesized evidence fields (not in the source export — see §8):** the real screening export only has the Y/N flags above; it doesn't carry the underlying D&B figures that produced them. Per the SA review decision, the anonymization/seed-generation step fabricates plausible supporting values, consistent with each flag's fired/not-fired state, so the Risk Assessment panel (§5.4, formerly "Risk Quality & Recommendation," formerly "Manual Review Detail") and the RPUX Auto Renew rows' read-only flag breakdown (§5.3, formerly the standalone Auto-Renew Log, §5.6) have something concrete to show:

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

`policyId` (FK), `status` (per §6, scoped to routing — Auto-Renew policies have no ReviewState at all), `assignedUserId` (FK, nullable). Stored as a plain `text` column with no CHECK constraint — legality of a given transition is enforced in the API layer (`isValidStatusTransition`, §6), not by the database schema.

**Created at seed time, not lazily.** Every Manual Review policy gets a `ReviewState` row at `Not Started`/unassigned when the seed data loads; every Navins Renew policy gets one at `Not Started`/unassigned (both renamed from `New`/`Pending` respectively, §6). The app should never need to handle "policy with no `ReviewState` row yet" as a special case — if you find yourself writing that check, the seed script is missing something.

### 7.3 `Comment`

`id`, `policyId` (FK), `userId` (FK), `text`, `createdAt`. Generic per policy — not scoped to Manual Review specifically, which is what let the Underwriter Workspace (§5.4b) extend to Navins Renew without a schema change.

### 7.4 `ActivityLogEntry`

`id`, `policyId` (FK), `eventType`, `userId` (FK, nullable), `detail` (JSON), `createdAt`. `eventType` values: `status_change`, `assignment_change`, `comment_added`, and (added 2026-07-22) **`status_migration`** — a one-time-use event type written only by the Phase 2A production migration (§6.4), `userId: null`, `detail: {from, to, reason}`. The Underwriter Workspace's activity feed (§5.4b) renders this distinctly from an ordinary human status change, so a migrated/reinterpreted status reads honestly rather than looking like something a person decided.

**Bulk actions (Navins Renew) write one `ActivityLogEntry` per affected policy**, not one entry for the whole batch — same `createdAt` timestamp across the batch, but each policy's own history stays complete and consistent whether it was actioned individually or as part of a bulk operation. No separate "batch" table/entity for MVP. **Note:** bulk actions themselves were descoped along with the standalone Navins Renew Queue screen (§5.5) before they were ever built — this paragraph describes an MVP-era design intent that never shipped, not current behavior.

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
  - **Renewal dates are synthetically spread across a 2-3 month window (decision confirmed 2026-07-15).** All four real source files, as of this build, have `renewalDate` exclusively in a single month (October 2026), which is not representative of the real rolling 2-3-month window and would make the month picker (§5.2 — a dropdown today, a tab bar when this decision was made) show only one populated entry. The anonymization script fabricates a plausible multi-month spread on top of the real dates for demo purposes, deterministically. Disclosed via the demo banner (§9), not per-field tagging.
- The anonymized output (`/data/seed/`) **is** committed to the repo and is what the deployed Vercel build uses. This is the only dataset that should ever reach the public link.
- If more real country files arrive later, re-run the anonymization script — don't hand-edit the seed data.
- A lightweight **validation check** should run as part of (or immediately after) the anonymization script: confirm flag/routing/attention distributions match the real data exactly, and grep the output for any real company/broker names that might have leaked through a bug — a manual eyeball isn't a reliable enough check given what's at stake here. **This now exists as `scripts/validate-seed-data.ts` (`npm run validate-seed`), added 2026-07-15** — it re-parses the real source XLSX files directly, compares row counts / routing distribution / attention distribution against the current `data/seed/*.json` per country, and cross-references customer names, broker names, customer identifiers, and policy numbers from the real files against the anonymized `all.json` for leaks. Exits non-zero on any mismatch or leak. **Run this after every re-anonymization** (new country files, script changes, re-generation) — don't rely on a one-time manual check like the earlier ad hoc pass that motivated writing this script.

**The real-data path this section describes as env-driven is hardcoded in source instead, in five committed scripts (verified 2026-09-09) — contradicts the mechanism described above, though not the outcome (the real files are still outside the repo and the path is still absolute).** None of the five reads `REAL_DATA_DIR` from the environment:
- `scripts/anonymize-seed-data.ts` — `const realDataDir = 'C:/Users/shane.odonoghue/Documents/riskpoint-real-data'`
- `scripts/validate-seed-data.ts` — the identical hardcoded path
- `scripts/inspect-workbook.js`, `scripts/inspect-workbook.cjs`, `scripts/inspect-workbook.mjs` — three near-duplicate ad hoc scripts, each hardcoding the same path **plus the specific real source filename** directly in the string: `'C:/Users/shane.odonoghue/Documents/riskpoint-real-data/20260709_DK_RenewalsScreening_004.xlsx'`

This is not drift from a working mechanism — `git log` shows all five files unchanged since the initial commit, so `REAL_DATA_DIR` as an actual input to any script was written into this document as intent and never implemented, at any point. See §10 for the same gap in the documented environment-variable contract. **Not fixed as part of this documentation pass** — Shane is handling it separately; this section now states what the scripts actually do, not what was originally specified.

### 8.1 The synthesis layer (added 2026-07-24, not previously documented here)

**A second, later data-generation pass exists on top of the anonymization output above, and it does not flow through `/data/seed/` the way that output does.** Two fixes, both against the *live database* rather than the committed seed files:

1. **Uneven policy counts + per-company VAT unification** (`e3a0c2a`, `scripts/lib/synthesizePlan.ts`, run via `synthesize-data.ts` (`local.db`) / `dry-run-synthesize-turso.ts` / `apply-synthesize-turso.ts` (production Turso)). Adds a deterministic-but-randomized number of extra policies per country per existing month (so monthly counts stop being suspiciously identical), sampled from each country's own existing flag/attention/routing distribution, with ids continuing that country's existing numbering per source-system scheme (§3.1). Also unifies `customerIdentifier` (VAT number) so every policy sharing a `(country, customerName)` pair gets the same VAT, correcting policies that previously had different VAT numbers for the same company.
2. **Routing-rule violation correction** (`4981def`, `4186739`, `scripts/lib/fixRoutingPlan.ts`, run via `fix-routing.ts` (`local.db`) / `dry-run-fix-routing-turso.ts` / `apply-fix-routing-turso.ts` (production Turso)). Corrects `policies.routing` on rows where source-system + any-flag-fired (§3.1) disagreed with the stored value — a bug in the first version of the generator above, not a defect in the original real-derived data (§3.1's exhaustive-check note applies to the 337 original rows, which were never wrong).

Both fixes were applied to **both** `local.db` and production Turso, each via a dry-run (read-only, computes and prints a plan) then a separate apply script (writes exactly that plan) — the same discipline (and largely the same script pair naming) as the Phase 2A status-workflow migration (§6.4). This dry-run/apply pattern is now the established convention for any script that mutates seeded/synthesized data (formalized afterward in `AGENTS.md`).

**This changed the dataset's size and shape: 337 → 403 policies** (verified 2026-09-09 against both `local.db` and production Turso, which hold identical data: DK 150, NO 139, SE 102, FI 12 — up from DK 129, NO 114, SE 88, FI 6). Every figure elsewhere in this document that cites "337," "129 rows," or per-country counts from the original anonymization predates this pass and now describes neither `local.db` nor production.

**Finding, found while verifying this section (2026-09-09, corrected 2026-09-09 — the first pass at this overstated it): `/data/seed/` (`all.json`, `dk.json`, `no.json`, `se.json`, `fi.json`, `init.sql`) was never regenerated and still holds exactly the original 337-row dataset** — `git log` shows none of these files touched since the initial commit. `scripts/seed-from-json.ts` and `scripts/apply-migration.ts` (§10) both read directly from these files.

That gap does **not** mean the repo can't reproduce the current dataset. `computeSynthesizePlan()` (`scripts/lib/synthesizePlan.ts`) is fully deterministic — every random draw is seeded from fixed string keys (`` synthesize-policies-v1:${country}:${month} ``, `` synthesize-vat-v1:${key} ``, etc.) via `mulberry32`; there is no `Math.random` anywhere in the file. Re-running the seed-load (§10) followed by today's synthesis scripts (§8.1) against a wiped `local.db` would deterministically produce 403 policies with the same statistical shape every time — that part is genuinely reproducible.

**What's actually true, verified against `git log -p` on `scripts/lib/synthesizePlan.ts`: the generator that would run today is not the one that produced the 66 rows currently live.** `4186739` (still 2026-07-24, after `e3a0c2a` had already inserted those 66 rows against the *old* generator) rewrote `synthesizePlan.ts` to sample source system first, derive ids from it, and exclude previously-synthesized rows from the proportion it samples from (`detectPreviouslySynthesizedRpxIds`, added in that same commit) — none of which existed when the live rows were generated. Re-running the current generator from a wiped `local.db` would still land on 403 policies with matching distributions, but **the specific policy ids, VAT numbers, and field values it produces would not match what's currently in `local.db` or production** — a different generator, run the same way, does not reproduce the same rows. **The 66 synthesized rows' exact identities exist only in `local.db` and production Turso.** There is no script in this repo that reconstructs them (the seed files don't have them, and the current generator wouldn't recreate the same ones), and no retained snapshot of the pre-`4186739` generator's output. This is stated as a fact about the current build's history, not a recommendation to change anything — that's a decision for Shane, not something to fix silently in a documentation pass.

## 9. Technical architecture

- **Framework:** Next.js 13 (App Router, React + TypeScript), single app.
- **API layer:** Next.js API routes, named/shaped sensibly around the data model in §7. As actually built (verified 2026-09-09): `/api/policies`, `/api/policies/[id]`, `/api/policies/[id]/status`, `/api/policies/[id]/comments`, `/api/policies/[id]/activity`, `/api/team` (now Renewal Management's single unified-list feed — every routing and every status, not just Manual Review + Navins Renew + Auto-Renew, §5.3), `/api/session`, `/api/identities`, `/api/users`. **`/api/history` no longer exists** — deleted 2026-07-24 (`9036df2`) in the same pass that removed the Closed Items screen (§5.3a); nothing calls it, since Renewal Management's Status filter reads from `/api/team` like everything else now. No `/api/navins-queue/*` routes exist or were ever needed — bulk actions were descoped before the standalone Navins Renew Queue screen was ever built (§5.5/§7.4). **Do not design speculative abstraction for a hypothetical future backend integration** — there's no known real API contract to mirror (see the open item in §12), so building an adapter/plugin layer for it now would be guessing at a shape that doesn't exist.
- **Persistence:** Turso (libSQL/SQLite-compatible, serverless-friendly) rather than a local SQLite file. This is a firm decision, not a hedge: the MVP is explicitly meant to demo shared, multi-user state (one underwriter's assignment/comment/status change visible to another, across sessions and browsers) — a plain file-based SQLite DB won't reliably persist writes on Vercel's serverless functions (ephemeral filesystem), and client-only state (localStorage) can't be shared across browsers at all. Turso gives the same SQL/schema simplicity locally and once deployed.
- **Data access:** Drizzle ORM (not Prisma) — lighter weight, good TypeScript inference, and a natural fit for libSQL/Turso. **Correction (2026-07-22): there is no `drizzle-kit`/migrations tooling in this project** — the schema (`lib/db/schema.ts`) is hand-written, `reviewStates.status` is a plain `text` column with no CHECK constraint (legality enforced in the API layer, §7.2), and there's no `/drizzle` migrations folder. Phase 2A's status-workflow changeover was a data migration (a one-off script updating existing rows and writing `status_migration` activity entries, §6.4/§7.4), not a schema migration — there was no schema change to make. If real DDL migrations become necessary later, that's new infrastructure to add, not something already in place.
- **Session:** a signed httpOnly cookie set by the identity picker (§4), carrying user ID and country, checked server-side on every API route. No passwords, no identity provider — just enough to make the country boundary and "who did what" actually real rather than UI-only.
- **Styling:** Tailwind CSS, hand-rolled components. **Correction (2026-07-22): shadcn/ui was never actually adopted** — there's no shadcn/Radix dependency in `package.json`; tables, badges, tabs, dropdowns, and the slide-out panel are all plain Tailwind-styled JSX, not shadcn primitives. Corner rounding was tightened app-wide in the same pass that added the Verified pill (`rounded-2xl`→`rounded-lg`, `rounded-xl`→`rounded-md`) to reclaim visual density. **2026-07-23 (`c9ab71b`, `666b991`, `80682d7`): a deliberate, requested brand-alignment pass** replaced Inter with Montserrat (`next/font/google`, `tailwind.config.cjs`) and added two named colors sampled from rpgroup.com — `putty` (page background, blended toward white so it reads as a tint rather than a wash) and a `sage` scale (small-footprint accents: the best-grade Risk Quality tint, a 1px header divider). This was a requested round to align this workbench (and another) to the real brand, not an exploratory pass — treat it as settled direction, not a draft.
- **Branding:** **rewritten 2026-09-09 — the claim below was already wrong by the time of the 2026-07-22 update that wrote it, and is now the opposite of current reality.** The app renders the actual RiskPoint logo (`public/logo.png`, via `next/image`, `app/layout.tsx`) in the header, added in the same 2026-07-23 brand-alignment pass as the Montserrat/putty/sage changes above — there is no "no brand kit was found" situation, and there is no plain-text wordmark in the header at all. The **fictional placeholder branding** this section used to describe (a pinwheel mark + "riskwatch"/"rw underwriting" text lockups) was real at one point in the app's history — `components/BrandingStrip.tsx`, present from the initial commit — but was deleted 2026-07-22 (`bc58b7e`), before the real logo replaced it 2026-07-23. It's recoverable from git history if ever needed, but does not exist in the current app; this document's prose is now the only place it's described as if current.
- **Demo disclosure:** one persistent, unobtrusive "this is a demo application — data and figures are illustrative" banner (a slim strip in the app footer, `app/layout.tsx`), rather than tagging individual synthesized fields throughout the UI. Covers the synthesized D&B evidence figures (§7.1) and the anonymized identities in one place, without cluttering the review screens.
- **Deployment:** Vercel, using the seed dataset (§8) as loaded into Turso — **not** "either the seed or real data via `DATA_SOURCE=seed|real`" as earlier drafts of this document say. `DATA_SOURCE` is not read anywhere in this codebase (verified 2026-09-09, `grep` across every `.ts`/`.tsx` file) — see §10 for the same gap stated as part of this document's environment-variable contract. The actual switch between "seed" and "real" data has always been which `TURSO_DATABASE_URL` a script or the running app is pointed at (§10), not an env var read by application code.

---

## 10. Environment, tooling & setup

Covers the details a developer needs to actually start building, rather than guess.

**Runtime:** Node.js 20.x (pinned, not just "LTS" — that drifts), npm as the package manager (no strong reason to prefer pnpm/yarn here — pick npm for the fewest moving parts). Scaffold with `create-next-app` (TypeScript, App Router, Tailwind).

**Turso: local dev needs no account at all.** libSQL (what Turso is built on) can point at a plain local file — `TURSO_DATABASE_URL=file:./local.db` — with zero signup, zero token, works immediately after `npm install`. A **real Turso cloud database and auth token is only needed for the Vercel deployment**, and that's a step for Shane to do himself (create a free Turso account, provision a database, put the URL/token into Vercel's environment settings) — not something an agent can provision on his behalf. Don't treat "no Turso credentials available" as a blocker for local development; it isn't one.

**Environment variables** (`.env.local` for dev, configured in Vercel for deployment):
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — the intended local-dev setup is `file:./local.db` and unset/empty, with real cloud values only in Vercel's environment settings. **As of 2026-09-09, this repo's actual `.env.local` does not follow that — it holds the real production Turso URL/token**, so `npm run dev` reads and writes the real production database by default, with no visual indicator that it's doing so. This is the exact risk `AGENTS.md`'s "Production data" section warns about, stated here as a fact about the current working setup rather than repeated guidance — see that file for how to work around it (pass `TURSO_DATABASE_URL=file:./local.db` explicitly to override).
- `REAL_DATA_DIR` — **not read anywhere in this codebase** (verified 2026-09-09; see §8's hardcoded-path finding). It appears in this document and in a `.gitignore` comment, unchanged since the initial commit in both places, but never in any script. Documented here as intent that was never implemented, not as a working mechanism — don't write code that assumes it does anything.
- `DATA_SOURCE` — **likewise not read anywhere in this codebase** (verified 2026-09-09, `grep` across every `.ts`/`.tsx` file, none). Same status as `REAL_DATA_DIR` immediately above: intent recorded in this document, never implemented. `lib/db/client.ts` has always chosen its data source purely from `TURSO_DATABASE_URL` — whatever that variable points to (a local file, or a real Turso database, seed or production) is what the app reads, with no separate `seed`/`real` switch in application code.

**Historical build documentation below (folder structure, build order, checkpoints) — the app described by this section was built once, is now fully built and deployed, and these are no longer forward-looking instructions.** Kept for reference/provenance, same convention as §6.4. Not updated to match the app's current structure (that's §5/§9's job); where it references `REAL_DATA_DIR` as if functional, that claim is corrected in place below rather than left to contradict §8's finding a few sections up.

**Suggested folder structure** (as originally proposed; not a current map of the repo — see the file lists in §8/§9 for that):
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

**Suggested build order** (as originally proposed; the app has long since passed this sequence):

1. Scaffold the Next.js app; confirm `npm run dev` runs with nothing else configured.
2. Define the Drizzle schema for `Policy`/`ReviewState`/`Comment`/`ActivityLogEntry`/`User` (§7); generate and run the initial migration against the local file DB.
3. Confirm all four countries' real files are present in `REAL_DATA_DIR` — **as written, this instruction doesn't work: `REAL_DATA_DIR` was never read by any script (§8, §10 above); the real path has always been hardcoded in source.** An agent following this step today would need to check the hardcoded path in `scripts/anonymize-seed-data.ts` instead, or ask Shane.
4. Write the anonymization script (§8); produce `/data/seed` and run its validation check (flag/routing/attention distributions match, no real names/brokers leaked).
5. Write and run the seed-loading script — commit `/data/seed`.
6. Build the identity/session layer (§4): the "Acting as" picker, the signed cookie, server-side country-boundary enforcement on every route.
7. Build the API routes (§9) over the seeded data.
8. Build the screens in this order: My Queue → Team View + month-tab bar → Manual Review Detail → Auto-Renew Log. *(A standalone Navins Renew Queue screen, incl. bulk actions, was originally built at this point too — removed 2026-07-15 as redundant once My Queue and Team View's Navins Renew tab both covered the same ground; see §5.5. All of these screens were later consolidated into one, 2026-07-24 — see §5.3.)*
9. Add the demo-application banner and the placeholder branding pass. *(The placeholder branding was itself later replaced by the real RiskPoint logo, 2026-07-23 — see §9.)*
10. **Self-verify against every item in §11 before calling this done** — walk the checklist directly (including the two-browser-session test), don't treat "the code compiles" as equivalent to "the acceptance criteria pass."
11. Deploy to Vercel against the seed dataset; confirm no `REAL_DATA_DIR`/real-data env vars are set in Vercel's environment. (Still sound advice as a checklist item, independent of whether the app ever reads that variable.)

**Human-in-the-loop checkpoints — read this before starting, not just when you hit these steps.** Two of the steps above (3 and 11) depend on Shane doing something only he can do — an account login, or providing files only he has. Don't stall silently waiting for these, and don't try to work around them. Stop, explain plainly what's needed and why, and wait for confirmation before continuing.

- **At step 3 (data files):** check for all four country files. **Not via `REAL_DATA_DIR`** — that variable does nothing (see above) — check the hardcoded path in `scripts/anonymize-seed-data.ts`, or ask Shane directly. If any are missing, tell Shane exactly which ones and stop there — don't proceed with partial data, and don't synthesize the missing countries (a deliberate decision, confirmed 2026-07-13, not an oversight to route around — though moot in practice today, since all four countries' data has long since arrived, §8.1).
- **At step 11 (deployment):** this is the point where Shane needs to do things no agent can do for him — prove his own identity to Vercel and Turso. Walk him through it one step at a time, in plain language, confirming each is done before moving to the next, rather than dumping the whole list at once and assuming it happened:
  1. "Do you have a Vercel account? If not, go to vercel.com and sign up — GitHub login is easiest, and it'll let Vercel deploy straight from your repo." Wait for confirmation.
  2. "Do you have a Turso account? If not, run `turso auth login` in your terminal — it'll open a browser for you to log in. Let me know once you're logged in." Wait for confirmation.
  3. "Now run `turso db create renewal-screening-workbench` (or similar) to create a database." Wait for confirmation.
  4. "Run `turso db show <name> --url` and `turso db tokens create <name>` — you'll get a URL and a token. Don't paste those into our chat; go straight to Vercel's project settings → Environment Variables and add them there as `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`." This is the one point worth being explicit about: the secret shouldn't land in the conversation with the agent at all, only in Vercel's own settings screen.
  5. "Push the repo to GitHub, then import it in Vercel's dashboard (or run `vercel` locally and log in when prompted)." Confirm the deploy succeeds before considering this milestone done.

## 11. Acceptance criteria (Definition of Done for MVP)

**Validity pass, 2026-09-09.** Each criterion below is tagged **VALID** (still true, still checkable, as written or with only a name substituted), **SUPERSEDED** (the capability it was checking for still exists, but the screen/mechanism it names doesn't — the criterion needs rewriting, not just renaming, to be checkable again), or **INVALID** (the specific thing it asserts is now false — checking it today would fail). This replaces the 2026-07-22 note, which only updated names and asserted "the underlying criteria still hold" without checking each one individually against the consolidated app.

- [ ] **VALID.** A user can pick a mocked identity (name + country) and see only that country's data thereafter.
- [ ] **SUPERSEDED.** ~~Assignment & Management (the landing page, §5.3) defaults its "Assigned to" filter to the acting-as user on load, showing their own Manual Review + Navins Renew items — across both tabs, still scoped to the current month...~~ The "Assigned to" defaults-to-self behavior is still true (§5.3), but there are no tabs to be "across" anymore (routing is a filter, not a tab, §5.3), and the page defaults to month **"All,"** not "scoped to the current month" (§5.2). Rewrite as: Renewal Management's "Assigned to" filter defaults to the acting-as user on load, showing their Manual Review and Navins Renew items (RPUX Auto Renew has no assignment concept) across the full "All" month view, without extra filter clicks.
- [ ] **SUPERSEDED.** ~~Assignment & Management shows the full country list for both queues, with working filters...~~ "Both queues" no longer describes it — the list now includes RPUX Auto Renew too (three routings, not two), and gained a Routing filter that didn't exist when this was written (§5.3). The filters named (attention, status, assigned-to, broker, flag type) and sort all still work, now globally rather than per-tab. Rewrite as: Renewal Management shows the full country list across all three routings, with working filters (routing, status, attention, assigned-to, broker, flag type) and sort.
- [ ] **INVALID.** ~~Assignment & Management and Auto-Renew Log both use the month-tab bar (§5.2), with accurate counts per tab... the two pages now have different defaults...~~ Checking this today fails outright: there is one page, not two (§5.3); the tab bar was deleted and replaced with a dropdown (§5.2); there is one default ("All"), not two diverging ones. The underlying capability (month filtering, URL-reflected, bookmarkable) does still exist — just not in any form this criterion, as written, could pass against.
- [ ] **VALID.** A user can self-assign an unassigned item and reassign an assigned one.
- [ ] **VALID**, name only. The panel (now "Risk Assessment," §5.4, not "Risk Quality & Recommendation") shows the full flag/evidence breakdown (now headed "Operational Review Flags"/"Company & Financial Flags," `Is Frame` shown informationally as a plain row) matching the source data exactly. The 2026-07-22 note about the removed Derived section still holds. Substance intact; only the panel/section names are outdated.
- [ ] **INVALID** on one clause, valid otherwise. A user can move a Manual Review item through its full status workflow (§6.1) via the inline Underwriter Workspace (§5.4b) and see the change reflected immediately in Renewal Management (both under its default self-filtered view and after switching "Assigned to" to "All") — this part is still true. **"…including disappearing into Closed Items on reaching a terminal status" is now false and would fail if checked as written:** the item does not disappear anywhere; it stays in the same table, now selectable via the Status filter's "Closed" bucket (§5.3, §5.3a, §6.3). Rewrite the terminal-status clause before using this as a test.
- [ ] **VALID**, with the same caveat as immediately above ("the same way" inherits the terminal-status wording problem). A user can move a Navins Renew item through its full status workflow (§6.2), including reaching any of its three terminal states.
- [ ] **VALID.** A user can add multiple comments to a policy (Manual Review or Navins Renew) via the Underwriter Workspace, each showing author and timestamp, in chronological order.
- [ ] **VALID.** The Activity Log on a policy accurately reflects every status change, assignment change, and comment in order.
- ~~[ ] Navins Renew Queue supports bulk-assign and bulk-mark-done across multiple selected rows.~~ **Removed 2026-07-15**, still correctly removed — the standalone Navins Renew Queue screen was descoped (§5.5); bulk actions went with it. Navins Renew items are actioned one row at a time via Renewal Management's inline Underwriter Workspace (§5.4b) — page name updated 2026-09-09, no change to the underlying removal.
- [ ] **SUPERSEDED.** ~~Auto-Renew (RPUX) Log is browsable, filterable, and read-only, with expandable rows showing what was checked and cleared.~~ The screen this names doesn't exist (§5.6). The capability does: select `RPUX Auto Renew` in Renewal Management's Routing filter (§5.3) and the same read-only expandable flag breakdown is there. Rewrite around the filter, not a screen.
- [ ] **VALID.** All changes persist across a page reload (not just in-memory client state).
- [ ] **VALID.** The app is deployed to a public Vercel URL running against anonymized (and, since 2026-07-24, additionally synthesized — §8.1) seed data only; no real customer data is present in the deployed build or the committed repo.
- [ ] **VALID.** Country-boundary enforcement is verified server-side, not just in the UI: attempting to fetch another country's data via the API directly (not through the app's own UI) is rejected based on the session cookie, not the request parameters.
- [ ] **VALID.** Two different browser sessions (simulating two underwriters, e.g. two incognito windows each with a different "Acting as" identity) both see the same assignment/status/comment changes on a shared policy **after a reload** — proving persistence is real and shared, not per-browser. This does not require live/real-time sync (explicitly out of scope per §1) — a manual refresh showing the other session's change is sufficient.
- [ ] **VALID**, with a scope caveat found during this pass. A single persistent "demo application" banner is present app-wide (footer, §9), and the anonymization validation check (`scripts/validate-seed-data.ts`, §8) confirms no real names/brokers leaked into the *original 337-row anonymized* seed data. **It does not check the 66 rows added by the 2026-07-24 synthesis pass** (§8.1) — those are synthesized from the anonymized data's own distributions rather than derived from the real files, so the same leak risk doesn't obviously apply, but the validation script's coverage was never extended to confirm that for itself. Noted here as a gap, not fixed.

---

## 12. Open items / assumptions to confirm before or during the build

- Only the Denmark file (`20260709_DK_RenewalsScreening_004.xlsx`, 129 rows) has been reviewed in detail as of this draft, and per the prerequisite at the top of this document, **the build should not start until Norway, Sweden, and Finland files are also provided** — this was a deliberate decision, not an oversight. The app should still be built country-generically so adding the remaining files is a data step, not a code change.
- Reassigning another underwriter's actively-in-progress item is allowed without restriction in MVP — revisit if this causes confusion in practice.
- No notifications (in-app or email) are in scope for MVP — this is a pull-based tool (users check their queue), not a push-based one.
- ~~"Escalated" has no distinct destination/owner in MVP (no senior role) — it's a visible status only.~~ **Resolved by removal, 2026-07-22:** `Escalated` no longer exists in the Manual Review workflow at all (§6.1) — it was replaced by `With Broker` as the one working, non-terminal state, and the senior-role/second-opinion question this bullet was tracking became moot rather than answered. Production rows previously at `Escalated` were migrated to `In Review` (§6.4).
- **Navins Renew's six-state graph (§6.2) is a best guess, not confirmed against Navins' real process (flagged 2026-07-22).** It models a plausible quote-to-bind flow (Not Started → Quote Sent → Quote Declined, or → Policy Sent → Renewed/Not Renewed), but hasn't been validated against how Navins actually handles a renewal end to end. If real usage surfaces a gap (e.g. a sent quote needing revision rather than only accept/decline, or a declined quote being revivable), treat that as new information to design against, not a bug in this spec.
- **Future backend integration point undecided (post-MVP):** when this graduates from static seed data to the live `catalyst-renewal-screening` backend, the integration could either parse the backend's rendered Excel output (no backend changes, but fragile — coupling to a human-facing render format) or have the backend expose a JSON API for scored policies (cleaner, but requires backend work). Not a blocker for this MVP either way; flagging so it isn't forgotten.
