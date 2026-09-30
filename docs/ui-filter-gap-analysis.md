# Search / Filter / Sort Gap Analysis — web/ and POS/

Audit of the reported UX problems (missing search, filters, sorting) and the two structural
changes (employees↔payroll salary merge, shifts page removal). Every claim was verified
against the code; verdicts are ✅ confirmed, ⚠️ partially true, ❌ not true as stated.

**Legend for the gap column**

| Gap | Meaning |
| --- | --- |
| `frontend-only` | The API contract and the API client already accept the parameter; only the UI control is missing. |
| `needs-backend` | The contract `.strict()`s it out or the repository never filters/sorts by it → contract + repository + service change first. |

> Why `needs-backend` matters: list query schemas are `z.object(...).strict()` (e.g.
> `packages/contracts/src/modules/payroll/index.ts:58-64`), so an unknown query param is a
> 400 — you cannot "just send it" from the UI.

---

## 1. Structural changes

### 1.1 Employees page must own salary; payroll loses `الرواتب الأساسية` — ✅

- Create form already collects `monthlyBaseSalary`
  (`apps/web/src/features/employees/components/create-employee-form.tsx:95`).
- Edit form deliberately omits it: `updateEmployeeFieldsSchema = createEmployeeFieldsSchema.omit({ monthlyBaseSalary: true }).partial()`
  (`packages/contracts/src/modules/employees/index.ts:28`), and the UI says so
  (`apps/web/src/features/employees/components/edit-employee-form.tsx:77`).
- The only editor today is `apps/web/src/features/payroll/components/base-salaries-section.tsx`,
  mounted as the second tab of `apps/web/src/features/payroll/components/payroll-view.tsx:25-35`.

**Fix**

1. Add a salary field to `EditEmployeeForm`. It cannot go through `PATCH /employees/:id`
   (contract omits it) — it must call `updateBaseSalary()` →
   `PATCH /payroll/employees/:id/base-salary` (`apps/web/src/features/payroll/api/payroll-api.ts`).
   Two requests (employee fields + salary) or a salary-only change; keep the current copy about
   "applies to the current Cairo month and future months, never rewrites closed months".
2. Remove the `base` branch from `PayrollView` and delete `base-salaries-section.tsx` +
   `apps/web/src/features/payroll/schemas/base-salary-form.ts`.

**Trade-off**: the tab was the only bulk "all salaries at a glance" list. The employees table
already shows `الراتب الأساسي` as a column
(`employees-view.tsx:275,305`), so the loss is only inline editing from a list.

**Tests touched**: `apps/web/tests/payroll-page.test.tsx`,
`apps/web/tests/base-salary-form-schema.test.ts`, `apps/web/tests/employees-page.test.tsx`.

### 1.2 Delete the shifts page — ✅

`ShiftsView` only edits `shiftDurationMinutes` per employee
(`apps/web/src/features/shifts/schemas/shift-form.ts:30`), which the employees create/edit forms
already expose (`create-employee-form.tsx:94`, `edit-employee-form.tsx:113`).

**Delete**: `apps/web/src/app/(admin)/shifts/`, `apps/web/src/features/shifts/`,
nav entry `apps/web/src/components/shell/nav.ts:45`, the ERP-edition allowlist entry
`'/shifts'` in `apps/web/src/components/shell/sidebar.tsx:16`,
tests `apps/web/tests/shifts-page.test.tsx` and `apps/web/tests/shift-form-schema.test.ts`.

**Keep**: backend `PATCH /shifts/employees/:id`, the `shifts` audit-module label
(`audit-view.tsx:36`), the dashboard entity label, and report constants
(`reports-constants.ts:11,36,46`) — those reference audit/report entity types, not the page.

**Only loss**: the friendlier hours/minutes input with the min/max helper text; the employees
form takes raw minutes.

---

## 2. web/

| # | Page | Claim | Verdict | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 | devices | no search | ✅ | only `status` + `assignmentType` selects (`devices-view.tsx:321,334`); contract already has `search` (`contracts/modules/devices/index.ts:17`, repo `devices-repository.ts:242`) and `assignmentId` is also unused | `frontend-only` |
| 2 | devices | bad sorting, active should be on top | ✅ | `devices-repository.ts:254` → `.orderBy(asc(devices.id))` (oldest first); no sort params in contract | `needs-backend` (order by `status='active'` first, then `lastUsedAt desc`) |
| 3 | weekly-day-off | missing search | ✅ | no search box; `listWeeklyDayRecords` already sends `search` (`weekly-day-off-api.ts:31`) | `frontend-only` |
| 4 | weekly-day-off | missing filters | ⚠️ | employee/branch/status/date range already exist (`weekly-day-off-view.tsx:41-45`); only `withoutPermission` is missing (contract:32, api:46) | `frontend-only` |
| 5 | branches | missing search + filters | ❌/⚠️ | search exists (`branches-view.tsx:141-194`); contract allows only `search` + paging (`contracts/modules/branches/index.ts:55`) and the entity has no status field | `needs-backend` for any filter dimension (nothing to filter by today) |
| 6 | attendance — sessions | missing filters | ⚠️ | has search/branch/dates/state (`admin-attendance-view.tsx:220-222`); missing `employeeId` (contract:89, api `attendance-api.ts:52`) | `frontend-only` |
| 7 | attendance — denied | missing filters | ⚠️ | has search/branch/dates/event/approval/suspicious (`:288-292`); missing `employeeId` (contract:100) | `frontend-only` |
| 8 | attendance — manual | missing filters | ❌ | it is a data-entry form, not a list — no filters apply | n/a |
| 9 | attendance — absence | missing filters | ⚠️ | has search/branch/dates/status (`:360-362`); missing `employeeId` and `withoutPermission` (weekly-day-off contract:29,32) | `frontend-only` |
| 10 | payroll `رواتب الشهور` | missing filters | ⚠️ | has month + search + branch (`monthly-payroll-section.tsx:166-352`); the only useful missing filter is row `state` (`ready`/`blocked`, `payroll-repository.ts:439,448`) | `needs-backend` (contract is `.strict()` on `search/branchId/month`) |
| 11 | bonuses | missing filters | ⚠️ | `AdjustmentView` already has search + branch + month (`adjustment-view.tsx:380-476`); missing `employeeId` (contract bonuses:31, api `bonuses-api.ts:18`) | `frontend-only` |
| 12 | deductions | missing filters | ⚠️ | same shared view; missing `employeeId` (contract deductions:31) | `frontend-only` |
| 13 | advances | missing filters | ⚠️ | has search + branch + month (`advances-view.tsx:276-373`); missing `employeeId` (contract advances:51, api:45) | `frontend-only` |
| 14 | audit | JSON blob on "عرض التفاصيل" | ✅ | `JSON.stringify(before/after/relatedIds/ip/userAgent)` in a `<pre>` (`audit-view.tsx:135-141, 412-416`) | `frontend-only` (structured before/after diff + labels) |
| 15 | audit | needs a lot of filters | ⚠️ | UI has search/actorType/module/dateFrom/dateTo (`audit-view.tsx:145-150`); contract also supports `action`, `entityType`, `entityId`, `requestId` (`contracts/modules/audit/index.ts:16-28`) | `frontend-only` for those 4; anything more (e.g. free-text in payload) → `needs-backend` |

---

## 3. POS/

| # | Page | Claim | Verdict | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 | bookings | missing search/filters | ✅ | only day picker + branch (`bookings-view.tsx:57,151-174`); contract is required `date` + `branchId` (`contracts/.../bookings/index.ts:38`) | `needs-backend` for search/status/employee filters |
| 2 | clients | missing search/filters | ❌ | search + `debtStatus` + branch all exist (`clients-view.tsx:94-95, 224-256`); contract offers only those two (`clients/index.ts:78`) | more filters → `needs-backend` |
| 3 | consumables | missing search/filters | ✅ | tabs + branch only (`consumables-view.tsx:174-218`); contract supports `search`, `status`, `consumptionStatus`, `serviceId`, `employeeId`, `invoiceId` (`consumables/index.ts:88-99`) and `listConsumableServices` passes them (`consumables-api.ts:9`) | `frontend-only` |
| 4 | cashier-sessions (history) | missing search/filters | ✅ | branch + page only (`shift-history-view.tsx:44-47`); contract `cashierSessionListQuerySchema` = `branchId` + paging (`sales/cashier-sessions.ts:50`) | `needs-backend` (date range, open/closed, cashier) |
| 5 | suppliers | missing search/filters | ✅ | `supplier-list-section.tsx` has zero controls; contract has `search` + `isActive` (`suppliers/index.ts:39`) and `listSuppliers` accepts them (`suppliers-api.ts:8`) | `frontend-only` |
| 6 | suppliers — purchase history | missing date filter | ✅ | `historyParams` = supplier/product/status/page (`suppliers-purchases-view.tsx:108`); contract supports `from`/`to` (`suppliers/index.ts:73`, api:16) | `frontend-only` |
| 7 | transfers | missing search/filters | ✅ | list sends `page`+`branchId` only (`stock-transfers-view.tsx:106-111`); contract supports `productId`, `from`, `to` (`transfers/index.ts:50`, api:42-49) | `frontend-only` |
| 8 | commissions | missing search/filters | ⚠️ | has branch + month (`commissions-view.tsx:148-239`); missing `employeeId` (contract commissions:21); no `search` in contract at all | `frontend-only` for employee; `needs-backend` for search |
| 9 | catalog | missing filters | ⚠️ | search exists for both categories and services (`catalog-view.tsx:257,440`); missing category `type`+`isActive`, service `categoryId`+`isActive` (catalog:98,130; api accepts all) | `frontend-only` |
| 10 | products | missing filters | ⚠️ | has search + `lowStock` (`product-stock-view.tsx:70` + `productParams`); missing `isActive` and stock-movement `reason` (stock:117,138; api:23,46) | `frontend-only` |
| 11 | expenses | missing filters | ❌ | complete vs contract: search + from + to + status + branch (`expenses-view.tsx:219-240`) | only new dimensions (amount, category) → `needs-backend` |
| 12 | fixed-assets | missing filters | ⚠️ | search exists (`fixed-assets-view.tsx:73`); contract is `search` only (`fixed-assets/index.ts:44`) | `needs-backend` (condition, location, purchase-date range) |

---

## 4. Gap summary

### frontend-only (do first — no API work)

- **web**: devices search + assignment filter; weekly-day-off search + `withoutPermission`;
  `employeeId` on attendance sessions/denied/absence, bonuses, deductions, advances;
  audit `action` / `entityType` / `entityId` / `requestId` filters + structured detail view;
  employees salary merge (via the existing payroll endpoint).
- **POS**: suppliers search + `isActive` (+ purchase `from`/`to`); consumables search +
  `status`/`consumptionStatus`/`serviceId`/`employeeId`; transfers `productId` + date range;
  catalog category `type`/`isActive` and service `categoryId`/`isActive`;
  products `isActive` + movements `reason`; commissions `employeeId`.

### needs-backend (contract + repository + service, then UI)

| Area | Missing capability |
| --- | --- |
| devices | sort order (active first, then `lastUsedAt desc`) |
| payroll months | row `state` (`ready`/`blocked`) filter |
| branches | any second filter dimension (entity has no status field) |
| bookings | search, status, employee filters (contract requires `date`) |
| cashier sessions | date range / status / cashier filters |
| fixed-assets | condition, location, purchase-date range |
| commissions | search |
| expenses | amount range / category (optional, only if product asks) |

---

## 5. Implementation progress

### Done

| # | Area | Change | Files |
| --- | --- | --- | --- |
| 1 | devices (web) | search input added to filter row; `search` param wired through API client + query key | `devices-api.ts`, `devices-view.tsx`, `devices-page.test.tsx` |
| 2 | weekly-day-off (web) | search input + `withoutPermission` checkbox added to filter row | `weekly-day-off-view.tsx`, `weekly-day-off-page.test.tsx` |
| 3 | advances (web) | employee filter dropdown added to filter row; `employeeId` param wired through query key | `advances-view.tsx`, `advances-page.test.tsx` |
| 4 | bonuses (web) | employee filter dropdown added to shared `AdjustmentView`; `employeeId` param wired through query key | `adjustment-view.tsx`, `bonuses-page.test.tsx` |
| 5 | deductions (web) | employee filter dropdown added to shared `AdjustmentView`; `employeeId` param wired through query key | `adjustment-view.tsx`, `deductions-page.test.tsx` |
| 6 | attendance (web) | employee filter dropdown added to shared `Filters` component; `employeeId` param wired through sessions, denied, and absence sections | `admin-attendance-view.tsx`, `attendance-page.test.tsx` |
| 7 | audit (web) | `action`, `entityType`, `entityId`, `requestId` filter inputs added to filter grid | `audit-view.tsx`, `audit-page.test.tsx` |
| 8 | employees salary merge (web) | salary field added to `EditEmployeeForm`; `updateBaseSalary()` called on save; `base` tab removed from `PayrollView`; `base-salaries-section.tsx` + `base-salary-form.ts` deleted | `edit-employee-form.tsx`, `payroll-view.tsx`, `employees-page.test.tsx`, `payroll-page.test.tsx` |
| 9 | shifts page deletion (web) | `app/(admin)/shifts/`, `features/shifts/`, nav entry, ERP-edition allowlist entry, and tests deleted | `nav.ts`, `sidebar.tsx` |

### In progress

| # | Area | Change | Files |
| --- | --- | --- | --- |
| — | — | — | — |

### Skipped (needs-backend — not now)

| Area | Reason |
| --- | --- |
| devices sort order | needs contract + repo change |
| payroll months state filter | needs contract + repo change |
| branches filters | needs contract + repo change |
| bookings filters | needs contract + repo change |
| cashier sessions filters | needs contract + repo change |
| fixed-assets filters | needs contract + repo change |
| commissions search | needs contract + repo change |
| expenses amount/category | needs contract + repo change |

### Skipped (frontend-only — deferred)

| Area | Reason |
| --- | --- |
| devices assignmentId filter | requires employee/branch dropdown + contract constraint handling — separate task |

---