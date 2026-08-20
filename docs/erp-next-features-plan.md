# Beauty Center ERP — Next Features Plan

Status: **Steps 1-3 built; Steps 4-9 still plan only.** Written 2026-08-19 after reading the
current codebase. Covers the nine changes requested on 2026-08-19.

This document is written to be read by a person who is not going to open the code. Every
section says what is wrong or missing today, what we will build, and every file that gets
touched. Where a decision was taken by the owner it is marked **Decided**; where a decision
was taken by the engineer because the code left no reasonable alternative it is marked
**Engineering call** with the reason.

`docs/architecture.md` is stale (it still describes the original HR scaffold) and was not
used. `docs/erp-plan.md` is current and is the source of truth for why the system is shaped
the way it is; §12 below lists the decisions in it that these nine changes overturn.

---

## 1. How the system is built today

Everything below depends on these facts, all verified by reading the code.

```
apps/
  api/     one Express API, modular monolith
  pos/     Next.js — the beauty centre / till app   (Arabic, RTL)
  web/     Next.js — the HR app                     (Arabic, RTL)
  worker/  background jobs (PDF reports, shift auto-close sweep)
packages/
  contracts/  zod request+response schemas shared by API and both frontends
  database/   Drizzle schema + numbered SQL migrations
  config/     the edition registry (which modules exist in which product)
  ui/         shared React components
  reporting/  PDF rendering
```

**Request flow:** `POS feature → REST client → /api/v1/erp/<module> → router → service →
repository → Drizzle → MySQL`.

**Module boundary rules that new code must obey** (enforced by ESLint and by
`apps/api/tests/architecture/erp-module-boundaries.test.ts`):

- HR modules must never import ERP modules. ERP may use HR only through the capability
  bridge at `apps/api/src/modules/erp/hr-capabilities.ts`.
- One ERP module may import another only through its public `index.ts`, never its internals.

**Editions.** `packages/config/src/edition.ts` lists every module and what it requires. A
customer's `.env` picks `hr`, `erp`, or `full`, and only that edition's modules are wired up
at boot. **Every new module must be registered there**, or it will not exist at runtime.

**Migrations.** All schemas migrate on every installation regardless of edition. The next
migration number is **0070** (`packages/database/migrations/` currently ends at `0069`).
Each migration is one `.sql` file plus a `meta/00NN_snapshot.json` and an updated
`meta/_journal.json`.

**Money.** Every amount is a MySQL `decimal` and a string in TypeScript, never a float.
Arithmetic goes through `BigInt` cents helpers. Totals are re-checked by database `check`
constraints, by zod, and by the service layer — three independent layers. New money features
must add all three.

**Invoices are immutable facts.** Every invoice line snapshots the item name, price,
commission rule and rate at the moment of sale. Nothing about a stored invoice is edited
when the catalogue later changes. Corrections are made by appending new records, never by
updating old ones. Two existing patterns do this and both are reused below:

- *reversals* — `erp_invoice_reversals` for voids and refunds.
- *correction lineage* — `erp_expenses` carries `reversal_of_id`, `supersedes_id`,
  `correction_operation_id`, `correction_reason`.

---

## 2. What was decided before writing this plan

| # | Question | Decision |
|---|---|---|
| 1 | Booking scope | **Staff-only appointment book** inside the POS. No public page, no online payment, no deposit. |
| 5 | Partial payment scope | **Product-only invoices**, balance stays open on the same invoice, client takes the goods immediately. |
| 9 | Employee reassignment | **After the invoice is printed** — a correction that moves the commission and produces a corrected, reprintable invoice. |
| 7 | Service counter | **A live queue staff move along**, per service, per day. |
| 3 | Which "/shifts" page | **The POS till-shifts page** (`ورديات الكاشير`, currently `/cashier-sessions`). Not the HR `/shifts` page. |
| 2 | Barcode scope | **All three**: product labels + scan-to-sell, invoice barcode on the receipt + scan-to-open, and booking/queue tickets. |
| 6 | Refund methods | **Any method, freely chosen.** The split need only add up to the refund total. |
| — | Build order | **Quick wins first.** |
| 5 | Who may reassign a sold service | **Admin and cashier**, like voids and refunds. Every change records who, when and why. |
| 6 | Minimum down payment | **None.** The cashier decides; even zero is allowed. |
| 6 | Return by a client who still owes | **The debt is cut first.** Cash goes back only if the return is worth more than the debt. |
| 3 | Who may see shift history | **Admin: every branch. Cashier: only shifts they opened themselves.** |
| 2 | Label size | **40 × 30 mm** as the default, kept changeable in one place. |
| 2 | Supplier barcodes | **Keep the supplier's code when the box already has one.** Only products without one get our code and a sticker. |
| 7 | Queue ticket | **No separate ticket.** The queue positions print on the sale receipt itself. |
| 1 | Bookings screen | **One day at a time**, appointments in time order. |

### Hardware, identified from the photos

| | Model | What it means for us |
|---|---|---|
| Printer | **Xprinter XP-233B** thermal barcode printer | Label roll 20–60 mm wide, 127 mm/s, **USB**, cash-drawer port. It is a *label* printer, not the receipt printer. |
| Scanner | **Datalogic QuickScan Lite QW2100** | **1D only** (no QR / no 2D). USB. Ships as a **keyboard wedge**: it types the barcode digits and presses Enter. No driver, no browser permission, no WebUSB. |

Two consequences that shape the whole barcode design:

1. **Reading a barcode is just listening for fast keystrokes.** Nothing else is needed.
2. **The barcode must be a 1D symbology.** QR codes are out. We use **EAN-13** for products
   and **Code 128** for invoice/ticket codes.

---

## 3. Build order

Quick wins first, as decided. Two ordering notes that matter:

- **Step 3 lays a foundation Step 6 needs.** Partial payment turns
  `erp_invoice_payments` into a ledger of instalments taken at different times, possibly in
  different shifts. The shift money summary must therefore count money **per payment row,
  keyed to the shift that took it** — not per invoice. Step 3 adds those columns so Step 6
  does not force a rewrite of the shift totals.
- **Step 9 depends on Step 8.** Booking hands its services to the sales screen, so the sales
  screen should be in its final shape first.

| Step | Feature | Size | New module? |
|---|---|---|---|
| 1 | Refund payment split chosen by the cashier — **built** | Small | no — extends `erp-sales` |
| 2 | Employee termination: close the settlement gaps — **built** | Small | no — extends `employees` / `payroll` |
| 3 | Till shift history + live shift totals — **built** | Medium | no — extends `erp-sales` |
| 4 | Barcodes: print, scan, sell | Medium | no — extends `erp-catalog` + POS |
| 5 | Reassign the employee on a sold service | Medium | no — extends `erp-sales` + `erp-commissions` |
| 6 | Partial payment on product-only invoices | Large | no — extends `erp-sales` |
| 7 | Sales screen restyle to one full page | Large | POS only |
| 8 | Live per-service queue | Large | **new** `erp-queue` |
| 9 | Customer booking | Large | **new** `erp-bookings` |

---

## 4. Step 1 — Refund payment split chosen by the cashier

### The problem

The API already accepts a per-method refund split: `refundInvoiceSchema` takes
`payments: [{ method, amount }]` and the repository validates it. **The screen never lets
the cashier use it.**

`apps/pos/src/features/sales/components/invoice-reversal-controls.tsx:32-45` contains
`allocateTenders()`, which walks the original payments in order and fills the refund from
each until the total is covered. The comment above it states the intent plainly: "the refund
always goes back on the methods the client paid with. The tender split is therefore derived
from the quote instead of typed."

There is also a second, deeper restriction in the API, at
`apps/api/src/modules/erp/sales/sale-repository.ts:925-933`: a refund method must match a
payment on the original invoice, and may not exceed what is left on it. A client who paid by
Visa cannot be handed cash.

### What we build

The cashier types how much goes back on each of the four methods. The split is prefilled
with the old automatic answer, so the ordinary case is still one tap. The only rule left is
that the split must add up to the refund total.

### How it works

The blocker is a foreign key. `erp_invoice_reversal_payments.invoice_payment_id` is
`NOT NULL` and points at the original payment row being reversed. A refund handed back on a
method the client never used has no such row to point at.

**Engineering call:** make `invoice_payment_id` **nullable** rather than dropping it. When
the refunded method does match an original payment and fits inside what is left on it, we
still link the two rows, so the existing per-payment `refundedAmount` / `refundableAmount`
accounting on the invoice keeps working. When it does not match, the column is null and the
refund row stands on its own. Nothing that works today stops working.

Voids are untouched: a void still mirrors the original payments exactly, because a void
undoes the whole sale.

**Risk to state plainly:** the till can now hand out cash it never took in (paid by Visa,
refunded in cash). That is a real business exposure, and it is exactly why Step 3's shift
summary must show refunds broken down by method. The two features belong together.

### Files touched

| File | Change |
|---|---|
| `packages/database/src/schema/erp/sales/index.ts` | `invoiceReversalPayments.invoicePaymentId` becomes nullable |
| `packages/database/migrations/0070_refund_free_payment_methods.sql` | new — drop NOT NULL |
| `packages/database/migrations/meta/0070_snapshot.json`, `meta/_journal.json` | new / updated |
| `apps/api/src/modules/erp/sales/sale-repository.ts` | replace the per-method cap at 925-933 with link-if-it-fits, null otherwise; keep the total check |
| `apps/api/src/modules/erp/sales/sale-service.ts` | `quoteRefund` returns all four methods as options with the amount originally paid on each, instead of only the refundable ones |
| `packages/contracts/src/modules/erp/sales/index.ts` | `refundQuoteSchema.payments` gains `paidAmount`; comment on `refundInvoiceSchema.payments` updated |
| `apps/pos/src/features/sales/components/invoice-reversal-controls.tsx` | delete `allocateTenders`; add four editable amount inputs prefilled from the quote, a remaining/over indicator, and a confirm button disabled until the split balances |
| `apps/pos/tests/refunds-view.test.tsx` | cover typing a split, an unbalanced split, and a cross-method refund |
| `apps/api/tests/erp/sale-repository-mysql.integration.test.ts` | cross-method refund stores a null `invoice_payment_id`; matching method still links |
| `apps/api/tests/erp/sale-service.test.ts` | quote returns all four methods |
| `apps/pos/tests/e2e/invoice-reversals.spec.ts` | refund a Visa sale in cash |

No change needed to `refund-receipt.tsx` — it already prints `reversal.payments` per method.

### Built — what the plan missed

Step 1 is implemented. Two things the plan did not anticipate turned up while building it, both
of which had to be fixed for the feature to work at all:

- **A database trigger enforced the same rule.**
  `erp_invoice_reversals_validate_finalize` totals a reversal's refunds by joining each one back
  to the original payment it reverses. A refund handed back on another method has no such
  payment, so the join dropped it, the total came out short, and MySQL itself rejected the
  refund — after the application had already allowed it. Migration `0070` rebuilds that trigger
  to total every refund row whether or not it links to a payment, and relaxes
  `erp_invoice_reversal_payments_validate_insert` so a null link is accepted while a non-null
  one is still checked as strictly as before.
- **The payment-methods report had the same flaw, and it was losing money.**
  `apps/api/src/modules/erp/erp-reports/erp-report-repository.ts` inner-joined refunds to the
  original payment, so a refund handed back on another method would have disappeared from the
  report entirely — cash out of the till with nothing to show for it. The join carried no data
  and only duplicated a scoping rule already applied through the invoice, so it was removed.

### Found by review, after the first green run

- **Letting the split be typed broke idempotency.** The POS built its idempotency key
  by fingerprinting the whole request, which now includes the tender split. A refund
  whose answer is lost after the till has already paid out, retried with the money moved
  to another method, produced a *different* key and posted a **second** refund. The key
  is now derived from what is being refunded (branch, reason, lines) and not from how the
  money is handed back, so any such retry replays the stored refund.
- **An unreadable quote total enabled the confirm button.** `cents()` returning null was
  coerced to zero, so an empty split "balanced" against a zero total and a refund of no
  money could be posted. A total that cannot be read is now its own refusal.
- `PublicInvoiceDto.payments[].refundableAmount` describes **that payment row**, not the
  invoice. An unlinked refund leaves it untouched, so a fully refunded invoice can still
  show money "refundable" against a payment. Documented on the schema, since it is the
  field the POS prefills from.

One consequence worth recording: `REFUND_PAYMENT_EXCEEDED` no longer exists. It meant "this
refund is larger than what is left on that payment method", which is precisely the rule the
cashier now overrides. The only cap left is that the split must equal the quoted total, which
raises `REFUND_PAYMENT_MISMATCH`. The code was removed from the contract and the message map
rather than left behind unreachable.

---

## 5. Step 2 — Employee termination: close the settlement gaps

### The problem

Most of this already exists and is good. `apps/api/src/modules/employees/deactivation-financial.ts`
already, when an employee is deactivated:

- pulls every unpaid advance instalment forward onto the current month;
- previews the resulting net salary and refuses to proceed if it has drifted since the admin
  looked at it;
- applies the admin's decision about the advance debt (`sum_all`, `zero_salary`,
  `ignore_debt`);
- applies the admin's decision about a negative balance (`collect_cash` or `record_debt`);
- refuses to run at all if the month's payroll is already finalised;
- defers the whole thing to check-out time if the employee is still clocked in, and replays
  it when the shift closes.

So "settle the employee's money" is largely done. Three genuine gaps remain.

**Gap A — a recorded debt can never be marked paid.** The table
`employee_outstanding_debts` has a `settled_at` column. Searching the whole repository, that
column is written by nothing, read by nothing, and exposed by nothing. A debt recorded when
someone leaves is permanent in the system even after they walk in and pay it. *(Reporting
this as an existing defect, per the repo's instruction to flag problems found while reading.)*

**Gap B — there is no termination record.** Deactivation flips
`employees.employment_status` to `inactive` and closes the row in
`employee_employment_periods`. Nowhere is there a reason for leaving, a last working day
chosen by the admin, or a settlement statement the employee can be handed.

**Gap C — nothing that references the employee is reviewed.** Deactivation does not check
whether the person still has open work attached to them. Today that means nothing; after
Steps 8 and 9 it will mean queue tickets and bookings assigned to someone who has left.

### What we build

- A **debt settlement action**: admin marks an outstanding debt as paid, stamping
  `settled_at`, and the employee's debt list shows paid and unpaid separately.
- A **termination record**: reason, last working day, and who terminated, stored alongside
  the existing employment period.
- A **printable settlement statement**: one A4 page listing salary owed, advances recovered,
  write-offs, forfeited salary, cash collected, and the final figure — the numbers the
  existing code already computes, put on paper.
- A **blocking pre-check**: deactivation refuses to run while the employee still has future
  bookings or open queue tickets, and tells the admin what to reassign first. Wired as an
  optional capability so it stays absent in the HR-only edition.

### Files touched

| File | Change |
|---|---|
| `packages/database/src/schema/payroll/index.ts` | add `employeeTerminations` table (employee, reason, lastWorkingDay, actingAccountId, createdAt); index `employeeOutstandingDebts.settledAt` |
| `packages/database/migrations/0071_employee_termination.sql` + meta | new |
| `packages/contracts/src/modules/employees/index.ts` | `employeeDeactivationSchema` gains `reason` and `lastWorkingDay`; new `settleEmployeeDebtSchema`, `employeeSettlementStatementSchema` |
| `apps/api/src/modules/employees/deactivation-financial.ts` | record the termination row; call the new blocking pre-check |
| `apps/api/src/modules/employees/employees-service.ts` | accept the new fields; add `settleDebt`, `getSettlementStatement`; new error codes for the blocking check |
| `apps/api/src/modules/employees/employees-repository.ts` | write the termination row; write `settled_at`; read debts and the statement |
| `apps/api/src/modules/employees/employees-router.ts` | `POST /employees/:id/debts/:debtId/settle`, `GET /employees/:id/settlement` |
| `apps/api/src/modules/employees/index.ts` | export the new types |
| `apps/api/src/modules/payroll/financial-repository-helpers.ts` | debt read/settle helpers |
| `apps/api/src/runtime/api-runtime.ts` | pass the optional booking/queue pre-check capability |
| `apps/web/src/features/employees/components/employees-view.tsx` | reason + last working day in the deactivation dialog; blocking message |
| `apps/web/src/features/employees/api/employees-api.ts` | new calls |
| `apps/web/src/features/employees/components/settlement-statement.tsx` | new — printable statement |
| `apps/web/src/features/financial-adjustments/…` | debt list gains a "mark as paid" action |
| `apps/api/tests/employees/*` | settle a debt, terminate with a reason, blocked termination |
| `apps/web/tests/employees-view.test.tsx` | dialog fields and the blocked path |

### Built — what the plan missed

Step 2 is implemented. Five things differ from the plan above, each because the code left no
reasonable alternative:

- **The debt helpers are not where the plan said.** There is no
  `payroll/financial-repository-helpers.ts` holding them; `recordOutstandingDebt` lives in
  `apps/api/src/modules/advances/advances-repository.ts`, and the new read and settle helpers
  went next to it.
- **Debts were invisible, not merely un-settleable.** Nothing in the repository read
  `employee_outstanding_debts` at all — no endpoint, no contract, no screen. So the step had to
  build a debt **list** (`GET /employees/:id/debts`) before "mark as paid" had anywhere to live.
- **`acting_account_id` was dropped in favour of the audit actor.** A root admin authenticates
  without an account row, and a deactivation deferred to check-out is replayed with no admin
  present at all, so that column would have been null in exactly the cases where "who did this"
  matters. The termination row stores `terminated_by_type` / `terminated_by_identifier` taken
  from the ambient audit context instead, which is populated on all three paths.
- **`employee_pending_deactivations` needed the new fields too.** A deferred deactivation is
  replayed from that row, so without carrying the reason and last working day it would have
  produced a termination record with neither. Migration `0071` adds both columns nullable,
  backfills the rows already waiting, and only then makes them `NOT NULL`.
- **`prepareEmployeeDeactivation` now returns the settlement figures**, and reads the settled
  payroll unconditionally rather than only on the paths that expect zero. The frozen statement
  must carry the number payroll actually landed on, not one re-derived from whichever branch the
  admin took.

The settlement statement is **frozen at termination**, as decided: the figures are captured onto
the termination row and reprinted from there forever, so paper handed to an employee never
disagrees with a reprint months later.

The blocking pre-check is built and tested as an optional capability, and deliberately **left
unwired** in `api-runtime.ts` — nothing can hold open work against an employee until `erp-queue`
and `erp-bookings` exist. Wiring it is one argument at the `createEmployeesModule` call.

**Not done, deliberately:** defect 2 in §14 (roster rows surviving deactivation). It is not a bug
today — every read filters on `employment_status = 'active'` — and cleaning it up changes what
deactivation writes, which is a separate behaviour change from closing the settlement gaps.

---

## 6. Step 3 — Till shift history and live shift totals

### The problem

`apps/pos/src/features/cashier-sessions/components/cashier-session-view.tsx` shows exactly
one thing: the shift that is open right now, with its branch, who opened it, and when. There
is no history and no money anywhere on the page.

The API is equally thin. `CashierSessionRepository` in
`apps/api/src/modules/erp/sales/cashier-sessions-service.ts:25-59` can open a shift, find
the open one, close it, force-close it, and auto-close expired ones. **There is no list, and
no totals.** `docs/erp-plan.md` §7 says a shift records "who + when only".

The data to answer the question already exists — `erp_invoices.cashier_session_id` is
`NOT NULL` on every invoice — it has simply never been read that way.

### What we build

Past shifts for a branch, each with: when it opened and closed, how long it ran, whether a
person or the 16-hour timer closed it, how many sales, money taken split by payment method,
refunds split by method, net, and the list of its invoices. Plus the same figures updating
live for the shift that is open.

### How it works

**Engineering call — count money per payment row, not per invoice.** Step 6 will let a
client pay part of a product invoice now and the rest next week, in a different shift. If
shift totals are computed as "sum of the totals of invoices whose `cashier_session_id` is
this shift", that later instalment lands in the wrong shift forever. So this step first adds
`cashier_session_id`, `acting_account_id` and `paid_at` to `erp_invoice_payments`,
backfilled from each payment's invoice, and every total below is computed from that ledger.
This is a small change now and saves rewriting the summary in Step 6.

Refunds are attributed the same way, through `erp_invoice_reversals.created_at` and a new
`cashier_session_id` on the reversal.

The live figures reuse the same read, polled while the page is open; no second code path.

The existing `closeExpired()` call already runs before every shift read, so a stale open
shift cannot appear as live.

### Files touched

| File | Change |
|---|---|
| `packages/database/src/schema/erp/sales/index.ts` | `invoicePayments` gains `cashierSessionId`, `actingAccountId`, `paidAt` + indexes; `invoiceReversals` gains `cashierSessionId` |
| `packages/database/migrations/0072_shift_money_attribution.sql` + meta | new — add columns, backfill from the parent invoice, then set NOT NULL |
| `packages/contracts/src/modules/erp/sales/index.ts` | `cashierSessionListQuerySchema`, `cashierSessionSummarySchema` (durationMinutes, saleCount, per-method taken/refunded, net), `cashierSessionDetailSchema` (summary + invoice list) |
| `apps/api/src/modules/erp/sales/cashier-sessions-service.ts` | `list`, `summary`, `detail` on the repository interface and the service; an admin may read any branch, a cashier only shifts whose `openedByAccountId` is their own account |
| `apps/api/src/modules/erp/sales/cashier-sessions-repository.ts` | the aggregate queries |
| `apps/api/src/modules/erp/sales/cashier-sessions-router.ts` | `GET /erp/cashier-sessions`, `/:id`, `/:id/invoices` |
| `apps/api/src/modules/erp/sales/sale-repository.ts` | stamp the new payment and reversal columns on write |
| `apps/pos/src/features/cashier-sessions/api/cashier-sessions-api.ts` | new calls |
| `apps/pos/src/features/cashier-sessions/query-keys.ts` | keys for list / detail |
| `apps/pos/src/features/cashier-sessions/components/cashier-session-view.tsx` | live totals card on the open shift |
| `apps/pos/src/features/cashier-sessions/components/shift-history-view.tsx` | new — paged past shifts |
| `apps/pos/src/features/cashier-sessions/components/shift-detail-view.tsx` | new — one shift's summary and its sales |
| `apps/pos/src/app/(protected)/cashier-sessions/page.tsx` | render both |
| `apps/pos/src/app/(protected)/cashier-sessions/[sessionId]/page.tsx` | new |
| `apps/pos/src/components/shell/nav.ts`, `erp-home-view.tsx` | label the entry as shift history too |
| `apps/api/tests/erp/cashier-sessions-service.test.ts`, `cashier-sessions-router.test.ts`, `cashier-sessions-repository-mysql.integration.test.ts` | totals, permissions, an instalment paid in a later shift |
| `apps/pos/tests/cashier-session-view.test.tsx` + new `shift-history-view.test.tsx` | rendering, permissions |

**Optional but recommended:** add `erp-shifts` to the ERP report list in
`packages/contracts/src/modules/reports/index.ts` so a shift summary can be exported as PDF
through the existing worker pipeline.

---

### Built — what the plan missed

Step 3 is implemented. What the plan did not anticipate:

- **A shift can hand back more money than it took, so its net carries a sign.**
  Every money field in the sales contracts is unsigned by construction. A till that
  refunds a sale rung up in an earlier shift ends the day at, say, `-185.00`, which
  is a real and important number to show. `cashierSessionSummarySchema.net` uses a
  new signed money schema; every other field stays unsigned.
- **A reversal's shift is nullable, and deliberately so.** An Admin may refund with
  no till open at all, and a shift past its sixteen hours is spent whether or not
  the sweep has written its close. Both leave `erp_invoice_reversals.cashier_session_id`
  null rather than attributing the money to a stale shift. The refund is then
  visible on the invoice and in the payment-methods report, but belongs to no
  shift — which is the honest answer.
- **`db:generate` again emitted `ADD ... NOT NULL` with no default.** Migration
  `0072` was rewritten by hand as nullable → backfill from the parent invoice →
  `MODIFY ... NOT NULL`, the same shape `0071` needed, so existing payment rows
  survive.
- **Sales are counted where they were rung up; money is counted where it moved.**
  `saleCount` reads `erp_invoices.cashier_session_id` while every amount reads the
  payment and reversal rows. They answer two different questions ("how busy was
  this shift" versus "whose money was it"), and Step 6 will pull them apart
  further rather than reconcile them.
- **An invoice belongs to a shift's list three different ways.** It was rung up in
  it, the shift took money on it, or the shift handed money back on it. The detail
  list unions all three and reports `takenInShift` / `refundedInShift` per invoice,
  so the row never pretends the invoice total was this shift's money.
- **Voids count against the till exactly as refunds do.** Both are reversal rows
  with finalized status, and both hand cash back over the counter.
- **The route stays Admin-only, so the history was composed into the shift screen
  instead.** `/cashier-sessions` is wrapped in `RequireErpAccount role="admin"`, and
  a Cashier reaches their own shift through `ErpHomeView`. Rather than change that
  access rule, `ShiftHistoryView` is rendered inside `CashierSessionView`, so a
  Cashier sees their own past shifts on the home screen and an Admin sees the
  branch's on `/cashier-sessions`. `ShiftHistoryView` takes an optional `branchId`
  so the Admin is never asked which branch twice.
- **The live figures are the same read, polled.** `GET /erp/cashier-sessions/:id`
  refetches every thirty seconds while the shift screen is open. There is no
  separate "live" endpoint or code path.

Deliberately not done: the optional `erp-shifts` PDF report. Nothing else depends
on it, and the shift screen answers the question on-screen today.

---

## 7. Step 4 — Barcodes: print, scan, sell

### The problem

Nothing in the system has a barcode. `erp_products` has no barcode column. Products are
found at the till by typing a name into `ProductPicker`. The receipt prints a QR code
(`receipt.tsx:11-35`, using the `qrcode` package) which the QW2100 **cannot read** — it is a
1D scanner.

`docs/erp-plan.md` §10.1 deferred the printing mechanism "until printer hardware is chosen",
with the default "browser print CSS first, agent only if the hardware demands it". The
hardware is now chosen and browser printing is sufficient.

### What we build

Three things, as decided.

**A. Products carry a barcode and can be sold by scanning.**
**Decided:** when the supplier's box already carries a barcode, the admin scans it while
adding the product and the system keeps that code — no sticker is printed for it. Only a
product with no barcode of its own gets a Capella code and a printed sticker. This is less
printing and less sticking, and it means the same scan works whether the code is ours or the
supplier's, because the lookup is by code and does not care where it came from.

Admin prints label sheets for the products that need them. At the till, scanning drops the
product straight into the sale.

**B. The receipt carries a scannable invoice barcode.**
Scanning a customer's receipt on the refunds or invoices screen opens that invoice.

**C. Booking and queue tickets carry a barcode.** Delivered with Steps 8 and 9; the
mechanism is built here.

### How it works

**Reading.** The QW2100 is a keyboard wedge — it types the digits and presses Enter. A small
hook, `useBarcodeScanner`, listens at the document level and tells a scan from human typing
by the gap between keystrokes (a scanner delivers a whole code in tens of milliseconds). No
driver, no permission prompt, no hardware-specific code. It must ignore keystrokes while the
user is typing in an input, so scanning never corrupts a form.

**Symbology.** **EAN-13** for the codes we generate, using the in-store prefix range
(200–299) so our codes cannot collide with real retail barcodes, with the standard check
digit. A supplier's own code is stored as-is and validated only for length and characters,
since we do not control its format. **Code 128** for invoice numbers and booking codes,
because those are not numeric. All are 1D and all are read by the QW2100 out of the box.

**Printing labels.** An HTML page sized to the label, printed by the browser to the
XP-233B's Windows driver — the same `window.print()` approach `print-sheet.tsx` already uses
for reports. This deliberately avoids sending raw ESC/POS or TSPL bytes: the printer's label
says ESC/POS while this model commonly speaks TSPL, and going through the driver makes that
question irrelevant.

**Label size — 40 × 30 mm, decided as a default and deliberately easy to change.** The exact
roll has not been confirmed yet, so the size lives in **one** exported constant with the
`@page` rule derived from it, rather than being sprinkled through the CSS. Changing it later
is a one-line edit, not a redesign.

**New dependency:** a barcode renderer that emits SVG — `bwip-js` (supports EAN-13 and
Code 128, works without a DOM).

**Selling by scan.** On the sales screen, a scan looks the product up by barcode within the
branch and adds it. Unknown code, inactive product, or zero stock each get a clear message
and a sound-free visual warning; the existing stock rules are untouched.

### Files touched

| File | Change |
|---|---|
| `packages/database/src/schema/erp/catalog/index.ts` | `erpProducts` gains `barcode varchar(32)` nullable, unique per branch, plus a character/length check. A supplier code is stored exactly as scanned |
| `packages/database/migrations/0073_product_barcode.sql` + meta | new |
| `packages/contracts/src/modules/erp/catalog/index.ts` | barcode on product create/update/read; `productBarcodeLookupSchema`; EAN-13 check-digit validation applied only to codes we generate |
| `apps/api/src/modules/erp/stock/*-repository.ts`, `*-service.ts`, `*-router.ts` | store the barcode; `GET /erp/products/by-barcode/:code`; generate a free in-store code on request |
| `apps/pos/src/lib/barcode/use-barcode-scanner.ts` | new — the keyboard-wedge hook |
| `apps/pos/src/lib/barcode/render-barcode.tsx` | new — SVG renderer wrapping `bwip-js` |
| `apps/pos/src/features/products/components/product-label-sheet.tsx` | new — printable label sheet |
| `apps/pos/src/features/products/components/product-stock-view.tsx` | barcode field, generate button, print labels |
| `apps/pos/src/features/products/components/product-picker.tsx` | match a scanned code as well as a typed name |
| `apps/pos/src/features/products/api/products-api.ts` | lookup + generate calls |
| `apps/pos/src/features/sales/components/sales-view.tsx` | scan adds a product line |
| `apps/pos/src/features/sales/components/receipt.tsx` | add a Code 128 invoice barcode beside the existing QR |
| `apps/pos/src/features/sales/components/refunds-view.tsx`, `invoice-history-view.tsx` | scan a receipt to open the invoice |
| `apps/pos/src/lib/barcode/label-size.ts` | new — the single 40 × 30 mm constant the `@page` rule and the label layout both read |
| `apps/pos/src/styles/globals.css` | print rules for the label sheet |
| `apps/pos/package.json` | add `bwip-js` |
| `apps/pos/tests/` | new `use-barcode-scanner.test.ts`, `product-label-sheet.test.tsx`; extend `product-stock-view`, `product-picker`, `sales-view`, `refunds-view` tests |
| `apps/api/tests/erp/` | barcode uniqueness, lookup, check digit |

**Hardware note for the shop:** the QW2100 must be left in its default USB-keyboard mode with
a carriage return suffix — its factory default. The stand-mode barcode on the scanner's own
label is for hands-free scanning and does not affect this.

---

## 8. Step 5 — Reassign the employee on a sold service

### The problem

Today the employee on a service line is chosen while the sale is being built
(`sales-view.tsx:1236`, `LineEmployeeSelect`) and is frozen the moment the sale is posted.
When employee 3 turns out to be busy and employee 4 actually does service 4, there is no way
to record that. The commission goes to the wrong person and the printed invoice names the
wrong person.

Three things stand in the way:

1. `erp_invoice_lines.employee_id` and its name/code snapshots are written once and never
   updated — by design.
2. `erp_commission_ledger_entries` is append-only, with a unique index
   (`erp_commission_ledger_original_line_unique`) allowing exactly **one** `earned` entry per
   invoice line, and a check constraint that a `reversal` entry must point at an invoice
   reversal. A reassignment is not a refund, so the existing shapes do not fit it.
3. Commission is projected into HR payroll per employee per month. Moving commission changes
   two employees' payroll inputs.

### What we build

An admin or cashier opens a completed invoice, picks a service line, chooses a different
present employee, gives a reason, and confirms. The commission moves. The invoice reprints
with the correct name. The original assignment is never erased — it stays visible as history.

### How it works

**Engineering call — overlay, do not overwrite.** `erp_invoice_lines` stays untouched, in
keeping with the rule that invoices are facts. A new table
`erp_invoice_line_reassignments` records each move (line, from employee, to employee,
reason, acting account, timestamp). When the invoice is read, the current performer is the
most recent reassignment for that line, falling back to the original snapshot. The receipt
prints the current performer, and shows the original underneath as "originally assigned to".

**Commission.** Two new ledger entry types, `reassignment_out` (negative, for the employee
losing it) and `reassignment_in` (positive, for the employee gaining it), each pointing at
the reassignment row. The existing check constraint is widened to permit them, and the
unique index is unaffected because neither is an `earned` entry. Both employees' monthly
commission projections are refreshed in the same transaction, exactly as a sale does.

**When payroll is already finalised.** A refund in that situation posts an HR deduction. A
reassignment would need a deduction for one person *and* an increase for the other, and no
"post-payroll commission increase" mechanism exists. **Engineering call: block reassignment
once the month's payroll is finalised for either employee**, with a clear message telling the
admin to use a bonus and a deduction instead. Building a new post-payroll credit path for a
rare correction is not worth the risk to payroll.

**Who may do it — decided: admin and cashier**, matching how voids and refunds already work.
No third user role is created; that would overturn a locked decision in `docs/erp-plan.md` §6
("Admin and Cashier. Nothing else.") and ripple through auth, sessions, both frontends and
the edition matrix.

What makes this safe without a separate role is that nothing is hidden: every reassignment
stores who did it, when, the reason they typed, and both the old and the new employee, and
the original assignment stays visible on the invoice forever. The commission movement is two
ledger entries that can be listed and totalled, not an edit.

**Presence still applies.** The incoming employee must be checked in, the same rule the sale
itself enforces through `assertAssignable`.

### Files touched

| File | Change |
|---|---|
| `packages/database/src/schema/erp/sales/index.ts` | new `invoiceLineReassignments`; widen the ledger entry-type enum and its check constraint |
| `packages/database/migrations/0074_invoice_line_reassignment.sql` + meta | new |
| `packages/contracts/src/modules/erp/sales/index.ts` | `reassignInvoiceLineSchema`; invoice line DTO gains `originalEmployee` and `reassignments[]` |
| `apps/api/src/modules/erp/sales/sale-service.ts` | `reassignLine`; new error codes (`REASSIGN_PAYROLL_FINALIZED`, `REASSIGN_LINE_NOT_SERVICE`, `REASSIGN_SAME_EMPLOYEE`) |
| `apps/api/src/modules/erp/sales/sale-repository.ts` | the transaction: insert the reassignment, append both ledger entries, refresh both payroll inputs, audit; `hydrateInvoice` overlays the current performer |
| `apps/api/src/modules/erp/index.ts`, `apps/api/src/routes/index.ts` | `POST /erp/sales/invoices/:id/lines/:lineId/reassign` |
| `apps/api/src/modules/erp/commissions/commission-repository.ts` | count the new entry types in totals and detail |
| `apps/pos/src/features/sales/components/invoice-receipt-view.tsx` | reassign control per service line |
| `apps/pos/src/features/sales/components/reassign-employee-dialog.tsx` | new |
| `apps/pos/src/features/sales/components/receipt.tsx` | print the current performer; show the original as history |
| `apps/pos/src/features/sales/api/sales-api.ts` | new call |
| `apps/api/tests/erp/sale-service.test.ts`, `sale-repository-mysql.integration.test.ts`, `commission-repository.test.ts` | commission moves, payroll-finalised block, absent-employee block |
| `apps/pos/tests/invoice-receipt-view.test.tsx` | dialog and reprint |

---

## 9. Step 6 — Partial payment on product-only invoices

### The problem

The system is built on the assumption that an invoice is paid in full at the counter.
`docs/erp-plan.md` §7 states it: "Always paid in full at sale. No deposits, tabs,
instalments, or prepaid packages — explicitly out of scope." That assumption is enforced in
four separate places:

| Where | Rule |
|---|---|
| `packages/contracts/.../sales/index.ts` `paymentBreakdownSchema` | payments must sum exactly to the invoice total |
| the same file, `invoiceTotalsSchema` | `paymentTotal` must equal `total` |
| `sale-repository.ts:698` | throws `PAYMENT_TOTAL_MISMATCH` otherwise |
| `erp_invoice_payments` unique index `(invoice_id, method)` | one row per method, so a second cash instalment is impossible |

### What we build

A product-only invoice may be posted with less money than its total. The goods leave
immediately. The balance stays open on that same invoice, and the cashier records further
payments against it later until it reaches zero.

### How it works

**One simplification worth stating.** Because this is restricted to product-only invoices,
and products earn no commission at all, **partial payment touches the commission ledger and
payroll in no way whatsoever.** That removes the single most dangerous area of interaction.

**`erp_invoice_payments` becomes a ledger.** The unique `(invoice_id, method)` index is
dropped so the same method can be tendered repeatedly on different days. The columns added
in Step 3 (`paid_at`, `cashier_session_id`, `acting_account_id`) already make each instalment
attributable to the shift that took it.

**The invoice gains a settlement state**, kept separate from the refund status so the two
never interfere: `amount_paid` and a stored generated `balance_due = total - amount_paid`,
plus a `settlement_status` of `settled` or `open`. A database check enforces
`0 <= amount_paid <= total`, and that a service-bearing invoice is always `settled` — the
products-only restriction is a database invariant, not just a screen rule.

**No minimum down payment — decided.** The cashier may take any amount, including nothing at
all. That single decision breaks four rules that are currently hard-wired into the contracts,
and each has to be relaxed *only* for product-only invoices:

| Today | Change |
|---|---|
| `completeSaleSchema.payments` is `.min(1)` | may be empty on a product-only sale |
| `invoiceSchema.payments` is `.min(1)` | may be empty |
| `invoiceTotalsSchema.paymentTotal` is `positiveMoneySchema` (must exceed zero) | becomes `exactMoneySchema`, so `0.00` is valid |
| `paymentBreakdownSchema` requires payments to equal the total | applies only when the invoice must be settled in full |

A sale taking no money at all is a real event that must still be obvious on screen, so the
confirm dialog says plainly that nothing is being collected and the whole amount will be owed.

**A return by a client who still owes money — decided: the debt is cut first.**

```
Bought 1000, paid 300           -> owes 700
Returns goods worth 500         -> owes 200,  no cash leaves the till
Returns goods worth 900 instead -> debt cleared, 200 handed back in cash
```

So a refund is applied against the outstanding balance before any money moves, and only the
excess is paid out. **Assumption to confirm if it is wrong:** the cash-back-on-excess half was
not stated explicitly; it is the only arithmetic that leaves the books balanced, so the plan
takes it. This makes `amount_paid` and the refund path interdependent — both are recalculated
in the same transaction and the invariant `0 <= amount_paid <= total` is re-checked after every
reversal.

**Other rules that fall out of it and must be enforced:**

- An invoice with any service line must be paid in full. Rejected at the contract, the
  service and the database.
- Cash paid out on a refund may never exceed what the client actually handed over.
- An invoice with an open balance cannot be voided once part of it is paid; it must be
  refunded, so the money movement is recorded.
- The receipt prints amount paid and balance due, and a small slip is printed when a later
  instalment is taken.
- Stock leaves at sale, unchanged.

**Reporting.** Revenue is still recognised on the sale date, so the existing `erp-sales`
report is correct as it stands. What is new is that money received now differs from revenue,
so a new **`erp-receivables`** report lists open balances by client and age.

### Files touched

| File | Change |
|---|---|
| `packages/database/src/schema/erp/sales/index.ts` | drop the payments unique index; `invoices` gains `amountPaid`, generated `balanceDue`, `settlementStatus`, and the three checks |
| `packages/database/migrations/0075_partial_payment.sql` + meta | new — backfill `amount_paid = total`, `settlement_status = 'settled'` for every existing invoice |
| `packages/contracts/src/modules/erp/sales/index.ts` | the four relaxations in the table above; new `recordInvoicePaymentSchema`; totals gain `amountPaid`, `balanceDue`, `settlementStatus` |
| `apps/api/src/modules/erp/sales/sale-service.ts` | `recordPayment`; new errors (`PAYMENT_EXCEEDS_BALANCE`, `PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES`, `INVOICE_NOT_VOIDABLE_WHEN_PARTIALLY_PAID`) |
| `apps/api/src/modules/erp/sales/sale-repository.ts` | allow a short or zero payment on a product-only sale; the `recordPayment` transaction; a refund reduces the balance first and pays out only the excess; hydrate the new fields |
| `apps/api/src/routes/index.ts` | `POST /erp/sales/invoices/:id/payments` |
| `apps/api/src/modules/erp/erp-reports/erp-report-reader.ts`, `erp-report-repository.ts` | the `erp-receivables` report |
| `packages/contracts/src/modules/reports/index.ts` | add `erp-receivables` to `erpTabReportTypes` |
| `apps/pos/src/features/sales/components/sales-view.tsx` | allow a short or zero payment when the basket is products only; show the balance clearly; the confirm dialog states what is being left unpaid |
| `apps/pos/src/features/sales/components/invoice-receipt-view.tsx` | balance panel + "record a payment" |
| `apps/pos/src/features/sales/components/record-payment-dialog.tsx` | new |
| `apps/pos/src/features/sales/components/payment-receipt.tsx` | new — instalment slip |
| `apps/pos/src/features/sales/components/receipt.tsx`, `invoice-history-view.tsx` | show paid / balance |
| `apps/pos/src/features/sales/offline-sale-queue.ts`, `offline-sale-sync.ts` | carry the paid amount through the offline queue |
| `apps/pos/src/features/erp-reports/components/erp-reports-view.tsx` | the new report tab |
| `apps/api/tests/erp/*`, `apps/pos/tests/*` | short and zero payment allowed only without services; instalments; the 1000/300/500 return worked example and the return-exceeds-debt case; void block; offline replay |

---

## 10. Step 7 — Sales screen restyle to one full page

### The problem

`apps/pos/src/features/sales/components/sales-view.tsx` is 1,488 lines and lays the sale out
as five numbered steps stacked in a column capped at `max-w-2xl`, widening to two columns on
a large screen (`sales-view.tsx:1127`). On a till screen the cashier scrolls to reach the
items list, scrolls again for the total, and scrolls back up to fix a line.

### What we build

One screen that fits the viewport with no page scrolling: `100dvh`, three columns on a till
display, each column scrolling internally only when its own content overflows.

```
+-----------------+--------------------------+------------------+
| client          | services + products      | totals           |
| cashier         | (pickers on top,         | discount / tax   |
| default employee|  the basket fills the    | payment methods  |
|                 |  rest and scrolls alone) | balance          |
|                 |                          | [ complete ]     |
+-----------------+--------------------------+------------------+
```

The complete button is always visible without scrolling. Below the till width the layout
falls back to today's single column, so a phone or tablet still works.

### What must not break

This file carries a lot of hard-won behaviour that a restyle can quietly destroy. All of it
must survive:

- the offline sale queue and its warning notices;
- draft save/restore across tabs (`sale-draft-storage.ts`) and single-tab ownership;
- pending-sale recovery after an ambiguous network result, and the reuse of the same
  idempotency key;
- the `fieldset disabled` lock while a sale is in flight;
- dropping a line's employee when they check out mid-sale (`LineEmployeeSelect`);
- the print flow after completion;
- the admin branch picker staying in place;
- the 44 px touch targets on the quantity buttons;
- Arabic RTL, the numbered-step labels, and screen-reader announcements.

**Engineering call:** split the file while restyling. At 1,488 lines it is the largest file
in the POS and the restyle will not be reviewable otherwise. The state machine stays in one
place; the panels become their own components.

### Files touched

| File | Change |
|---|---|
| `apps/pos/src/features/sales/components/sales-view.tsx` | reduced to state, data fetching, submission and layout |
| `.../components/sale-client-panel.tsx` | new — client, cashier, default employee |
| `.../components/sale-basket-panel.tsx` | new — pickers and the line list |
| `.../components/sale-totals-panel.tsx` | new — discount, tax, payments, balance, complete |
| `.../components/sale-line-row.tsx` | new — one line, extracted from the inline markup |
| `apps/pos/src/app/(protected)/layout.tsx` | let a page opt out of the scrolling shell |
| `apps/pos/src/styles/globals.css` | full-height layout tokens |
| `apps/pos/tests/sales-view.test.tsx` | split alongside the components; add a no-page-scroll assertion |
| `apps/pos/tests/e2e/cashier-sale.spec.ts`, `offline-sale.spec.ts`, `receipt-failure.spec.ts` | update selectors; verify the button is visible without scrolling |

---

## 11. Step 8 — Live per-service queue

### The problem

Nothing like this exists. A client buying three services has no recorded position in any of
them, so "I was here first" cannot be answered.

### What we build

Each service has its own waiting line, per branch, per day. When a sale is completed, the
client joins the line for every service on it and receives a position number in each — the
numbers are independent, so the same client can be 4th for one service and 1st for another.
Staff see every service's line on one screen and mark people as being served, finished, or
skipped.

### How it works

**Numbering.** A counter table keyed by branch + business date + service, following the
existing `erp_invoice_daily_sequences` pattern, allocated inside the sale's transaction so
two tills cannot hand out the same number. Numbers restart each day per branch per service.
Gaps from rolled-back transactions are acceptable, exactly as with invoice numbers.

**States.** `waiting → serving → done`, with `skipped` and `cancelled` as terminal states.
Skipping is recorded, not deleted, so an argument about who was skipped has an answer.

**Where a ticket comes from.** Completed sales create tickets automatically. Step 9's
bookings create them on arrival. A staff member can also add someone by hand.

**Business date** uses the existing Cairo calendar helper
(`apps/api/src/modules/erp/cairo-calendar.ts`), so the day boundary matches invoices and
reports.

**No separate ticket — decided.** The queue positions print on the sale receipt the client is
already handed, in a block under the totals:

```
-------------------
YOUR TURN
  Hair colour ....... 4
  Manicure .......... 1
  Facial ............ 10
-------------------
```

This removes a whole printing path, a second piece of paper, and the risk of the two slips
being separated. The receipt already carries the invoice barcode added in Step 4, so a staff
member can still scan the client's paper to find them.

One consequence to design around: the numbers must be allocated **before** the receipt is
rendered, which is why ticket creation belongs inside the sale transaction rather than in a
job that runs afterwards.

**Live updates** by polling, consistent with the rest of the POS. No websockets are
introduced for this.

### Files touched

New module `erp-queue`, following the `erp-transfers` module as its template.

| File | Change |
|---|---|
| `packages/database/src/schema/erp/queue/index.ts` | new — `erpServiceQueueEntries`, `erpServiceQueueSequences` |
| `packages/database/src/schema/erp/index.ts` | export it |
| `packages/database/migrations/0076_service_queue.sql` + meta | new |
| `packages/contracts/src/modules/erp/queue/index.ts` | new |
| `packages/contracts/src/modules/erp/index.ts` | export it |
| `packages/contracts/tests/modules/erp/queue/queue-contracts.test.ts` | new |
| `packages/config/src/edition.ts` | register `erp-queue` (requires `erp-sales`, `erp-catalog`) and add it to the `erp` and `full` editions |
| `packages/config/tests/edition.test.ts` | update |
| `apps/api/src/modules/erp/queue/{queue-service,queue-repository,queue-router,queue-module,index}.ts` | new |
| `apps/api/src/modules/erp/index.ts` | export it |
| `apps/api/src/modules/erp/sales/sale-repository.ts` | create tickets inside the sale transaction, through the queue module's public capability |
| `apps/api/src/app.ts`, `routes/index.ts`, `runtime/api-runtime.ts` | wire it |
| `apps/pos/src/app/(protected)/queue/page.tsx` | new |
| `apps/pos/src/features/queue/{api/queue-api.ts,components/queue-board-view.tsx,query-keys.ts,index.ts}` | new |
| `apps/pos/src/features/sales/components/receipt.tsx` | print the "your turn" block under the totals |
| `packages/contracts/src/modules/erp/sales/index.ts` | the invoice DTO carries each service line's queue position |
| `apps/pos/src/components/shell/nav.ts`, `erp-home-view.tsx` | add the entry |
| `apps/api/tests/erp/queue-{service,router}.test.ts`, `queue-mysql.integration.test.ts` | new |
| `apps/pos/tests/queue-board-view.test.tsx` | new |
| `apps/pos/tests/e2e/queue.spec.ts` | new |

---

## 12. Step 9 — Customer booking

### The problem

`docs/erp-plan.md` §7 records "Appointments — **Out of scope**". That decision is now
reversed. There are no booking tables, endpoints or screens. The one hint of foresight is a
comment in `packages/database/src/schema/erp/clients/index.ts` noting that "a booking only a
number" is a valid client — clients can already exist with just a phone number, which is
exactly what a phone booking gives you.

### What we build

A staff-only appointment book inside the POS. Admin or cashier records: client, one or more
services, optionally a preferred employee per service, a date and time, and a note. Statuses
run `booked → arrived → converted` with `cancelled` and `no_show` as the other endings. When
the client arrives, one button turns the booking into a sale with everything prefilled.

No public page and no deposit — both explicitly excluded.

### How it works

**Two tables.** `erp_bookings` holds the branch, client, scheduled time, status, note,
acting account, and the invoice it became. `erp_booking_services` holds one row per service,
with an optional preferred employee.

**Conversion is a handover, not a second sale path.** The booking does not post an invoice
itself. Pressing "arrived" opens the existing sales screen with the client and lines already
filled, and the cashier completes the sale exactly as always. The booking is stamped
`converted` with the resulting invoice id inside that sale's transaction. This keeps the one
sale path, the one commission path, and the one stock path that the system already trusts.

**Preferred employee is a preference, not a promise.** The person may not be checked in when
the client arrives. The sales screen already refuses to sell a service assigned to an absent
employee, and the booking must not weaken that rule — so the preferred employee is prefilled
only if they are present, and the cashier picks someone else otherwise.

**The screen is one day at a time — decided.** You pick a date and see that day's
appointments in time order, like a diary page, with arrows to step between days:

```
Sunday 24 August                     [<]  [>]

10:00   Mona Ahmed
        Hair colour, Blow dry
        with Sara                    [ arrived ]

11:30   Nour Hassan
        Manicure                     [ arrived ]

13:00   Heba Ali
        Facial                       [ arrived ]
```

A week grid with staff as columns was considered and rejected: it reads badly on a till
screen and costs noticeably more to build, for a shop that is not managing overlapping
diaries.

**No double-booking rules.** With no public page, staff manage their own diary. Adding slot
availability later is possible but is not built now.

**Overdue bookings** are shown in a "did not arrive" list rather than auto-cancelled; a
person decides.

**Reminders** are out of scope for this step. If WhatsApp reminders are wanted later, say so
— it is a separate integration.

### Files touched

New module `erp-bookings`.

| File | Change |
|---|---|
| `packages/database/src/schema/erp/bookings/index.ts` | new — `erpBookings`, `erpBookingServices` |
| `packages/database/src/schema/erp/index.ts` | export it |
| `packages/database/migrations/0077_bookings.sql` + meta | new |
| `packages/contracts/src/modules/erp/bookings/index.ts` | new |
| `packages/contracts/src/modules/erp/index.ts` | export it |
| `packages/contracts/tests/modules/erp/bookings/booking-contracts.test.ts` | new |
| `packages/config/src/edition.ts` | register `erp-bookings` (requires `erp-clients`, `erp-catalog`, `erp-sales`); add to `erp` and `full` |
| `packages/config/tests/edition.test.ts` | update |
| `apps/api/src/modules/erp/bookings/{booking-service,booking-repository,booking-router,bookings-module,index}.ts` | new |
| `apps/api/src/modules/erp/index.ts` | export it |
| `apps/api/src/modules/erp/sales/sale-repository.ts` | stamp the booking as converted inside the sale transaction |
| `apps/api/src/app.ts`, `routes/index.ts`, `runtime/api-runtime.ts` | wire it |
| `apps/api/src/modules/employees/…` | the termination pre-check from Step 2 reads future bookings |
| `apps/pos/src/app/(protected)/bookings/page.tsx` | new |
| `apps/pos/src/features/bookings/{api/bookings-api.ts,components/bookings-view.tsx,components/booking-form.tsx,components/booking-ticket.tsx,query-keys.ts,index.ts}` | new |
| `apps/pos/src/features/sales/components/sales-view.tsx` | accept a booking id and prefill from it |
| `apps/pos/src/components/shell/nav.ts`, `erp-home-view.tsx` | add the entry |
| `apps/api/tests/erp/booking-{service,router}.test.ts`, `booking-mysql.integration.test.ts` | new |
| `apps/pos/tests/bookings-view.test.tsx` | new |
| `apps/pos/tests/e2e/bookings.spec.ts` | new |

**Optional:** an `erp-bookings` report type for no-show and conversion rates.

---

## 13. Locked decisions these changes overturn

`docs/erp-plan.md` must be revised when this work lands, or it stops being the source of
truth. The rows in its §7 table that are now wrong:

| Decision in §7 | New reality | Step |
|---|---|---|
| "Appointments — **Out of scope**" | A staff-only appointment book exists | 9 |
| "Payment timing — **Always paid in full at sale.** No deposits, tabs, instalments" | Product-only invoices may carry an open balance | 6 |
| "Cashier sessions — Open/close recorded (**who + when only**)" | A shift now reports its money, sales and duration. Still no cash-drawer counting — the drawer stays trusted | 3 |
| "Voids & refunds — …" (refund implicitly returns to the original tender) | The cashier chooses the methods freely | 1 |
| §8 "the employee is fixed per invoice" | Already false — assignment is per line — and now correctable after the fact | 5 |
| §10.1 "Thermal printing mechanism — deferred until printer hardware is chosen" | Hardware chosen: XP-233B labels and QW2100 scanning, both through the browser | 4 |

Also stale, from work already delivered before this plan: §7 "Employee assignment — one
employee per invoice", §7 "Stock operations — **no** inter-branch transfers", and §7
"Categories — one table with a type flag" (expenses no longer have categories).

**`docs/architecture.md` is stale in full** and should either be regenerated or deleted; it
describes a folder layout that no longer exists.

---

## 14. Defects found while reading

Reported because the repository's working instructions require flagging problems noticed in
passing, not because they were asked for.

1. **`employee_outstanding_debts.settled_at` is a dead column.** It is defined in
   `packages/database/src/schema/payroll/index.ts:135` and appears nowhere else in the
   repository except migration snapshots. A debt recorded when an employee leaves can never
   be marked as paid. Fixed by Step 2.

2. **`erp_branch_cashier_roster` keeps rows for deactivated employees.** Roster cleanup runs
   only when an employee changes branch (`employees-repository.ts:126-141`), not when they
   are deactivated. This is **not** currently a bug — every read filters on
   `employment_status = 'active'` (`branch-cashier-roster-repository.ts:23`) — but the stale
   rows will reappear if a future query forgets that filter. Worth tidying in Step 2.

---

## 15. Still open

Everything else has been decided. Three items remain, none of which block starting work.

1. **Label size.** Building at 40 × 30 mm by owner's instruction ("use the default, I can
   change it"). Kept in one constant so a different roll is a one-line edit. Confirm the roll
   whenever convenient.
2. **Cash back when a return is worth more than the debt.** The owner confirmed that a
   return reduces the outstanding balance first. The plan pays out the excess in cash when
   the return is worth more than what is still owed, because no other arithmetic balances —
   but that half was inferred, not stated. Worth a yes before Step 6 is built.
3. **Booking reminders.** Out of scope as planned. Say if WhatsApp or SMS reminders are
   wanted — a separate integration with its own cost.
