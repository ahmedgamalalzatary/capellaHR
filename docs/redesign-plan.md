# Capella UI/UX Redesign — Plan

Status: **Approved 2026-10-14 — in progress (Phase 2 built; waiting for the owner's font pick and sign-off).** Decisions: all §9 [API] items approved (D3); weekly-day-off stays a separate page (D2).
Scope: `packages/ui`, `apps/pos` (every route), `apps/web` (every route), plus the small API/contract changes the fixes need.
Product truth: `PRODUCT.md`. Locked functional rules: `docs/hr-specs.md` (Global interface requirements) and `docs/erp-plan.md`.

---

## 1. Why

The UI audit (2026-10-14) found three problem families:

1. **Inconsistency.** The same job is built differently on each page:
   - Search works three ways: live with no delay, a submit button, or an Apply button.
   - There are five filter layouts. Only 2 pages have a reset action, which `docs/hr-specs.md` requires on every admin list.
   - There are two delete-confirmation styles and three page-header styles.
   - Success feedback appears twice (banner and toast); errors appear up to three times.
   - Some lists are tables and some are cards.
   - Empty messages say "no data yet" when a filter finds nothing.
2. **Missing information.**
   - Money lists don't show totals.
   - Long dropdowns can't be searched.
   - Almost nothing can be sorted.
   - Locks (approved payroll months) are discovered only through errors.
   - Filters aren't saved in the URL, so dashboard links can't open a filtered view.
3. **Visual.** The current "Ledger" look is monochrome black-on-white with no brand presence. Mobile is an afterthought: wide tables scroll sideways and touch targets are 32–36px. The owner uses the system on a phone.

Plus 6 confirmed bugs (§5, Phase 1).

## 2. Goals and non-goals

**Goals**
- A new visual identity built from the Capella logo (espresso + rose-gold/champagne). It's shared by both apps through one token file.
- One shared set of components for every list page:
  - search with a 500 ms delay
  - a filter bar with active-filter count and reset
  - a responsive data list (table on wide screens, stacked rows on phones)
  - one pager
  - one set of empty, loading and error states
  - one confirmation dialog and one feedback rule
- Every page fully usable from 360px phones to 1440px+ desktops.
- Fix every confirmed bug and every page-level gap listed in §7.

**Non-goals**
- No change to business rules, permissions, validation or workflows.
- No new modules.
- Backend changes only where a fix truly needs one; each is marked **[API]** and listed in §9.
- No dark theme in this plan. The tokens are built so dark mode can be added later (§10).

## 3. Ground rules for every slice

- AGENTS.md workflow:
  - Before touching an area, confirm it is green (lint, typecheck, tests, build).
  - Work test-first (TDD).
  - After each slice, confirm the touched area is green.
  - After each phase, confirm the whole repo is green.
- **Keep accessible names stable.** Unit tests (`apps/pos` 87, `apps/web` 50, `packages/ui` 4) and Playwright e2e (`apps/pos/tests/e2e`, 18 specs) find elements by role, label and Arabic text. Restyling must not rename labels unless the slice says so. Where a label changes on purpose, update its tests in the same slice.
- **Every slice ships with:**
  - green targeted checks
  - before/after screenshots at 390px and 1440px
  - the affected e2e spec updated
- **Print layouts are protected:** the 80mm receipt, A4 reports, payroll statement, transfer sheet and product labels. Each slice that touches a printed screen re-checks print preview.
- **No per-page styling.** Pages compose shared components. A visual need a shared component can't cover goes into `packages/ui` first.

## 4. Phase overview

```
Phase 0  Groundwork        baseline green, visual baseline, direction decision
Phase 1  Bug fixes         the 6 confirmed bugs (+ small API changes)
Phase 2  Design system     tokens, primitives, list toolkit, shells   <- the big unlock
Phase 3  POS migration     every POS page onto the system + its gaps
Phase 4  Web migration     every web page onto the system + its gaps
Phase 5  Finish            responsive/a11y/print/e2e sweep, independent review, DESIGN.md
```

Phase 1 doesn't depend on Phase 2 and can ship first. Phases 3 and 4 depend on Phase 2. Inside 3 and 4, slices are independent and ordered by daily use.

### 4.1 Ownership and order (agreed with the owner, 2026-10-14)

The owner trusts only Claude (this session's agent) with the base design and the reference pages. Everything else is delegated to other AI agents, which follow `docs/redesign-migration-guide.md`.

**Claude owns:**
- All of Phase 2 (design system).
- Reference pages: 3.1 (cashier home + shifts), 3.4 (invoices + detail), 3.2 (sale screen: most used, handles money), 4.6 (bonuses/deductions/advances, web reference).
- The migration guide for other AIs.
- The data-shape spec for every [API] item that feeds a component (e.g. `meta.totals` for `TotalsBar`).
- Review of every delegated slice before it counts as done; Phase 5 final review verdict + DESIGN.md.

**Delegated:** 3.3, 3.5–3.18, 4.1–4.5, 4.7–4.12, all [API] items (can start now, in parallel), and the Phase 5 checks (responsive, a11y, print, e2e).

**Order:**
```
1. Phase 2  design system -> owner picks fonts on /_design -> owner sign-off
2. 3.1      cashier home + shifts   (board, AppShell, cashier bottom tabs)
3. 3.4      invoices + detail       (canonical list page)
4. Guide    v1                      -> delegates start POS list pages + [API] items
5. 3.2      sale screen
6. 4.6      adjustments             -> guide gets its web section -> delegates start web
7. Ongoing  review delegated slices -> Phase 5 final review + DESIGN.md
```
[API] items aren't a phase: each is needed by a specific page in Phase 3 or 4.

### 4.2 Migration guide outline (`docs/redesign-migration-guide.md`, written at step 4)
- **Part A, rules for every slice:** read the matching reference page first (3.1 / 3.4 / 4.6); only `@capella/ui` components (a missing component is reported, not built ad hoc); list anatomy `PageHeader -> StatGrid (figures link to rows) -> FilterBar -> DataList -> TotalsBar -> Pagination`; 500 ms search, no search button, filters in URL via `useListState`; shared formatters only (no raw ISO); feedback rule (toast on success, inline form errors, page banner only when blocked); dialogs can't close while saving; keep accessible names stable; protect print layouts. **Done =** tests first and passing, lint/typecheck/build green, 390 + 1440 screenshots, e2e checked with the Playwright plugin, progress log updated, never commit.
- **Part B, one instruction block per delegated slice:** the gaps from the §8 tables, plus: 3.3 and 3.7 render as live boards; 3.11 replaces the 683-option product filter (from 1.7) with a `Combobox`; 3.17 reuses the board from 3.1. Each [API] item states its exact response shape; contract change first, then API, test-first.
- **Part C, reference:** component catalogue (with `/_design`), colour meanings (amber late, brick cancelled…), forbidden list, how to report a missing component.

---

## 5. Phase 0 — Groundwork

| Slice | Work | Done when |
|---|---|---|
| 0.1 Baseline | Run lint, typecheck, test and build for `packages/ui`, `apps/pos` and `apps/web`, plus the POS e2e suite. Record failures that already exist. | Results written in this file's log (§11); pre-existing reds reported to the owner before any change. |
| 0.2 Visual baseline | Screenshot every route at 390px and 1440px (admin and cashier roles where they differ). Save to `.impeccable/review/before/`. | Before-set exists for comparison. |
| 0.3 Direction round | Run the design-direction step (impeccable `new-work`, Operate mode). Present a committed visual direction built from the logo, plus alternatives, for the owner to choose. Record the chosen direction as a direction contract in the surface brief. | Owner picked a direction; contract recorded. |

---

## 6. Phase 1 — Confirmed bugs

Each slice: write a failing test first, then fix.

| Slice | Bug | Fix | Layer |
|---|---|---|---|
| 1.1 | **Refunds page.** The shared filter lets you pick "مستردة"/"ملغاة". The page then hides non-refundable rows itself, so pages come out empty or short while the pager counts more. | **[API]** Add `refundable=true` to the invoice list query (contracts + API): only `completed`/`partially_refunded` with a refundable balance. The refunds page sends it and hides the status options that can't apply. Remove the client-side filtering. | contracts, api, pos |
| 1.2 | **Consumables.** ① Ticking one service opens the save dialog at once, so several can't be ticked, although the dialog says matching services can be grouped. ② Load errors show "لا توجد خدمات". | ① Ticking only builds a selection. A sticky selection bar ("N محددة — تسجيل المستهلكات") opens the dialog. ② Show real error states with a retry button for the services, balances and options queries. | pos |
| 1.3 | **Bonuses / deductions / advances.** Edit and delete show on months whose payroll is already approved; the user learns only from an error. | **[API]** Add `editable: boolean` (with a reason) to each record in the list response. The UI hides edit/delete on locked rows and shows a "معتمد — مقفل" badge. | contracts, api, web |
| 1.4 | **POS reports.** The branch picker writes the shared admin branch at once, but the report keeps showing the old branch until "تطبيق". | Superseded by the shared filter bar (Phase 2.5): filters apply live with a delay; the Apply button is removed. Interim fix in Phase 1: the picker holds a local draft and writes the shared branch only on Apply. | pos |
| 1.5 | **Transfers.** The new-transfer form can be closed while saving. | Block close (✕, backdrop, Esc, cancel) while the mutation is pending. Same guard audited in every modal form. | pos |
| 1.6 | **Branch lists.** Invoices, refunds, products and suppliers load only the first 100 branches. | Use `fetchAllPages` everywhere. In Phase 2 this becomes one shared `useBranchOptions()` hook. | pos |
| 1.7 | **Transfers history product filter.** Admins got an empty list: the page asked for products without a branch and the server refused (`ERP_BRANCH_REQUIRED`). | Load each branch's products and label options "name — branch" (product ids are per branch). Cashiers keep their own branch. | pos |
| 1.8 | **Transfer invoices offered refund/void.** Eligibility ignored the invoice kind, so a branch-transfer invoice showed buttons the server always refuses. | `canRefund` / `canVoid` require `kind = 'sale'`. | api |

Also fixed in Phase 1 (small, unintended):

- Self-service payroll and commission: auto-load the pre-filled current month.
- Add browser-tab titles to POS bookings, expenses, fixed assets, invoices, invoice detail, products, refunds and suppliers.
- Clear the persistent error on bookings when the next action succeeds.
- Format the raw ISO `createdAt` in transfer details.

**Gate:** whole repo green and the POS e2e suite green.

---

## 7. Phase 2 — Design system (`packages/ui`)

This phase removes most of the inconsistency in one place. Nothing visual is built per page.

### 2.1 Tokens and visual identity
- Move the tokens out of the two duplicated `globals.css` files into one `packages/ui/src/styles/tokens.css`, imported by both apps. Remove the per-app copies.
- **Chosen direction (0.3): Service Departure Board.** Live data (today's bookings, service queue, open shift drawer, who is checked in, dashboard "now" numbers) sits on an espresso board band. Rows rank by time, and states change in place with a flap animation on only the changed cells; it's instant when the user turns motion off. Everything else is a calm ivory work surface. Every list page has the same anatomy: a board strip of key figures (each linked to its rows), then the filter bar, then the data list. Full contract: `apps/pos/.impeccable/surfaces/apps-pos.md`.
- Board palette: flap cells `#1E1A19` on board `#2A2321`, champagne figures `#E9D3B8`, amber `#D9A441` for late/overdue, brick `#9E3A2E` for cancelled/failed. Work surface: ivory `#F6F1EA` with white panels. Fonts: a condensed Arabic face for board rows and headings plus a regular body face, confirmed on `/_design`.
- **Starting palette from the logo** (kept under the chosen direction, checked for WCAG AA):
  - **Espresso** (logo ground, ~`#2A2321`): app chrome (sidebar, top bar on mobile), primary actions, strong text.
  - **Champagne / rose-gold** (logo face, ~`#D4A98A`, darker shade for text use): brand accent. Used for active nav, focus ring, selected states and key figures. Never for body text on white unless the shade passes contrast.
  - **Warm neutrals** tinted toward the espresso: page ground, surfaces, lines, muted text. These replace the cold zinc greys.
  - **Status colours** (success, warning, danger, info) re-tuned to sit with the warm palette and kept strictly for meaning.
- Type: keep an Arabic workhorse UI face. The 0.3 round confirms IBM Plex Sans Arabic or replaces it. Define one type scale, tabular figures for all money, codes and dates, and a weight system.
- Spacing scale, radius, elevation, motion durations and easing, focus ring, z-index layers.
- **Touch sizing:** controls 44px tall on touch layouts (`pointer: coarse`), 36–40px on desktop.

### 2.2 Primitives (rebuilt or added)
`Button` (adds `icon` and `touch` sizes), `IconButton`, `Input`, `Select` (moved from POS into `ui`), `Textarea`, `Checkbox`, `Switch`, `Field`, `Badge`, `StatusBadge` (one map per domain status, no hand-made coloured spans), `Card`, `Tabs` (one implementation, RTL arrow keys), `Modal`, `ConfirmDialog`, `Notice`, `Skeleton`, `Spinner`, `Toast` styling (sonner theme), `Tooltip`, `DropdownMenu` (row overflow actions).

On phones, `Modal` becomes a **bottom sheet**: full width, sticky action footer, safe-area padding.

### 2.3 Page scaffolding
- `PageHeader`: title, short description, one primary action and optional secondary actions. On phones the primary action stays reachable as a sticky bottom button.
- `Section`, `StatGrid`/`StatTile` (KPI numbers), `Toolbar`.
- Every page in both apps uses the same `PageHeader`. Web's plain `h2` headings and the dark banner headers go away.

### 2.4 Data display
- `DataList`: one component, defined by columns.
  - `md`+ screens: a table with sticky header, optional sticky actions column, numeric alignment, totals footer.
  - Phones: each row becomes a stacked card. Each column declares its mobile role: `primary`, `secondary`, `meta`, `amount`, `status`, or `hidden`.
  - Replaces the hand-written web tables and the card-only lists (invoices, refunds, shift history, clients, bookings list mode).
- `RowActions`: up to 2 visible actions; the rest go into a `⋯` menu. Destructive actions are always last and always confirmed.
- `Pagination`: one pager. It always shows "صفحة X من Y — N {unit}", is hidden when there's only one page, and has an optional page size.
- `SortableHeader` with server sorting where the API supports it.
- Formatters: `Money`, `DateTime`, `DateOnly`, `Duration`, `Phone` (LTR-isolated). Every date is shown in Arabic Cairo format; no raw ISO anywhere.
- `TotalsBar`: sums for the current filter. Uses API totals where available, otherwise marked **[API]** per page in §8.

### 2.5 Search and filters (the core fix)
- `useDebouncedValue(value, 500)`. Search applies **500 ms after the last keystroke**, with no submit button anywhere. Enter applies immediately.
- `SearchInput`: icon, clear (✕) button, placeholder that says *what* it searches ("بحث بالاسم أو الهاتف أو الكود").
- `FilterBar`: one layout everywhere.
  - Search first, then filter controls, then "إعادة ضبط" with an active-filter count.
  - On phones: search stays visible, other filters collapse into a "تصفية (N)" button that opens a bottom sheet.
  - Active filters show as removable chips under the bar.
- Filter controls:
  - `DateRangeFilter`: validates from ≤ to and shows an inline message. Has presets (اليوم، أمس، هذا الأسبوع، هذا الشهر).
  - `MonthFilter`: one month picker for admin and self-service.
  - `Combobox`: searchable select for employees, products, suppliers and clients. Employee options narrow to the selected branch.
  - `BranchSelect`: backed by `useBranchOptions()`.
- `useListState(defaults)`: keeps search, filters, sort and page **in the URL**, so views are shareable, survive the back button, and dashboard deep links work. It resets the page on filter change and exposes `isFiltered`.
- `ListEmptyState`: if `isFiltered`, shows "لا توجد نتائج مطابقة" with a reset button; otherwise shows the first-run message and the create action. This fixes every wrong empty message at once.

### 2.6 Feedback rule (one rule, enforced in components)
- Success → toast only. Remove `SuccessState` banners.
- Form and validation errors → inline in the form.
- Action errors inside a dialog → inline in the dialog only (no toast).
- Background action errors → toast only.
- Persistent page-level `Notice` → only for conditions that block the page (no open shift, branch list failed).

### 2.7 Shells
- **One `AppShell`** used by both apps with the same breakpoint. It replaces the POS shell (`md`) and web shell (`lg`).
  - Desktop: espresso sidebar with grouped nav and Capella mark.
  - Tablet: collapsible sidebar.
  - Phone: top bar plus slide-in drawer. POS cashiers also get a **bottom tab bar** for their 4 most-used destinations (الوردية، بيع جديد، المواعيد، الفواتير).
- **POS admin branch switcher moves into the top bar**: one global control instead of a branch card on 15 pages. It's backed by the existing shared `useAdminBranch`. Pages show a single "اختر فرعًا" empty state until one is chosen.
- Shift status chip in the POS top bar: open or closed, and since when.
- Login, kiosk, personal-device and pair screens get a branded full-screen layout using the logo.

### 2.8 Tests and docs for the phase
- Unit tests in `packages/ui` for: debounce, `useListState` (URL sync), `FilterBar` (reset/count), `DataList` (responsive columns), `Pagination`, `ConfirmDialog`, `Combobox` (keyboard + RTL).
- A `/_design` preview route in the POS app (dev only) that renders every component and state, for review at 390px and 1440px.

**Gate:** whole repo green. The owner reviews the `/_design` page on phone and desktop before Phase 3 starts.

---

## 8. Phases 3 & 4 — Page migration

Each slice = move the page onto the Phase 2 components + fix its gaps from the audit + screenshots + tests.

### Phase 3 — POS (order = daily use)

| # | Page | Migration + gaps fixed |
|---|---|---|
| 3.1 | الوردية (cashier home) / ورديات الكاشير | Shift card redesigned around "المتبقي في الدرج". History becomes a `DataList` with date range, cashier and "أُغلقت تلقائيًا" filters, and totals. Shift detail gets a link to the end-of-shift report. |
| 3.2 | بيع جديد (sale workspace) | Restyle only; the workflow is unchanged. Touch sizing, mobile layout for basket, payment and employee steps, and sticky totals/checkout bar on phones. *(Needs a dedicated read of the full workspace at slice start.)* |
| 3.3 | دفتر المواعيد | Search by client name/phone. Status and employee filters. Day summary (محجوز / وصل / لم يحضر / تم البيع). Client name links to the client. Optional week strip for quick day jumping. |
| 3.4 | الفواتير + invoice detail | `DataList` with sortable columns (replaces the order-by dropdowns), reset, totals (count / total / remaining) **[API: totals]**, payment-method filter **[API]**. Detail page gets `PageHeader`, the label mismatch fixed, and a client link. |
| 3.5 | المرتجعات | Uses the `refundable` query from 1.1. **New: refunds & voids history tab** **[API: list refunds/voids]**. |
| 3.6 | العملاء | Columns: visits, last visit, total spent, balance **[API]**. **Client profile sheet**: invoices, bookings, unpaid **[API: client history endpoint or reuse report]**. Sorting. |
| 3.7 | خدمات العملاء والمستهلكات | Search (client / invoice / queue no. / employee). Status, employee and date filters. Selection bar from 1.2. Visible, removable "this shift" chip. Stock tab gets search and server sort. Auto-refresh of the live queue. |
| 3.8 | المنتجات والمخزون | Clear search placeholder. Expiry filter. Stock value total. Row actions into `⋯`. Movements get a date range, product `Combobox`, and a row link "حركات المنتج". |
| 3.9 | الكتالوج | Restyle. Category service count **[API if not present]**. Tab kept in URL. |
| 3.10 | الموردون والمشتريات | Filter-aware empty states. Purchase history gets date range, search by number, labelled filters and totals. "نتائج المخزون" folded into each purchase row's detail. Supplier total purchases **[API]**. |
| 3.11 | تحويل المنتجات | Admin from/to branch filters. Search by number. New lines append at the bottom. Formatted dates. |
| 3.12 | المصروفات | Totals for the filter, reset, formatted dates. |
| 3.13 | العمولات | Branch totals row. "Print all" for the month. Fix: money figures use `text-foreground`, a colour that does not exist (they show grey instead of dark). |
| 3.14 | التقارير | Live filters (Apply removed). Report picker becomes grouped tabs plus a searchable menu on phones. Reset. Select-all on page. |
| 3.15 | الأصول الثابتة | Condition and location filters. Total value. |
| 3.16 | حسابات الكاشير | Search, branch and status filters. Single error display. |
| 3.17 | لوحة الإدارة (admin home) | **Replace the link grid with today's KPIs per branch**: sales, open shifts, today's bookings, low stock, unpaid balance **[API: POS dashboard endpoint]**. |
| 3.18 | تسجيل الدخول | Branded layout. |

### Phase 4 — Web

| # | Page | Migration + gaps fixed |
|---|---|---|
| 4.1 | الرئيسية (dashboard) | `PageHeader` + `StatGrid`. Branch filter **[API param]**. Every "مراجعة…" link deep-links to the filtered attendance tab (`useListState` URL). |
| 4.2 | الحضور والغياب | Daily summary counts. Denied attempts show the employee name. "تسجيل يدوي" shortcut on absent rows. Recent manual entries list. Export. |
| 4.3 | الإجازة الأسبوعية | **Stays a separate page (D2, decided).** Make the attendance tab's purpose (read-only view) vs this page (editing) explicit with a cross-link. Confirmation before a payroll-affecting change (same as payroll does), reset, labelled filters. |
| 4.4 | الموظفون | Active/inactive filter. Device/face status column. Readable shift duration. **Employee profile page** (attendance, payroll, advances, adjustments, devices) **[API aggregation or reuse existing lists]**. |
| 4.5 | الرواتب | Status filter (مفتوح / معتمد / يحتاج مراجعة). Month totals **[API]**. Gross / deductions / net columns. Bulk print. Approve all branches. |
| 4.6 | المكافآت / الخصومات / السلف | Shared `AdjustmentView` migrated once (covers all three). Month total. Lock badge from 1.3. Dialog confirm. Branch-scoped employee combobox. Advances: paid / remaining instalments. |
| 4.7 | الأجهزة | Pending pairing requests list with cancel/regenerate **[API: list pending pairings]**. Branch filter. |
| 4.8 | الفروع | Employee count **[API]**. Map link. |
| 4.9 | التقارير | Filter bar + reset. Summary in the totals footer. |
| 4.10 | سجل المراجعة | "الإجراء" and "نوع الكيان" become dropdowns. Details become a readable key/value diff instead of raw JSON. |
| 4.11 | الخدمة الذاتية | Mobile-first redesign (employees use phones). Unified month picker. Date filter on attendance. |
| 4.12 | Kiosk / personal device / pair / login | Branded full-screen layouts, large touch targets, camera screen polish. |

---

## 9. Backend changes ([API]) — need owner approval

| Item | Needed by | Size |
|---|---|---|
| `refundable` filter on invoice list | 1.1 (bug) | S |
| `editable` + lock reason on bonuses / deductions / advances list items | 1.3 (bug) | S |
| Totals for the filtered result: invoices, expenses, purchases, transfers, payroll, adjustments | 3.4, 3.10–3.12, 4.5, 4.6 | M |
| Payment-method filter on invoices | 3.4 | S |
| Refunds and voids history list | 3.5 | M |
| Client stats + history | 3.6 | M |
| Supplier purchase totals, category service count, branch employee count | 3.9, 3.10, 4.8 | S |
| POS admin dashboard KPIs | 3.17 | M |
| Dashboard branch filter | 4.1 | S |
| Employee profile aggregation | 4.4 | M |
| List pending device pairings | 4.7 | S |

All items approved by the owner (2026-10-14).

---

## 10. Phase 5 — Finish

1. **Responsive sweep** at 360, 390, 768, 1024, 1280 and 1440px for every route: no sideways page scroll, nothing cut off, sticky bars clear of the phone safe area.
2. **Accessibility:**
   - AA contrast for all token pairs
   - keyboard paths through filter bar, combobox, dialogs and sheets
   - focus return after dialogs
   - screen-reader names
3. **Print check:** receipt, reports, payroll statement, transfer sheet, labels.
4. **E2E:** full POS Playwright suite plus web unit suite. Add phone-viewport e2e runs for sale, bookings and invoices.
5. **Independent finish review** (reviewer sub-agent, approved for this redesign) on the after-screenshots against the direction contract. Fix in one batch, then one more review round at most.
6. **DESIGN.md** written from the built system (documenter sub-agent) + `.impeccable/design.json`.
7. Update `docs/hr-specs.md`: the "Visual design boundary — Deferred" section points to DESIGN.md.

### Open decisions (ask before the slice that needs them)
- **D1:** Dark theme: out of this plan; tokens are ready for it. Add later?
- ~~D2~~ Decided: weekly-day-off stays separate.
- ~~D3~~ Decided: all [API] items approved.
- **D4:** Cashier bottom tab bar destinations (proposed: الوردية، بيع جديد، المواعيد، الفواتير).

---

## 11. Progress log

| Date | Phase/slice | Result |
|---|---|---|
| 2026-10-14 | Audit + plan | Written; approved (all [API] items, weekly-day-off stays separate) |
| 2026-10-14 | 0.1 Baseline | Green: lint + typecheck + build (ui, pos, web); unit tests ui 14, pos 800, web 449 pass. POS e2e: owner confirmed green, run skipped. |
| 2026-10-14 | 0.2 Visual baseline | Captured at 1440 and 390: web 15 routes (admin, protected pages unlocked), POS 17 routes (admin, first branch). Saved in `.impeccable/review/before/{web,pos}`. Cashier-role shots are taken at the start of slice 3.1. |
| 2026-10-14 | 0.3 Direction | Owner chose **Service Departure Board** (split-flap board fused with the espresso/champagne brand). Contract: `apps/pos/.impeccable/surfaces/apps-pos.md` (seed 296a2128). Phase 0 complete. |
| 2026-10-14 | 1.1 Refunds | `refundable=true` on the invoice list (contracts + API: sale invoices that are completed or partially refunded). Refunds page sends it, offers only those statuses, client-side filter removed. |
| 2026-10-14 | 1.2 Consumables | Ticking builds a selection; a sticky bar ("N محددة", إلغاء الاختيار, تسجيل المستهلكات) opens the dialog. Retryable errors for services, balances and the dialog's consumable list. New shared `LoadError` in POS `components/feedback/notice.tsx`. |
| 2026-10-14 | 1.3 Locks | Bonus / deduction / advance list items carry `editable` + `lockReason` (`payroll_finalized`, `employee_inactive`). Web hides edit/delete and shows "معتمد — مقفل" / "موظف غير نشط" / "موظف محذوف". Audit snapshots unchanged (list only). |
| 2026-10-14 | 1.4 Reports branch | Branch picker is a draft; the shared branch changes on Apply. The report now also opens on the saved branch (it used to show all branches). |
| 2026-10-14 | 1.5 Close guard | Guarded while saving: new transfer, new booking, record payment, change service employee, service status, refunds dialog. Shared `Modal` reads the latest close props at commit, so Escape can't hit a stale handler. |
| 2026-10-14 | 1.6 Branch lists | `fetchAllPages` on bookings, shift history, products, invoices, refunds, suppliers. Fixes a cache-shape clash between shift history and cashier home (same query key, different shapes). |
| 2026-10-14 | 1.x Small items | Self-service payroll/commission auto-load the current month; tab titles on 8 POS pages (+ test guarding all pages); bookings error clears on next success; transfer details show a formatted Cairo date. |
| 2026-10-14 | Phase 1 gate | Lint, typecheck, build, unit tests green (API suite green when run alone; one DB test clashes only under parallel turbo). E2E done live with the Playwright plugin (no CLI browser on this machine): refunds `refundable=true` + full pages, reports branch draft + opens on saved branch, consumables multi-select bar (bg fixed: `bg-panel` → `bg-paper`), transfer form blocks Escape/backdrop/cancel while saving, all branch pickers list every branch, tab titles present, lock flags present on bonus/deduction/advance rows. **Phase 1 complete.** |
| 2026-10-14 | 1.7 + 1.8 | Found during the live check, confirmed on the online-data copy, fixed test-first. Also: local dev DB needed `db:migrate` (missing `erp_invoice_lines.requested_batches`). |
| 2026-10-14 | Phase 1 final gate | Lint, typecheck, build green; unit tests green (ui, contracts, database, config, worker, web 50, POS 88, API 153 + runtime smoke). API database hooks given 120s (shared DB reset sometimes passed 10s on the loaded MySQL server). Verified live with the Playwright plugin, including locked rows on real finalized months. **Committed.** |
| 2026-10-14 | 2.1 Tokens | One `packages/ui/src/styles/tokens.css` for both apps (per-app copies removed). Old token names kept with warm values so unmigrated pages re-skin at once; new brand, board and status tokens, all text pairs AA-checked. Controls 40px with a mouse, 44px on touch (`--control-h`). Fonts via `src/app/fonts.ts` in each app; default pair Noto Sans Arabic (condensed for board/headings) until the owner picks. |
| 2026-10-14 | 2.2–2.6 Components | Added to `@capella/ui`: Button (loading, icon, board), IconButton, Select/Textarea (moved from POS; POS files re-export), Checkbox, Switch, Field hint, Badge tones + `StatusBadge`/`StatusMap`, Section, Tabs (RTL arrows), Modal as phone bottom sheet with sticky footer, ConfirmDialog, Notice/LoadError/FieldError, Spinner/LoadingState/Skeleton, DropdownMenu + `RowActions` (2 visible, rest in ⋯, destructive last and confirmed), PageHeader (primary action pinned on phones), Board/BoardFigure/BoardRow/`FlapText` (only changed cells flip), StatGrid/StatTile, TotalsBar, DataList (table ≥768px, cards on phones by column role, sort headers, totals footer), Pagination, formatters + Money/DateTime/DateOnly/Duration/Phone, SearchInput (500 ms), FilterBar (phone filter sheet, chips, reset count), ListEmptyState, FilterSelect/BranchSelect/DateRangeFilter (presets, from ≤ to)/MonthFilter, Combobox (Arabic-aware), `useListState` (URL), `useDebouncedValue`, `useMatchMedia`, sonner theme (`toasterProps`), `UiLinkProvider`. 74 ui tests. |
| 2026-10-14 | 2.7 Shells | Shared `AppShell` (espresso sidebar ≥1024px, icon rail 768–1023px, drawer + optional bottom tabs on phones). POS `PosShell` and web `AdminShell` now render it (old sidebar/topbar files removed; their tests still pass). POS admin branch switcher in the top bar; `useAdminBranch` is now one shared value (it used to be a separate copy per component, so a top-bar control could not reach the page). `useBranchOptions()` added. Shift chip shows "منذ". `BrandScreen` ready for login/kiosk/pair slices. Bottom tabs are wired only in the preview until D4 is decided. |
| 2026-10-14 | 2.8 Preview | `/_design` and `/_design/shell` in POS (dev only; "not found" in production). Font-pair switcher (3 pairs), live board, full list anatomy with URL filters, every component and state. Checked live at 1440, 820 and 390 with the Playwright plugin. |
| 2026-10-14 | Phase 2 gate | Lint + typecheck (ui, pos, web) green; tests ui 74, pos 836, web 453 green; builds green. API/database untouched. **Waiting:** owner picks the font pair on `/_design`, decides D4, signs off. |
