# Booking up-front payments, partial visits & bookings report — implementation handoff

Status: **spec agreed with the product owner (2026-10-06)**. Read the whole file before coding.
Follow `AGENTS.md` (baseline green first, red/green TDD in small slices, sequential commands,
no commits unless asked, ask when unsure). Tick the tracker (§9) as you finish each item.

---

## 1. Agreed business spec (do not change without asking the user)

Example: booking on the 20th with services A + B + C (total 600).

1. **Up-front payments (before services)** — any number of times (100, 100, 200…), any method
   (`cash | visa | instapay | vodafone_cash`). The held balance may **never exceed the value of the
   booking's still-pending services**. Requires an **open cashier shift**; money counts in the drawer,
   shift totals and reports.
2. **Client arrives any day (e.g. 15th)** → status `arrived`. Cashier sells **only today's services**
   (e.g. A + B). Up-front money is **used first, automatically**; the rest of the invoice is paid in
   full (existing rule: service invoices must be fully paid). Sold services are tracked by the
   **existing service queue** (pending → in_progress → completed). After the sale the cashier
   **must** choose for the leftover services (C): **keep on original date / move to new date / cancel**.
3. **Cancel a service, cancel the booking, or no-show** → if held money > value of what remains,
   the cashier sees "Return X to the client" and confirms. **Always a full refund** of the excess,
   **out of the open shift's drawer**. Leftover becomes exactly what the remaining services are worth
   (0 when nothing remains). No "keep/forfeit" option exists.
4. **Shift close is blocked** (normal cashier close only) while, in that branch:
   - a booking's `scheduled_at` has **passed** and it still has `pending` services
     (client never came → cashier marks no-show or cancels);
   - a booking holds **more money than its pending services are worth** (safety net, e.g. after a
     checkout discount or a price change).
5. **One booking → several invoices.** Each booked service remembers the invoice/line that sold it.
6. **Money in reports**: payment-methods report and shift totals include up-front payments and
   their refunds. Up-front money **applied at checkout is NOT counted again**; the invoice shows it as
   "مدفوع من المقدم".
7. **New Bookings report** (tab + Excel export like the others): date, client, status, services
   sold/cancelled/pending, paid up-front, used in invoices, refunded, still held, invoice numbers.
8. **Delete booking** is blocked once any money row or sold service is attached.

Facts verified: production has **zero** rows in `erp_bookings` (checked 2026-10-06), so no legacy
data rules are needed — but the migration must still be correct for dev/test DBs that have rows.

## 2. Open questions — ask the user BEFORE the phase that needs them

| # | Question | Needed in | Recommendation to propose |
|---|---|---|---|
| Q1 | Services can have **no fixed price** (`erp_services.price` is nullable; price typed at the till). How is the payment cap computed then? | P3 | Open-price services count as 0 toward the cap (deposits only up to fixed-price total). |
| Q2 | A booking invoice is **voided/refunded** later. Should its services go back to `pending` on the booking, and where does the up-front portion go? | P4 | Services stay `sold`; the up-front portion is handed back from the drawer like any refund (cashier picks method). |
| Q3 | A booking stays `arrived` with pending services (cashier skipped the "leftover" choice). Block shift close for that too, even if the date hasn't come? | P6 | Yes — `arrived` + pending services blocks close (the choice is mandatory). |

Do not guess these. Ask in plain, simple language with one short example each.

## 3. Current state (what exists today)

- `packages/database/src/schema/erp/bookings/index.ts` — `erp_bookings` (status enum
  `booked|arrived|converted|cancelled|no_show`, **single `invoice_id` + unique index**),
  `erp_booking_services` (no status, unique `(booking_id, service_id)`).
- `packages/contracts/src/modules/erp/bookings/index.ts` — schemas + `bookingDtoSchema`
  (has `invoiceId`, services without state).
- `apps/api/src/modules/erp/bookings/booking-service.ts|booking-repository.ts|booking-router.ts`.
  `allowedFrom` transitions: arrived←booked, booked←arrived, cancelled←booked/arrived,
  no_show←booked (only after `scheduled_at`). **No date check on `arrived`** (correct, keep).
  `convert()` requires the sale's service ids to **exactly equal** the booked ones → must change.
- Sale flow: `sale-service.ts` (`complete`, `bookingHandover` → `bookings.convert` inside the sale
  transaction via `afterInvoice`), `sale-repository-complete.ts` (locks session, account, employees;
  inserts invoice, lines, **queue entries**, commission, `erp_invoice_payments`),
  `sale-repository-read.ts` (`findByIdempotencyKey` rebuilds the original input from DB rows and uses
  `erpBookings.invoiceId` to find `bookingId`), `sale-repository-reverse.ts` (void/refund).
- Rule: `PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES` — service invoices must be paid in full.
- Shift: `cashier-sessions-repository.ts` (`moneyBySession`, `readReportAccounting`, `listInvoices`,
  `close` blocks on unfinished queue services → `ERP_CASHIER_SESSION_UNFINISHED_SERVICES`),
  `cashier-sessions-service.ts`. `autoCloseExpired` and admin `recoveryClose` **never block** — keep
  it that way for the new rule too.
- Reports: type list in `packages/contracts/src/modules/reports/index.ts` (`erpTabReportTypes`) **and**
  a DB enum in `packages/database/src/schema/reports/index.ts`; API in
  `apps/api/src/modules/erp/erp-reports/*` (reader metadata, `factsFor`, `summaryProjection`,
  `moneySummaryKeys`, localization); POS `apps/pos/src/features/erp-reports/components/erp-reports-view.tsx`
  (labels map + tab groups). There is **no bookings report** today.
- POS: `features/bookings/components/bookings-view.tsx` (diary, status buttons, "بدء البيع" link to
  `/sales?bookingId=`), `features/sales/components/use-booking-prefill.ts` (prefills **all** booked
  services), `use-sale-workspace-checkout.ts` (builds payments, sends `bookingId`),
  offline queue `features/sales/offline-sale-queue.ts|offline-sale-sync.ts`,
  `features/cashier-sessions/components/cashier-session-view.tsx` (shows unfinished-services close error),
  `shift-money.tsx`, `shift-ending-report.tsx`, `shift-detail-view.tsx`, `lib/erp-cache.ts`.
- Existing dead UI branch: delete dialog text for `invoiceId !== null` in `bookings-view.tsx` can never
  show (delete is refused when an invoice exists). Replace it with the new rules.

## 4. Target design

### 4.1 Database (one drizzle migration, next number after `0114_stock_batch_expiry`)

Generate with `pnpm --filter @capella/database db:generate` then **review the SQL by hand**
(composite FKs, checks, enum changes). Keep naming style (`erp_<table>_<what>`).

1. `erp_booking_services` add:
   - `status` enum `('pending','sold','cancelled')` not null default `'pending'`
   - `invoice_id` int null, `invoice_line_id` int null, `changed_at` timestamp(3) null
   - FK `(invoice_id, branch_id)` → `erp_invoices(id, branch_id)`; FK `invoice_line_id` → `erp_invoice_lines(id)`
   - check: `(status='sold') = (invoice_id is not null and invoice_line_id is not null)`
   - unique `invoice_line_id` (one booked service per invoice line).
2. `erp_bookings`: **drop** `invoice_id`, its FK `erp_bookings_invoice_branch_fk` and unique
   `erp_bookings_invoice_unique` — but first **backfill** in the same migration:
   services of bookings that have `invoice_id` → `status='sold'`, `invoice_id`, matching
   `invoice_line_id` (join invoice lines on service_id). Drop FK before index (MySQL requirement).
3. New `erp_booking_payments` (money ledger of the booking):
   `id, booking_id, branch_id, kind enum('payment','refund'), method enum(erpPaymentMethods),
   amount decimal(14,2) >0, refund_cause enum('service_cancelled','booking_cancelled','no_show',
   'checkout_excess') null, cashier_session_id NOT NULL, acting_account_id, operation_reference
   varchar(36), created_at`.
   FKs: `(booking_id, branch_id)` → bookings, `(cashier_session_id, branch_id)` → cashier sessions,
   account. Unique `(booking_id, operation_reference)` (idempotency). Index `(cashier_session_id, created_at)`,
   `(branch_id, created_at)`. Check: `(kind='refund') = (refund_cause is not null)`.
4. `erp_invoice_payments`: method enum becomes `invoicePaymentMethods = [...erpPaymentMethods,
   'booking_credit']` (**new separate const — do NOT add it to `erpPaymentMethods`**, which is also used
   by reversal payments, drawers and inputs). Add `booking_id` int null + FK `(booking_id)` → bookings and
   check `(method='booking_credit') = (booking_id is not null)`.
5. Reports enum in `schema/reports/index.ts`: add `'erp-bookings'`.

**Derived money (single source of truth, never stored):**
`paid = Σ payment`, `refunded = Σ refund`, `applied = Σ invoice_payments.amount where booking_id = X`,
`held = paid − refunded − applied`, `pendingValue = Σ current erp_services.price of pending services`
(see Q1 for null price), `maxPayable = pendingValue − held` (≥ 0), `excess = max(0, held − pendingValue)`.

### 4.2 Contracts (`packages/contracts`)

- Bookings: `bookingDtoSchema` → remove `invoiceId`; services get `status`, `invoiceId`,
  `invoiceNumber`, `queueStatus` (from queue entry of the line, null when not sold); add
  `money: { paid, refunded, applied, held, pendingValue, maxPayable, excess }` (exact money strings).
- New commands: `recordBookingPaymentSchema {branchId?, cashierSessionId, method, amount, operationReference(uuid)}`;
  `cancelBookingServicesSchema {branchId?, serviceIds[] min1, refund?: {cashierSessionId, payments[{method, amount}], operationReference}}`;
  `rescheduleBookingSchema {branchId?, scheduledAt}`; status update for `cancelled|no_show` gains the
  same optional `refund` block. Refund `payments` must sum **exactly** to the server-computed excess.
- Sales: `completeSaleSchema` add `bookingCredit: exactMoney` optional — only allowed with `bookingId`
  (superRefine). Stored invoice payment schema (`storedInvoicePaymentSchema` in
  `invoice-contracts.ts`) must accept `'booking_credit'` → introduce `invoicePaymentMethodSchema`;
  **input** `paymentSchema` keeps the 4 real methods (a cashier can never type `booking_credit`).
- Cashier sessions: report/detail gain `bookingPayments` and `bookingRefunds` totals + lines
  (booking id, client, method, amount, at). New error code `ERP_CASHIER_SESSION_UNRESOLVED_BOOKINGS`.
- Reports: add `'erp-bookings'` to `erpTabReportTypes`.

### 4.3 API — bookings module

- `POST /erp/bookings/:id/payments` — lock order: **cashier session row → booking row (FOR UPDATE)**
  (same order as the sale transaction, to avoid deadlocks). Validate: session open, not past 16h
  (copy the `gt(openedAt, now − CASHIER_SESSION_MAX_DURATION_MS)` guard), cashier owns it (admin may use any
  open session of the branch), booking status `booked|arrived`, `amount ≤ maxPayable`. Idempotent on
  `operationReference` (same ref + different body → conflict). Audit `record_payment`.
- `POST /erp/bookings/:id/services/cancel` — pending → cancelled for the given ids; recompute
  `excess`; if `excess > 0` the request **must** carry `refund` with payments summing exactly to it
  (else 409 `BOOKING_REFUND_REQUIRED` returning the amount), insert refund rows with cause
  `service_cancelled`. If no pending remain → finalize status (`converted` if any sold, else `cancelled`).
- `PATCH /erp/bookings/:id/status` `cancelled|no_show` — cancels all pending services, same refund
  rule (cause `booking_cancelled|no_show`). Final status: `cancelled`/`no_show` when nothing was sold,
  otherwise `converted`. Keep the `no_show` "only after scheduled_at" guard.
- `PATCH /erp/bookings/:id/schedule` — reschedule pending booking (`booked|arrived` → `booked`, new
  `scheduled_at`). Used by the post-sale "move to new date" choice. "Keep on original date" = status
  `booked` without changing the date (reuse status endpoint, `arrived → booked`).
- `DELETE` — refuse when any `erp_booking_payments` row or any `sold` service exists.
- `convert()` (called inside the sale transaction) → rename to `applySale()`:
  booking status must be `arrived`; invoice service lines must be a **non-empty subset of the
  booking's pending services**, each service at most once, quantity 1 (unbooked services still
  rejected, as today; products allowed). Mark them `sold` with `invoice_id`/`invoice_line_id`.
  If no pending remain → `converted`; else stays `arrived` (UI forces the leftover choice).
- All mutations write audit records (module `erp-bookings`) and return the hydrated DTO.

### 4.4 API — sales integration (the risky part)

- The booking row must be **locked and the credit validated BEFORE payments are inserted**
  (today the booking hook runs in `afterInvoice`, after payments). Add a pre-insert hook or pass the
  booking capability into `complete`; keep lock order session → account → employees → booking.
- Rule "used first": `bookingCredit` must equal `min(held, invoice total)`; otherwise 409
  `BOOKING_CREDIT_MISMATCH` ("المبلغ المقدم تغيّر، حدّث الصفحة"). `payments + bookingCredit` must equal the
  total for service invoices (update both `PAYMENT_TOTAL_MISMATCH` and
  `PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES` checks to include the credit).
- Insert credit as an `erp_invoice_payments` row: `method='booking_credit'`, `booking_id`,
  `is_initial=true`, sale session/account/time. `amount_paid` includes it.
- **Checkout excess is returned by the sale itself** (`checkout_excess` rows in `erp_booking_payments`):
  a discount makes the invoice worth less than the client paid up front, and a booking that ends up
  fully sold has no later refund path — only an automatic or recovery close would ever end that
  shift. Excess = `max(0, (held − bookingCredit) − value of the pending services NOT in this sale)`
  — money still covering leftover services stays held. When excess > 0 the request must carry
  `bookingRefund: { payments[] }` summing exactly to it (else 409 `BOOKING_REFUND_REQUIRED`, then
  `BOOKING_REFUND_AMOUNT_MISMATCH`), the same rule the cancel paths use; a `bookingRefund` sent when
  excess is 0 is refused with `BOOKING_REFUND_AMOUNT_MISMATCH`. Methods must be distinct
  (max 4). **Idempotency trap:** `bookingRefund` is part of the request, so `reconstructInput` must
  rebuild it or every retry conflicts — the refund rows are keyed by the sale's own
  `idempotencyKey` (with the usual `-2`, `-3` suffix for split methods) precisely so that lookup is
  exact.
- **Idempotency trap:** `findByIdempotencyKey` rebuilds `input.payments` from initial payment rows and
  compares with `isDeepStrictEqual`. Exclude `booking_credit` rows from `payments` and rebuild
  `bookingCredit` from them; find `bookingId` via `erp_booking_services.invoice_id` (the old
  `erpBookings.invoiceId` column is gone). Otherwise every retry returns `IDEMPOTENCY_CONFLICT`.
- **Void trap:** `reverse()` builds void payments from **all** invoice payments by method; a
  `booking_credit` method would be written into `erp_invoice_reversal_payments.method_snapshot`
  (enum without it) → SQL error. Handle per Q2 (default: hand it back as a drawer refund).
- **Refund quote:** `quoteRefund` iterates `paymentMethodSchema.options` (4 methods) — keep
  `booking_credit` out of refundable-by-method offers but make sure totals still add up.
- `sale-repository-payment.ts` (`recordPayment`) — unaffected (service invoices can't take instalments).

### 4.5 API — cashier shifts

- `moneyBySession`: `taken` must **exclude** `method='booking_credit'` invoice payments and **add**
  booking `payment` rows by method; `refunded` adds booking `refund` rows by method. Same in
  `listInvoices.takenInShift` (exclude credit). `CashierSessionMoneyByMethod` stays 4 keys — a 5th key
  leaking in breaks `sumMethods`/contracts.
- `readReportAccounting`: add booking payment/refund totals + lines; `creditSales` keeps counting the
  credit as paid (it is an initial payment) — verify with a test.
- `close()`: inside the transaction, before closing, count bookings of the branch where
  (a) status in `booked|arrived`, `scheduled_at <= closedAt`, has a `pending` service; or
  (b) `held > pendingValue`; (c) per Q3. Return `{kind:'unresolved_bookings', count}` → service throws
  `ERP_CASHIER_SESSION_UNRESOLVED_BOOKINGS` ("يجب معالجة N حجز قبل إغلاق الوردية"). Do **not** add it to
  `autoCloseExpired`/`recoveryClose`.

### 4.6 API — reports

- `paymentFacts`: exclude `method='booking_credit'`; `UNION ALL` booking payments (`eventType
  'booking_payment'`, `+amount`) and refunds (`'booking_refund'`, `−amount`), ids prefixed
  `booking-payment-<id>` / `booking-refund-<id>` (ids must stay unique across the union). Localize the
  new event types in `erp-report-localization.ts`.
- New `'erp-bookings'` report: one row per booking, filtered by `scheduled_at` (timestamp filter),
  branch filter, search on client name/phone. Columns: id, scheduledAt (eventDate), branchName,
  clientName, clientPhone, status (localized), servicesTotal, servicesSold, servicesCancelled,
  servicesPending, paid, applied, refunded, held, invoiceNumbers (GROUP_CONCAT — the session
  `group_concat_max_len` is already raised in `erp-report-repository.ts`). Summary: count + money sums
  (add keys to `moneySummaryKeys`). Register in `factsFor`, `summaryProjection`, reader `metadata`.
- `invoiceSummary` in `erp-report-repository.ts` concatenates payments → label `booking_credit`.

### 4.7 POS

- **Bookings diary card**: per service show state chip (لم تبدأ / قيد التنفيذ / تمت / ملغاة) — not-started
  for `pending`, queue status for `sold`; per-service "إلغاء الخدمة" for pending ones.
  Money strip: مدفوع مقدم / مستخدم / مسترد / المتبقي لدينا, plus "دفع مقدم" button (disabled when
  `maxPayable = 0` or no open shift — read current shift via cashier-sessions API).
- **Payment dialog**: method + amount (max = `maxPayable`), uuid `operationReference` generated once per
  dialog open (retries reuse it).
- **Refund confirm dialog** (cancel service / cancel booking / no-show): shows "سيتم رد X للعميل من
  الدرج", method selector (default cash, can split), sends `refund`; handle `BOOKING_REFUND_REQUIRED`
  by reopening with the server amount.
- **Sales workspace** (`use-booking-prefill.ts`): prefill only `pending` services and let the cashier
  remove some (at least one booked service must stay); show "مدفوع من المقدم: X" and reduce the amount
  to collect by `min(held, total)`; send `bookingCredit`. When `held > total` the workspace must also
  show "سيتم رد X للعميل من الدرج" (X per the §4.4 excess rule, not simply `held − total`) with a method selector (distinct methods, default cash) and send
  `bookingRefund` with the sale; handle `BOOKING_REFUND_REQUIRED` by reopening with the server amount.
  Booking sales **must not go to the offline
  queue** (credit can change) — or, if they do, surface `BOOKING_CREDIT_MISMATCH` clearly in pending-sale
  recovery. Check `use-sale-workspace-checkout.ts` + `offline-sale-sync.ts`.
- **After a booking sale** with pending services left: non-dismissable dialog: إبقاء في الموعد الأصلي /
  تغيير الموعد (date-time picker) / إلغاء الخدمات المتبقية (→ refund dialog if excess).
- Invoice view/receipt (`invoice-format.ts`, `invoice-receipt-view.tsx`, `sale-primitives.tsx`): label
  `booking_credit` = "مدفوع من المقدم"; it must not be offered as a selectable method anywhere.
- **Shift screens**: show booking payments/refunds in `shift-money.tsx`, `shift-ending-report.tsx`,
  detail; close error `ERP_CASHIER_SESSION_UNRESOLVED_BOOKINGS` with a link to `/bookings`.
- **Reports**: add `'erp-bookings': 'تقرير الحجوزات'` label and put it in a tab group.
- Invalidate caches (`lib/erp-cache.ts`, `bookingQueryKeys`, cashier-session keys) after every money action.

## 5. Traps & mistakes to avoid

1. Counting up-front money twice (once at deposit, again as an invoice payment) in shift totals,
   payment-methods report, `listInvoices`. Grep every `invoicePayments`/`erp_invoice_payments` use
   (8 files in `apps/api/src`) and decide include/exclude explicitly.
2. Adding `booking_credit` to `erpPaymentMethods` / `paymentMethodSchema` — breaks drawers, inputs,
   reversal enum. Use separate consts.
3. Idempotent replay mismatch (§4.4). Write a test: same request twice → same invoice, no conflict.
4. Lock order / races: two cashiers paying the same booking concurrently, or paying while a sale
   applies credit → cap must hold under `FOR UPDATE`. Add a concurrency integration test like
   `sale-repository-completion-concurrency-mysql.integration.test.ts`.
5. Money math only with the existing cent helpers (`toCents`, `signedMoney`, `sumMoney`) — never floats.
6. Full refund must equal the **server-computed** excess exactly; never trust the client amount.
7. Refunds need an **open shift** (user: "affects the drawer") — unlike invoice refunds, no admin
   no-shift path. Error clearly when no shift is open.
8. `no_show` before `scheduled_at` stays forbidden; `arrived` stays allowed any day.
9. Status semantics after partial sale + later cancel/no-show → `converted` (something was sold).
10. Dropping `erp_bookings.invoice_id` breaks: `sale-repository-read.ts` (bookingId lookup), booking
    hydrate/listDay, `remove`, contracts DTO, POS delete dialog, tests and `booking-mysql.integration.test.ts`.
11. Report enum lives in **two** places (contracts + DB) — missing the DB enum makes exports fail at insert.
12. Shift-close check must use the close transaction and branch scope; never block auto/recovery close.
13. Timezone: compare instants (`scheduled_at <= closedAt`); for any day logic use `cairo-calendar.ts`.
14. Arabic user-facing messages, matching the existing tone; keep codes in English.
15. Don't widen scope: no new booking statuses, no editing services on a booking, no instalments on
    service invoices.

## 6. Edge cases that need tests

- Pay 100+100+200 on a 400 booking ✔; a 4th payment of 0.01 ✘ (cap). Cap after one service sold
  (cap = remaining value − held).
- Partial sale A+B with credit 300 on invoice 250 → credit applied 250, held 50 → still ≤ pending value
  of C (ok, no refund) or > (the sale refunds only the part above C's value).
- Discount at checkout leaving excess with no pending services → the sale cannot complete until the
  cashier names the money back (`bookingRefund`), so the shift is never stranded.
- Cancel last pending service with zero held → no refund block required.
- Cancel with excess but no open shift → clear error, nothing changed.
- Client never comes, time passed → close blocked; no-show with refund → unblocked.
- Booking at 21:00, shift closes 15:00 → **not** blocked.
- Reschedule then pay again; reschedule a booking with sold services.
- Same `operationReference` replay → no duplicate row; different body → conflict.
- Void a booking invoice (per Q2) — no SQL enum error, drawer totals correct.
- Delete booking with a payment → refused; with only cancelled services and no money → allowed.
- Report: booking with 2 invoices lists both numbers; money columns match the ledger.

## 7. Phases (execute in order; each phase = red → green → targeted checks)

- **P0 Baseline** — run targeted lint/typecheck/tests for contracts, database, api (unit + db
  `tests/erp/booking* sale* cashier* erp-report*`), pos. All were green on 2026-10-06.
- **P1 Database** — schema changes §4.1 + migration + backfill; database package tests.
- **P2 Contracts** — §4.2 with contract tests (cap of money strings, bookingCredit only with bookingId,
  stored method accepts booking_credit, input does not).
- **P3 Booking money** — payment endpoint + DTO money summary (needs Q1). Unit + MySQL tests.
- **P4 Partial sale & credit** — §4.4 (needs Q2); idempotency, void, concurrency tests.
- **P5 Leftovers** — cancel services, cancel/no-show with refund, reschedule, delete rules.
- **P6 Shift** — money totals + close block (needs Q3); repository + service + router tests.
- **P7 Reports** — payment-methods changes + new bookings report + localization; reader/dispatch/MySQL tests.
- **P8 POS** — §4.7, component tests next to existing ones (`bookings-view.test.tsx`,
  `cashier-session-view.test.tsx`, `shift-ending-report.test.tsx`, `erp-reports-view.test.tsx`, sales tests).
- **P9 Full green** — high complexity: run lint, typecheck, build, all tests for every package
  **sequentially**; then hand to review. Report results honestly.

## 8. Commands (run one at a time)

```
pnpm --filter @capella/<contracts|database|api|pos> typecheck | lint | test
cd apps/api && npx vitest run --project unit tests/erp
cd apps/api && npx vitest run --project database tests/erp/booking tests/erp/sale tests/erp/cashier tests/erp/erp-reports
pnpm --filter @capella/database db:generate      # then review the generated SQL
```

## 9. Tracker

- [x] P0 baseline green recorded
- [x] Q1 answered (open-price services & cap) — count as 0 toward the cap
- [x] Q2 answered (void/refund of booking invoice) — up-front portion handed back from the drawer as a refund
- [x] Q3 answered (`arrived` + pending blocks close) — choice is mandatory; `arrived` + pending blocks close
- [x] P1 `erp_booking_services` status/invoice/line columns + checks
- [x] P1 `erp_booking_payments` table
- [x] P1 `erp_invoice_payments` `booking_credit` + `booking_id`
- [x] P1 drop `erp_bookings.invoice_id` with backfill
- [x] P1 reports DB enum `erp-bookings`; migration reviewed; database tests green
- [x] P2 booking DTO + commands; sales `bookingCredit`; stored payment method; shift + report contracts
- [x] P3 record payment (cap, shift, idempotency, audit) + money summary in DTO
- [x] P4 credit applied first, pre-insert lock, totals checks
- [x] P4 `applySale` subset rule; services marked sold
- [x] P4 idempotent replay fixed; void/refund handled; concurrency test
- [x] P5 cancel services + refund; cancel/no-show + refund; reschedule; delete rules
- [x] P6 shift money (taken/refunded/listInvoices/report lines); credit excluded
- [x] P6 close blocked by unresolved bookings; auto/recovery close untouched
- [x] P7 payment-methods report updated; bookings report (contracts, DB enum, facts, summary, metadata, localization)
- [x] P8 diary card states + money + pay/refund dialogs
- [x] P8 sales workspace partial selection + credit + offline handling + leftover dialog
- [x] P8 invoice/receipt label; shift screens; close error link; reports tab; cache invalidation
- [ ] P9 everything green (lint, typecheck, build, tests — all packages)
- [ ] Review done, findings fixed
