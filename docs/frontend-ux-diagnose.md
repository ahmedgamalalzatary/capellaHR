# Frontend UX-UI Full Diagnose

Date: 2026-09-15. Verified by reading code (not runtime).
Scope: `apps/web/src` (admin HR) + `apps/pos/src` (POS/ERP). All `page.tsx` are thin wrappers; real UI lives in `features/*/components/*-view.tsx`.

> Scope rule (binding for all fixes below):
> - `[SHARED/GLOBAL]` = one fix must be done in **all pages it touches**. A page is only "done" when the shared primitive is wired there (SmartPagination, notify/sonner, useAdminBranch, SortableTH/FilterBar, Dialog standard, search/sort fill). Do not close a SHARED item per-page.
> - `[SINGLE]` = fix **only in this specific part**, not related to others. Do not propagate to other pages.

---

## 1. Global problems — all `[SHARED/GLOBAL]`: fix in every page listed, not per-page close

### 1.1 [SHARED] Pagination — CONFIRMED (all pages, Prev/Next 1-by-1 only)

- Web: no shared component. Every list duplicates inline `السابق / التالي` + `setPage(current ± 1)`. No page numbers, no jump-to-page, no page-size. Hidden when `totalPages <= 1`.
- POS shared pager `apps/pos/src/components/data/pagination.tsx:15-49` is Prev/Next only (`السابق/التالي` + chevrons L38-44). Same limitation, centralized.

| Page | Implementation file + lines |
|---|---|
| web/payroll monthly | `features/payroll/components/monthly-payroll-section.tsx:338-371` (buttons L347-357, L358-368) |
| web/payroll base salaries | `features/payroll/components/base-salaries-section.tsx:214-245` (L221-243) |
| web/bonuses, deductions | `features/financial-adjustments/components/adjustment-view.tsx:548-575` (L557-572) |
| web/advances | `features/advances/components/advances-view.tsx:529-562` (L538-560) |
| web/employees | `features/employees/components/employees-view.tsx:733-759` (L741-756) |
| web/branches | `features/branches/components/branches-view.tsx:311-337` (L319-334) |
| web/attendance (3 sections) | `features/attendance/components/admin-attendance-view.tsx:83-94` local `Pagination`, reused L187, L231, L294 |
| web/shifts | `features/shifts/components/shifts-view.tsx:302-334` (L310-331) |
| web/devices | `features/devices/components/devices-view.tsx:479-505` (L487-502) |
| web/audit | `features/audit/components/audit-view.tsx:423-448` (L430-445) |
| web/reports (+exports history) | `features/reports/components/reports-view.tsx:360-387` (L369-384) + `exports-history.tsx:178-200` |
| web/weekly-day-off | `features/weekly-day-off/components/weekly-day-off-view.tsx:337-364` (L346-361) |
| web/dashboard | none (snapshot query, `refetchInterval: 60_000`, `dashboard-view.tsx:296`) |
| pos/invoices | `features/sales/components/invoice-history-view.tsx:225-237`, shown only if `totalPages>1` L223, `pageSize=20` L91 |
| pos/refunds | `features/sales/components/refunds-view.tsx:299-312`, only if `totalPages>1` L297 |
| pos/commissions | `features/commissions/components/commissions-view.tsx:200-206`, `pageSize:20` L112,119 |
| pos/clients | `features/clients/components/clients-view.tsx:217-229`, only if `totalPages>1` L216 |
| pos/suppliers (purchases history only) | `features/suppliers/components/suppliers-purchases-view.tsx:657-663`, `pageSize:20` L129; supplier list `listAllSuppliers pageSize:100` L105-110 has no pager |
| pos/products (movements only) | `features/products/components/product-stock-view.tsx:489-495`, `pageSize:20` L100; product list `listAllProducts` L102 has no pager |
| pos/expenses | `features/expenses/components/expenses-view.tsx:270-276`, `pageSize:20` L58 |
| pos/transfers (history only) | `features/stock-transfers/components/stock-transfers-view.tsx:366-377`, only if `totalPages>1` L365 |
| pos/cashier-sessions history | `features/cashier-sessions/components/shift-history-view.tsx:152-164`, only if `totalPages>1` L150 |
| pos/cashier-accounts | `features/cashier-accounts/components/cashier-accounts-view.tsx:160-172`, only if `totalPages>1` L159 |
| pos/fixed-assets | `features/fixed-assets/components/fixed-assets-view.tsx:329-335`, `pageSize:20` L88 |
| pos/reports (main + export history) | `features/erp-reports/components/erp-reports-view.tsx:468-480` + `255-261` |
| No pagination at all | pos/bookings (day diary), pos/consumables (`fetchAllPages pageSize:100`, `consumables-view.tsx:116-117`), pos/sales workspace, pos/catalog (`fetchAllPages` L97,108) |

Fix: build one `SmartPagination` (page numbers + jump-to-page input + page-size selector) in `packages/ui` (web) and extend `pos/src/components/data/pagination.tsx`; replace all call sites above. `[SHARED]` — every page in the table must migrate before 0.1 is closed.

### 1.2 [SHARED] Sorting + filtering — CONFIRMED (sorting missing 100%)

`grep sort|orderBy|onSort|aria-sort` in web `src/features` = 0 hits; POS `grep sort|orderBy` = only JS `Array.sort` in `booking-form.tsx:38`, `sale-draft-storage.ts:347`. All `<th>` are plain labels.

Existing filters (client `useState` + server query param):

- web/payroll monthly (`monthly-payroll-section.tsx:68-71`): month picker L116-128, search form L130-150, branch select L151-168. Base (`base-salaries-section.tsx:105-107`): search only L120-140, no branch.
- web/bonuses-deductions (`adjustment-view.tsx:305-309`): search L350-370, branch L371-386, month L387-396. web/advances (`advances-view.tsx:277-281`): search L323-343, branch L344-359, month L360-369.
- web/employees (`employees-view.tsx:419-422`): search L507-527, branch L528-543, status hardcoded `'all'` L435 (no UI toggle).
- web/branches (`branches-view.tsx:142-144`): search only L173-193. web/shifts (`shifts-view.tsx:133-136`): search L161-181, branch L196-212.
- web/devices (`devices-view.tsx:258-260`): status L316-328 + type L329-341 only, **no search input**.
- web/weekly-day-off (`weekly-day-off-view.tsx:40-45`): employee L107-126, branch L141-156, status L157-171, dates L172-197, **no search**.
- web/attendance: shared `Filters` L96-141 (search+branch+dates) + per-section extras (sessions state L168, event/approval/suspicious L221-223, absence status L291).
- web/audit (`audit-view.tsx:139-146`): search L182-207, actorType L211-227, module L229-245, dates L247-273, reset L276-286. web/reports (`reports-view.tsx:36-46`): search L138-159, branch L160-175, date/month ranges L176-235.
- web/dashboard: no filters (snapshot only).
- pos/invoices (`invoice-history-view.tsx:42-242`): search `searchDraft` L120-128 + barcode auto-open L61-67,95-105 + branch L135-143. NO status/settlement/date/employee/sort.
- pos/refunds (`refunds-view.tsx:112-316`): search L189-198 + barcode L132-139 + branch L205-217, filtered to `stillRefundable` L108-110. No sort/date/status.
- pos/clients (`clients-view.tsx:25-233`): search only `aria-label=بحث بالاسم أو رقم الهاتف` L157-164. No status/sort/debt filter.
- pos/suppliers history (`suppliers-purchases-view.tsx:62-719`): 3 dropdowns (supplier L586, product L590, status L594, `aria-label` only), NO search, NO sort.
- pos/products (`product-stock-view.tsx:50-503`): search L341 + lowStock toggle L343-351; movements filter `aria-label` only L445-453. No sort.
- pos/expenses (`expenses-view.tsx:35-284`): GOOD — search L206, from/to dates L210-214, status L218-222. No sort.
- pos/reports (`erp-reports-view.tsx:280-489`): BEST — branch (default `كل الفروع`) L378-386 + dates L390-394 + search L398 + explicit `تطبيق الفلاتر` L400 (`applyFilters` L322-331). No column sort.
- pos/commissions (`commissions-view.tsx:98-220`): branch L137-151 + month L156-162. No search/sort.
- pos/fixed-assets (`fixed-assets-view.tsx:62-343`): search only `asset-search` L259-266. No sort/condition filter.
- pos/catalog (`catalog-view.tsx:58-610`): per-tab search L257/L439, tabs L200-221. No sort/filter. pos/transfers, pos/cashier-sessions, pos/cashier-accounts, pos/sales, pos/consumables: no search/sort (tabs or form selects only).

Fix: add `orderBy` backend convention + `SortableTH` + `FilterBar` primitives; per-page gaps listed in section 3. `[SHARED]` — primitives live once, wiring repeats in every table.

### 1.3 [SHARED] Add/Edit inline on page vs popup — CONFIRMED

Web: everything inline `<Card><form>` above the table except confirm dialogs.

- `adjustment-view.tsx`: `AdjustmentCreateForm` L56-185 / `AdjustmentEditForm` L187-286 rendered inline L410-430.
- `advances-view.tsx`: `AdvanceCreateForm` L102-190 / `AdvanceEditForm` L192-246 rendered inline L383-387.
- `employees-view.tsx`: Create L169-277 / Edit L279-415 inline `L568-576`; only delete/deactivate use `ConfirmDialog` L585-594 / `DeactivationDialog` L596-610 (`deactivation-dialog.tsx:37`); settlement `EmployeeSettlementPanel` L612-614.
- `branches-view.tsx`: `BranchForm` L30-138 inline L207-209; delete = inline confirm buttons L279-292.
- `shifts-view.tsx`: `ShiftEditorRow` L44-130 as spanning `<tr>` L287-293. `base-salaries-section.tsx`: `BaseSalaryEditorRow` L20-99 as `<tr><td colSpan=4>` L199-205.
- `devices-view.tsx`: `PairingCard` L86-221 inline L350; `DeviceHistoryRow` L223-253 as spanning `<tr>` L468-470; revoke inline confirm L436-463.
- payroll/monthly: no create form; per-row inline expand (`PayrollBreakdownRow` L24-60, toggled L329) + inline confirm buttons L295-325.
- Only modals in web: `ProtectedAreaUnlockDialog` (`protected-area-gate.tsx:32`), `DeactivationDialog`, `ConfirmDialog` from `@capella/ui`.

POS: mixed. Already Dialog/Modal (keep): bookings `BookingForm modal` (`bookings-view.tsx:181`, `booking-form.tsx:76`), clients `Modal` L133,139, suppliers `Modal` L329-369 + cancel `Modal` L699 + `ConfirmDialog` L683 + purchase drawer `createPortal aside role=dialog` L428-580, products `Modal` L238/L303 + `ConfirmDialog` L426, catalog `Modal` L226,235,406,416 + `ConfirmDialog` L366,384,580 + `CommissionOverridesDialog` L598, cashier-accounts `CashierAccountDialog` L177-181 + `ConfirmDialog` L184,197, refunds `Modal` L64, commissions trace `Modal` L211-217.
Inline (convert to Dialog): expenses `Card` form L137-198 (`beginCorrection` L64), transfers `Card` form L178-325, fixed-assets `Card` form L196-253 (+`ConfirmDialog` delete L272), cashier-sessions open/close inline + `ConfirmDialog` L317 + `RecoveryCloseDialog` L346, consumables `CompletionPanel` L50-88 + `StockPanel` L90-103 inline.

Fix: standardize create/edit on Dialog; keep inline expand only for row details. `[SHARED]` — applies to every form listed in Batch A/B; `[SINGLE]` exception: row-details expand stays inline per page.

### 1.4 [SHARED] Sonner/toast — CONFIRMED 100% missing

- Mounted: `apps/web/src/providers/index.tsx:5,37` (`<Toaster position="top-center" dir="rtl" richColors closeButton />`); `apps/pos/src/providers/index.tsx:5,37` (same + `position=top-center dir=rtl richColors`). `sonner@2.0.7` in both `package.json:28`.
- Zero `toast.success/error` calls in either `src/` (`grep sonner|toast` = mount only). All feedback is inline `<p role="alert" className="text-danger">` / `FieldError` / `Notice` / POS 4s `setTimeout` `SuccessState` (e.g. `suppliers-purchases-view.tsx:164-167,290`, `product-stock-view.tsx:138-142,194`, `expenses-view.tsx:78-82,93`, `catalog-view.tsx:148-152,160`, `stock-transfers-view.tsx:90-94,176`). Success = silent `invalidateQueries + onDone()`.

Fix: add `toast.success/error` in every mutation `onSuccess/onError` across all views listed in 1.1. `[SHARED]` — every mutation in web+pos must wire `notify`; wiring rule: `onError: (error: unknown) => notifyError(error)`.

### 1.5 [SHARED] Debt visibility — CONFIRMED missing

- `Client` (`pos/.../clients/api/clients-api.ts:3-8`): `{id, branchId?, fullName, phone}` — no balance. Client rows (`clients-view.tsx:200-201`) show name/phone only.
- `Supplier` (`suppliers-api.ts:4`): `{id, branchId, name, phone, notes, isActive}` — no balance. Purchases are paid-in-full immutable log (`suppliers-purchases-view.tsx:274-276,444-445`).
- Only signal: per-invoice `balanceDue` (`invoice-history-view.tsx:212-214` `settlementStatus==open ? متبقي : مسددة`, `invoice-receipt-view.tsx:178-183`, `record-payment-dialog.tsx:46,76`, `payment-receipt.tsx:31`) and reports tab `erp-receivables=الدفعات الجزئية` (`erp-reports-view.tsx:53,352`).

Fix (feature, needs API): add `balanceDue/outstanding` to Client/Supplier, `settlementStatus` filter on invoices. `[SHARED]` data contract (API + columns/tabs in existing Clients + Suppliers, visible to cashier + admin — no new page); per-page tab wiring is `[SINGLE]`.

---

## 2. Single-accident pages (verification) — all `[SINGLE]`: fix only in the named file(s)

| # | Report | Verdict | Evidence + fix (`[SINGLE]` each) |
|---|---|---|---|
| 1 | [SINGLE] web/payroll details opens ALL users | NOT REPRODUCED in code | `monthly-payroll-section.tsx:72` `expandedId: number\|null`; toggle L286-290; render inside `items.map` (`Fragment key={record.id}` L249-250) `{expandedId===record.id ? <PayrollBreakdownRow/> : null}` L329; `PayrollBreakdownRow` L24-60 `colSpan={6}` L48; reset on page change L124,157,352,363. Same single-expand pattern in base salaries L108,188-205, advances L284,463-467,520, devices L263,428-470, audit L146,394,403-413. Action: runtime retest (stale bundle/key collision suspected); no code fix without repro steps. |
| 2 | [SINGLE] bonuses/deductions/advances mystery field next to filters | CONFIRMED — unlabeled month filter | `adjustment-view.tsx:387-396` (shared by bonuses+deductions views) + `advances-view.tsx:360-369`: `<Input type="month" aria-label="تصفية حسب الشهر" className="w-44">` with NO visible `<label>`, wired to `monthFilter` state → `payrollMonth` query param (`adjustment-view.tsx:308,315,320`; `advances-view.tsx:280,293`). Fix: add visible `<Label>شهر الاستحقاق</Label>`. |
| 3 | [SINGLE] web/settings empty | CONFIRMED | `apps/web/src/app/(admin)/settings/page.tsx:1-11` = only `وحدة «الإعدادات» قيد الإنشاء.` No view/query/mutation. Fix: implement or remove from nav (product decision). |
| 4 | [SINGLE] POS/bookings no calendar | CONFIRMED | `bookings-view.tsx:51-200`: day diary `listBookings({date,branchId})` L81-82; nav = `moveDate(±1)` L24-28 + `اليوم السابق/التالي` buttons L127,136 + `dayHeading` L130-131 + ghost `اليوم` L132-134 (`cairoToday` L46). Creation form already has `datetime-local` (`booking-form.tsx:88`). No search/filter/sort. Fix: add calendar/day-picker to diary nav. |
| 5 | [SINGLE] POS/invoices needs filter/sort/search | CONFIRMED (weak) | See 1.2. Fix: add status/settlement/date/employee filters + column sort; keep barcode + branch. |
| 6 | [SINGLE] POS/consumables branch not shared | CONFIRMED (divergent) | `consumables-view.tsx:105-143`: `branchId` from `URLSearchParams(?branchId)` L108 + `listCatalogBranches()` single page L115 + `window.location.search` for `cashierSessionId/productId` L107; NO `sessionStorage capella:pos-admin-branch` read/write (only page). Gate `ready=session && branchId!==undefined` L114, `EmptyState اختر فرعاً` L142. Fix: switch to shared `useAdminBranch()` hook. |
| 7 | [SINGLE] Branch selects in bookings/consumables/commissions not showing names | PARTIALLY confirmed — code renders names; runtime/UX gap | Code DOES render `{branch.name}`: `bookings-view.tsx:123`, `consumables-view.tsx:140` (visible `<Label>`), `commissions-view.tsx:149` (visible `<Label>` L136). Suspected runtime causes: (a) bookings select L121-124 has NO `isPending/isError/disabled` handling → while loading/failing it shows only `اختر الفرع`, looks empty-but-selectable; (b) mixed endpoints + single-page fetches: bookings `listCashierSessionBranches()` L77, invoices/refunds/shift-history `listCashierSessionBranches(1)` (truncate >100), commissions/transfers/sales `fetchAllPages(...)`, consumables/products/expenses/catalog `listCatalogBranches` variants, clients `listClientBranches` (`clients-api.ts:35`). Inner consumables selects use `aria-label` only (L80,99,100). Fix: unify on one `useAdminBranch()` + `fetchAllPages` + loading/error/disabled on all three selects; verify at runtime with >1 branch + failed-query case. |

Branch-state reference (all use key `capella:pos-admin-branch` except consumables): bookings `bookings-view.tsx:57-74`, invoices `invoice-history-view.tsx:45-51,74-84`, commissions `commissions-view.tsx:99-116`, clients `clients-view.tsx:28-33,66-73`, suppliers `suppliers-purchases-view.tsx:70-75,154-161`, products `product-stock-view.tsx:63-68,129-136`, sales `sales-view.tsx:35-48,86-95`, expenses `expenses-view.tsx:43-48,73-77`, transfers `stock-transfers-view.tsx:68-89` (+source/dest selects L183,205 with labels), catalog `catalog-view.tsx:64-69,139-146`, cashier-sessions `cashier-session-view.tsx:80-93,183-199` + history `shift-history-view.tsx:57-71`, fixed-assets `fixed-assets-view.tsx:64-71,97-103`, reports `erp-reports-view.tsx:284-305,378-386` (allows `كل الفروع`). Native `Select` styling: `pos/src/components/form/select.tsx:12-22`.

---

## 3. Per-page fix list — `[SHARED]` rollout status per page (each bullet = apply the shared primitive there; not a separate single fix)

### Web (`apps/web`)

- payroll: pager upgrade; add sort; add status filter (monthly) / branch filter (base); Dialog-ify finalize; toast; retest details expand (no code change expected).
- bonuses/deductions/advances: pager; sort; Dialog forms; toast; **visible month label**.
- employees: pager; status toggle UI (un-hardcode `status:'all'`); sort; Dialog forms; toast.
- branches: pager; sort; Dialog form + Dialog delete; toast.
- attendance: pager; sort; toast.
- shifts: pager; sort; Dialog editor; toast.
- devices: pager; **add search**; sort; Dialog pairing; toast.
- audit/reports/weekly-day-off: pager; sort; toast; weekly-day-off **+search**.
- settings: build or drop.
- dashboard: N/A (snapshot).

### POS (`apps/pos`)

- bookings: +calendar picker; branch loading/error states; search/filter/sort; toast.
- invoices/refunds: +status/settlement/date/employee filters + sort; shared pager upgrade; toast. (Refunds scaffold mirrors invoices.)
- consumables: shared branch hook; search/filter/sort; Dialog panels; toast.
- commissions: search/sort; branch loading; toast.
- clients/suppliers: +debt columns/tabs inside existing pages (no new page; cashier + admin visible); missing search (suppliers-history)/sort; toast.
- products: sort; movements pager already OK; toast.
- catalog/sales/transfers/cashier-sessions/cashier-accounts/expenses/fixed-assets/reports: shared pager upgrade; per-table gaps in 1.2; Dialog-ify expenses/transfers/fixed-assets/cashier open-close; toast.

---

## 4. Fix order (combined vs single + type) — `[SHARED/GLOBAL]` = Combined (1 fix → N pages); `[SINGLE]` = 1 page only

Split: **Combined `[SHARED]`** (1 fix → N pages, must land in all touched pages) vs **Single `[SINGLE]`** (1 page). Third axis: `infra` (blocks all) / `bug` (broken) / `parity` (apply infra per page) / `feature` (new).

### Phase 0 — Combined infra `[SHARED]` (do first; unblocks ~30 pages; close only when all call sites migrated)

1. `SmartPagination` (numbers + jump + page-size) — `packages/ui` + extend `pos/.../pagination.tsx`. `[SHARED]`
2. `toast` helper (wrap sonner) + add to all mutations. `[SHARED]`
3. `useAdminBranch()` hook (single key + `fetchAllPages` + loading/error) — closes branch-shared + branch-names at once. `[SHARED]` — single shared hook/component used by all 14 POS pages; no per-page duplicate `capella:pos-admin-branch` logic.
4. `FilterBar` + `SortableTH` primitives + `orderBy` API convention. `[SHARED]`

### Phase 1 — Confirmed single bugs `[SINGLE]` (small, high value; fix only in named files)

1. Month labels (`adjustment-view.tsx:387-396`, `advances-view.tsx:360-369`). `[SINGLE]` — calendar MonthPicker per filter (not plain `<Input type="month">`); do not touch other filters.
2. Consumables branch → `useAdminBranch()`. `[SINGLE]` (first adopter of the SHARED hook).
3. Bookings calendar. `[SINGLE]` (`bookings-view.tsx` diary nav only).
4. Invoices filters/sort (template for refunds). `[SINGLE]` (refunds mirrors invoices, still scoped to those two files).
5. Payroll-details + branch-names: runtime verify first (code looks correct). `[SINGLE]` — verify only, no cross-page change.

### Phase 2 — Parity rollout `[SHARED]` (mechanical, batched: apply shared primitive to every listed page)

- Batch A (web inline→Dialog): bonuses, deductions, advances, employees, branches, shifts.
- Batch B (POS inline→Dialog): expenses, transfers, fixed-assets, consumables panels, cashier open/close.
- Batch C (search/sort fill): devices +search, weekly-day-off +search, suppliers-history +search, all tables +sort.

### Phase 3 — Features (needs API + product decision; `[SHARED]` contract + `[SINGLE]` page wiring)

1. Debts (`Client/Supplier.balanceDue`, `settlementStatus` filter, tabs/columns inside existing Clients + Suppliers — no new page).
2. Settings (build or drop). `[SINGLE]`
3. Backend `orderBy` for sorting. `[SHARED]`

Recommended start: Phase 0 items 1 (pager) + 3 (`useAdminBranch`), then Phase 1.

---

## 5. Work tracker (checklist) — `[SHARED]` items close only when all pages done; `[SINGLE]` items close per file

### Verified rollout checklist (2026-09-15)

- [x] All paginated POS and Web lists use smart pagination (page numbers + jump-to-page). Screens whose data is intentionally unpaginated—dashboard snapshots, bookings day diary, sales workspace, and fetch-all lists—are N/A.
- [x] All POS and Web mutation pages provide Sonner feedback through the shared `notify` helpers. Login forms remain inline by design, and the shared attendance kiosk intentionally avoids per-check-in toasts.
- [x] All POS branch-aware pages use `apps/pos/src/hooks/use-admin-branch.ts`; `capella:pos-admin-branch` is referenced nowhere else under `apps/pos/src`.
- [x] All Web month filters use the calendar-style `MonthPicker`; no native `input[type="month"]` remains under `apps/web/src`.

### Phase 0 — Combined infra `[SHARED]`

- [x] 0.1 `SmartPagination` in `packages/ui` + extend `pos/.../pagination.tsx`, replace all call sites in 1.1 (infra done; call-site migration per page below)
- [x] 0.2 `notify` helper web+pos (`src/lib/notify.ts`, TDD 4/4 each) + mutation-page rollout complete (documented login/kiosk exceptions)
- [x] 0.3 `useAdminBranch()` hook (POS `src/hooks/use-admin-branch.ts`, TDD 7/7) + all branch-aware POS pages migrated
- [x] 0.4 `SortableTH` + `getNextSort` (`packages/ui`, TDD 4/4) — wire per table; proven on consumables stock balances

### Phase 1 — Single bugs `[SINGLE]`

- [x] 1.1 Visible month+branch labels + toast + SmartPagination (`adjustment-view.tsx` bonuses/deductions, `advances-view.tsx`)
- [x] 1.2 Consumables → shared branch hook (+ toast, + stock sort, + branch error/retry)
- [ ] 1.3 Bookings calendar picker
- [ ] 1.4 Invoices filters/sort (+ apply template to refunds)
- [ ] 1.5 Runtime verify: payroll details expand + branch-names display

### Phase 2 — Parity rollout `[SHARED]`

- [ ] 2.A Web inline→Dialog: bonuses, deductions, advances, employees, branches, shifts (+ devices pairing, payroll finalize)
- [ ] 2.B POS inline→Dialog: expenses, transfers, fixed-assets, consumables panels, cashier open/close
- [ ] 2.C Search/sort fill: devices +search, weekly-day-off +search, suppliers-history +search, all tables +sort

### Phase 3 — Features `[SHARED]` contract + `[SINGLE]` wiring

- [ ] 3.1 Debts: `balanceDue` API + tabs/columns inside existing Clients + Suppliers (no new page) + invoice `settlementStatus` filter
- [ ] 3.2 Settings: build or drop from nav
- [ ] 3.3 Backend `orderBy` + frontend sort wiring
