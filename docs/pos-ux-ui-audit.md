# POS UX/UI audit

Audit of **every POS screen** in `apps/pos` (login, shell, home, sales, bookings, invoices, refunds, clients, catalog, products, suppliers, transfers, expenses, assets, commissions, reports, cashier accounts/sessions, consumables, and the unused `/services` page). Findings are from the actual page/view code, checked against till-speed, discoverability, layout, and consistency.

This document is the full report. Nothing from the audit is omitted.

---

## What a till should feel like

A cashier with a customer waiting should: **find the person → add items → take money → print**. Almost everything else should be one tap or off the main path.

Today the POS is a **full ERP in a till shell**. That is the root problem.

```
Ideal till          Current POS
─────────────       ─────────────────────────────
[basket | pay]      6 numbered cards stacked
Scan / search       Search + branch + cashier + employee × N
One invoice screen  History  ≠  receipt  ≠  refunds
Floor work          Catalog, stock, purchases, reports in the same rail
```

---

## Scope (screens read)

### App routes (`apps/pos/src/app`)

- Login: `login/page.tsx`
- Protected layout, loading, error
- Home: `(protected)/page.tsx` → `ErpHomeView` / cashier shift
- Sales, bookings, invoices (list + `[invoiceId]`), refunds, clients
- Catalog (+ layout), products, services, suppliers, transfers
- Consumables, expenses, fixed-assets, commissions, reports
- Cashier accounts, cashier sessions (list + `[sessionId]` + report)

### Shell and shared UI (`apps/pos/src/components`)

- `shell/nav.ts`, `pos-shell.tsx`, `sidebar.tsx`, `topbar.tsx`, `erp-home-view.tsx`
- `layout/page-header.tsx`
- `data/data-table.tsx`, `pagination.tsx`
- `feedback/draft-notice.tsx`, `loading-state.tsx`, `notice.tsx`, `success-state.tsx`
- `form/select.tsx`, `textarea.tsx`
- `styles/globals.css`

### Feature views (`apps/pos/src/features`)

- Auth: login view, admin/cashier login forms
- Sales: workspace, multi-sale, all sale steps, tabs, invoices, refunds, receipts, reversal, pickers, notices
- Bookings: diary, form, ticket
- Clients: list, form, picker
- Catalog: catalog view, category/service forms, service picker, commission overrides
- Products: stock view, picker, label sheet
- Suppliers, stock transfers, consumables, expenses, fixed assets
- Commissions, ERP reports, print sheet
- Cashier accounts, cashier sessions (current, history, detail, ending report)

---

## Critical (blocks or slows the counter)

### 1. A new sale is a 6-step form, not a till

**Where:** `apps/pos/src/features/sales/components/sale-workspace.tsx` and the step cards

Numbered steps: client → cashier → basket → default employee → discount/tax → pay. Pay and **إتمام البيع** only stick on the side from `lg` (1024px). On a typical tablet they sit **below** two search lists.

**Hurt:** The cashier scrolls through four panels before money. Submit is often off-screen.

**Broken pattern:** POS should be **search + basket | total + pay**, not a 6-step form.

### 2. “Complete sale” is disabled with no reason

**Where:** `sale-workspace.tsx` (`ready`), `sale-payment-step.tsx`

The button stays dead until: client, cashier on roster, every service has an employee, prices valid, quote loaded, and (if any service) payment is exact.

**Hurt:** Dead primary button. No “missing: employee on haircut” message.

**Broken pattern:** Blocked checkout must name the missing field.

### 3. Three different “who did this” pickers

**Where:** `sale-cashier-step.tsx`, `sale-default-employee-step.tsx`, `sale-basket-step.tsx`, `line-employee-select.tsx`

Every sale: pick cashier from a dropdown, add services, pick default present employee, **plus** a native `<select>` on every service line. Logged-in cashier is **not** pre-selected. Default employee comes **after** the basket, so new lines start unassigned.

**Hurt:** Extra picks on every ticket; easy to stall checkout (`serviceLinesAssigned`).

**Broken pattern:** One seller default + override only when a line differs.

### 4. Finding a client is its own mini-flow

**Where:** `apps/pos/src/features/clients/components/client-picker.tsx`

Search waits for **3 characters**, uses a **phone keyboard** (`inputMode="tel"`), and **إضافة عميل جديد** only appears when there are **zero** results. Changing client wipes search and starts over. Create embeds `ClientForm` (draft banner + 2 fields) in the sale.

**Hurt:** Walk-in is 3–6 actions before the basket. A new client whose number is similar to an existing one cannot be added.

**Broken pattern:** Always-visible “new client”; search should not require a numeric keypad.

### 5. Refund is 8–9 steps and 3 stacked dialogs

**Where:** `refunds-view.tsx`, `invoice-reversal-controls.tsx`

Search → row → first modal → استرداد → second modal (qty) → احسب → tenders + reason → confirm → print yes/no. Outer `ReversalDialog` stays open under the inner `Modal` (both `z-50`). `Modal` has **no `max-h` / scroll**.

**Hurt:** Slow, easy to lose the till; long invoices overflow the screen.

**Broken pattern:** One screen: scan → lines → amount → confirm.

### 6. One invoice, three places

| Need | Screen |
|---|---|
| Look up | `/invoices` (number is the only clickable bit) |
| Void / extra payment / service status | `/invoices/[id]` (actions **below** the receipt) |
| Refund | `/refunds` (same invoices, different table) |

History has **no refund/void**. Receipt can **void** and **record payment**, but not refund (`showRefundAction={false}`). Refunds list is a **different** table of the **same** invoices.

**Hurt:** Customer with a slip, extra navigation and a second search.

**Broken pattern:** Scan once, act on that invoice.

### 7. Cashiers can never open the appointment book until a booking already exists

**Where:** `apps/pos/src/components/shell/pos-shell.tsx`, `nav.ts`

Bookings is hidden unless `hasBookingsEver` is true. Visiting `/bookings` silently `replace`s to `/`. Same idea: sales/catalog **disappear** if the catalog is empty (items show while data is loading (`?? true`), then drop out). Deep links die with no explanation.

**Hurt:** First booking is impossible from a cashier account. New branch looks like a broken app.

**Broken pattern:** Hidden actions; missing empty/error state.

### 8. “Customer arrived” throws you off the diary

**Where:** `bookings-view.tsx` (`status.next === 'arrived'` → `router.push('/sales?bookingId=…')`)

**وصل العميل** always goes to `/sales`. If there is no open shift, the sale workspace never mounts, so the booking prefill can be lost after opening a shift from home.

**Hurt:** Extra hop; dead end under a waiting client.

**Broken pattern:** Mark arrived in place; “start sale” should be explicit.

### 9. Cancel / no-show / logout wipe work with no confirm

- Bookings: **إلغاء** (`ghost`) and **لم يحضر** fire immediately. Contrast: parked-sale close uses `ConfirmDialog`.
- Logout (`pos-shell.tsx`, `topbar.tsx`): runs immediately and calls `clearAllSaleDrafts()` with no confirm, no “you have a draft” warning, and no undo.
- Logout is an unlabeled icon on most POS widths. The word **تسجيل الخروج** only appears from `lg` up. Below that it is a small ghost icon sitting next to shift status.

**Hurt:** One slip on a busy till can throw away the current sale or kill an appointment. Easy to hit logout by mistake.

**Broken pattern:** Destructive action without confirm; destructive action not visible.

### 10. Cashiers cannot add the first service

**Where:** `apps/pos/src/features/catalog/components/catalog-view.tsx`

For cashiers, empty tabs are **hidden**. With zero services the Services tab never appears, so **إضافة خدمة** is unreachable. Searching is the only way to force both tabs.

**Hurt:** Empty catalog is a setup dead end; first-time setup is blocked.

**Broken pattern:** Empty state hides the primary action.

---

## High (layout, hidden actions, too many moves)

### 11. Sidebar is an ERP, not a till

**Where:** `nav.ts`, `erp-home-view.tsx`, `sidebar.tsx`

Cashiers get: shift, sale, bookings, invoices, refunds, clients, **catalog, products, suppliers, transfers, expenses, consumables**. Home is **الوردية**, not **بيع جديد**.

Long Arabic labels are clipped in the rail (`md:w-56`, `truncate`). Names like **خدمات العملاء والمستهلكات** and **ورديات الكاشير والسجل** do not fit the 224px rail. No tooltip.

Admin home is a **second menu** of the same destinations as the sidebar. Refunds and customer-consumables are missing here. Labels differ from the rail (**الفواتير والإيصالات** vs **الفواتير**, **التقارير والتصدير** vs **التقارير**).

**Hurt:** Extra hunting and scrolling to start a sale; an extra click before real work; two names for one screen; destinations become unreadable on a typical 768px till.

**Broken pattern:** Too many moves; POS vs back-office mix; inconsistent copy; cramped layout.

### 12. Any save freezes the whole app

**Where:** `pos-shell.tsx`

`useIsMutating() > 0` locks sidebar, home link, and logout. There is no message explaining why.

**Hurt:** Staff cannot open invoices, clients, or a new sale while something is saving. Feels broken.

**Broken pattern:** Hidden/blocked actions; extra wait.

### 13. Tables hide the buttons that matter

**Where:** `data-table.tsx`, callers such as `product-stock-view.tsx`

Tables default to `min-w-max` + horizontal scroll. `TH`/`TD` accept `pinned` but never apply sticky styles (callers such as products already pass `pinned`).

Each product row: مستهلك, تسوية, طباعة/توليد, تعديل, إيقاف.

**Hurt:** On a till you must scroll sideways to find Edit/Delete, then the first columns disappear. Horizontal scroll or wrapped button soup.

**Broken pattern:** Table overflow; hidden actions; fake sticky column; too many in-row actions.

### 14. Consumables is three jobs on one page

**Where:** `consumables-view.tsx`, `cashier-session-view.tsx`

Tabs: service status / usage / stock. Completing a service **cannot** record usage. Selecting a different service **silently fails** (same-service-only rule with no message). Empty cashier state says **اختر فرعاً للمتابعة** even though cashiers never pick a branch (`!ready` always shows that copy).

Closing a shift: unfinished services only appear after Confirm → **fail**. Then a link to `/consumables`.

**Hurt:** Close-of-shift path is long; failed selection feels like a broken checkbox; pending session looks like a missing branch; extra failed click; recovery is buried in an error.

**Broken pattern:** Hidden rules, split workflow, POS floor work mixed with admin stock setup; admin empty state reused for POS; error-as-navigation.

### 15. Products / expenses / transfers / suppliers: create form always on

**Where:** `product-stock-view.tsx`, `expenses-view.tsx`, `stock-transfers-view.tsx`, `suppliers-purchases-view.tsx`

Add/edit sits **above** the list, then stock adjustment, then the table, then movements. Cashiers must scroll past an admin form to see stock.

Product create form layout is broken: commission % is stacked inside the **آخر تكلفة شراء** cell; barcode/threshold sit beside it.

Expenses **correction hijacks** the create form (**تصحيح** fills the top form).

Transfers: create form always above history. Cashier source is disabled/empty while session loads. Submit success only clears fields (no `SuccessState`).

Purchases: posted → only **إلغاء**. Correct only after cancel. Totals shown three times; each line shows amount twice. **نتائج المخزون** dumps every line on the page. Header CTA for purchases vs always-on supplier form. Backdrop/Escape closes the panel (draft restore exists, but the panel vanishes).

**Hurt:** Extra scroll, easy to edit the wrong product, till vs inventory mixed on one page; fields look unlabeled or nested; easy to think you’re posting a new expense; no confirmation on transfer; two different create patterns; easy to lose the invoice UI; too many clicks to fix a bill.

**Broken pattern:** Always-visible create form instead of a dialog/CTA; inconsistent form grid; mode change without a dialog; no success state; split destructive/correct flow.

### 16. Reports: 21 chips + Apply + a queued PDF you must hunt for

**Where:** `erp-reports-view.tsx`

All report types wrap as buttons. Dates/search need **تطبيق الفلاتر**. **تصدير PDF** only queues a job; print/download live in history below. Unknown `summary` keys can print as English identifiers. Search is always shown.

**Hurt:** Hunting, extra clicks, easy to think export failed; looks unfinished.

**Broken pattern:** Overflow chip bar; filters not live; export result hidden; unclear copy.

### 17. `/services` is a leftover page

**Where:** `apps/pos/src/app/(protected)/services/page.tsx`, `service-picker.tsx`

Not in the nav. Reuses the sale picker (`max-h-72`, 50 items, no load more). Empty state tells you to use catalog admin. Admins manage the catalog under `/catalog`; this page is described as the cashier browse view but is unreachable from navigation.

**Hurt:** Dead route; tiny scroll box as a “page”.

**Broken pattern:** POS browse vs admin catalog mixed; component reused out of context.

### 18. Service picker caps at 50 with no “load more”

**Where:** `service-picker.tsx` vs `product-picker.tsx` (which has load more)

Service 51+ is **unreachable** without search. Products need another tap for load more. Product picker empty: no-match and no-stock share **لا توجد منتجات متاحة**. Scanner works with no UI copy. Disabled zero-qty rows have no reason.

**Hurt:** “Missing” services at the counter; failed scan/search is unexplained.

**Broken pattern:** Infinite scroll / categories; scan-first for products; inconsistent lists; hidden scanner; coarse empty state.

### 19. Booking diary is not a day book

**Where:** `bookings-view.tsx`, `booking-form.tsx`

Date shown as raw `YYYY-MM-DD`. No **اليوم**. Chevrons only. Status **Badge** default (not by state). Preferred employee **saves on every dropdown change**. New booking is a tall modal (client picker + create form + service list + datetime) then a **second** print modal. Duplicate service add is a silent no-op (sale increments). Admin **حجز جديد** disabled until branch with little explanation.

**Hurt:** Hard to jump to today; accidental employee writes; long create; extra click.

**Broken pattern:** Day agenda + confirm cancel; create as a short sheet; persist last branch.

### 20. Auto-print vs optional print is random

**Where:** `sale-workspace.tsx` (auto `window.print()`), `sale-payment-step.tsx` (“مراجعة وإتمام البيع + طباعة”), `sale-completed-card.tsx`, `invoice-reversal-controls.tsx`, `record-payment-dialog.tsx`, `booking-form.tsx`, `product-label-sheet.tsx`, `print-sheet.tsx`, `shift-ending-report.tsx`

There is **no review step**. Save **auto-opens** the browser print dialog. `RecordPaymentDialog` says **تسجيل وطباعة الدفعة** then still requires **طباعة إيصال الدفعة**. Product barcode: no barcode → generate (success toast) → print later. Has barcode → `window.print()` immediately, no preview/cancel. Print sheets have no on-screen cancel.

**Hurt:** Extra OS dialog; labels don’t match what happens; cashiers can’t predict when the print dialog appears.

**Broken pattern:** Save, then optional print; don’t promise a review you don’t have; hidden/inconsistent print action.

### 21. Sticky pay column vs long left column

**Where:** `sale-workspace.tsx`, `sale-basket-step.tsx`

Left: 4 cards including two `max-h-72` pickers + wrapping line rows (`flex-wrap`, qty **and** employee). Right sticky only at `lg`. Line controls wrap so qty/delete sit under the name.

**Hurt:** Basket rows get tall; pay is off-screen on &lt;1024px.

**Broken pattern:** Compact line row; pay always visible.

### 22. Parked-sale tabs are easy to miss and easy to delete

**Where:** `sale-tabs.tsx`, `multi-sale-workspace.tsx`

Bar **hidden** until a draft exists. Labels are **item names, not client** (by design — stored copy carries catalog names but never the client's). Close is **24px** `X` next to the tab (`size-6` vs 44px qty buttons). Confirm exists on close (good), still easy to open the dialog by fat-finger.

**Hurt:** Queue identity is weak; fat-finger deletes a ticket.

**Broken pattern:** Always-visible tabs; client label; 44px close or overflow menu.

### 23. Modals don’t scroll

**Where:** shared `Modal` (used by `booking-form.tsx`, `invoice-reversal-controls.tsx`, `reassign-employee-dialog.tsx`, `service-status-dialog.tsx`)

Centered `max-w-*` panel, **no max-height**. Booking modal stacks client picker + create form + service list + datetime. Cashier-account dialog already uses a scrollable pattern; others do not.

**Hurt:** Footer **حفظ** / **تأكيد** can sit off-screen.

**Broken pattern:** `max-h-[90dvh] overflow-y-auto`.

### 24. Invoice history: only the number is the hit target

**Where:** `invoice-history-view.tsx`

Whole card looks clickable (`hover:shadow-raised`); only the underlined number is a `Link`. Search needs **بحث**. Admin with no branch: **no empty “اختر الفرع”** (unlike clients/bookings). Barcode scan exists (good) but typed search is extra-click.

**Hurt:** Missed taps; extra click vs live client search.

**Broken pattern:** Entire row is the target; live or Enter-only search; empty state for branch.

### 25. Refunds table is a ledger, not a till list

**Where:** `refunds-view.tsx`

`DataTable` default `min-w-max`, 6 columns. Horizontal scroll on a narrow till. **مرتجع** is a small `RowActions` control. List includes voided/refunded invoices; ineligibility appears **after** opening the dialog (**لا يمكن استرداد أو إلغاء هذه الفاتورة**). Empty copy: **ستظهر الفواتير القابلة للاسترداد هنا** — it lists **all** invoices.

**Hurt:** Extra tap to learn you can’t refund.

**Broken pattern:** Filter refundable; large row action; cards like history.

### 26. Receipt page hides the real actions under an 84mm slip

**Where:** `invoice-receipt-view.tsx`, `service-status-dialog.tsx`, `reassign-employee-dialog.tsx`

Print/PDF on top. Then a receipt card. Then balance / reassign / **حالة الخدمة** / void **below the fold**. **تسجيل دفعة** is disabled with **no copy** if `currentCashierSession` is missing. PDF is a multi-state button (check → queue → retry). Per-line **تغيير الموظف** + separate **حالة الخدمة**. Status row is three small buttons; completed is locked. Reassign needs employee list + required reason.

**Hurt:** Pay/void/reassign look like afterthoughts; extra dialogs for a floor correction.

**Broken pattern:** Actions first; disabled + reason; inline status on the invoice.

---

## Medium (consistency, empty states, cramped chrome)

### Shell, login, chrome

| Issue | Where | Why it hurts | Broken pattern |
|---|---|---|---|
| Phone POS needs a menu tap for every screen. Drawer has no inner close; close is the hamburger. Open drawer is not `aria-modal` and main content is not `inert`. | `sidebar.tsx`, `topbar.tsx`, `pos-shell.tsx` | Extra taps on a phone till; focus/AT can still reach the page behind the overlay | Too many moves; accessibility |
| Closed shift is status only. **لا توجد وردية مفتوحة** has no “open shift” control. Shift error retry is a tiny text-danger control. | `pos-shell.tsx` | Staff must leave the header and find the home/shift screen | Hidden next action; cramped POS chrome |
| Draft discard is one tap. **تجاهل** is a ghost button with no confirm. Banner is `role="status"`. | `draft-notice.tsx` | Easy to throw away a half-built sale or form | Destructive action; weak empty/resume state |
| Error screen always sends people to **بيع جديد**. Copy talks about restoring a sale draft on every protected page. Secondary action is a raw `Link` to `/sales`. The real `error` is never shown. Cashiers with no sales catalog get bounced home. | `error.tsx` | Wrong recovery path; inconsistent controls; no usable error detail | Broken error state; inconsistent buttons |
| Login role switch is a trap. Cashier/Admin is a two-button group (`aria-pressed`), not tabs. Switching unmounts the form and clears what was typed. No show-password. Field errors are one shared line under both fields. Inputs are not `aria-describedby` the alert. | `login-view.tsx`, login forms | Extra retyping; unclear which field failed | Inconsistent controls; weak error state; accessibility |
| Account footer does not identify the person. Footer is only **حساب المدير** / **حساب كاشير**. No name, no branch for admin. | `pos-shell.tsx`, `sidebar.tsx` | Shared tills make it unclear who is signed in before logout | Hidden status |
| Generic loading copy for every screen: always **جارٍ تحميل صفحة نقطة البيع…**. | `(protected)/loading.tsx` | No sense of which workspace is coming | Weak loading state |
| Page header actions wrap away from the title (`flex-wrap justify-between`). | `page-header.tsx` | The one action the header promises is easy to miss | Cramped layout; hard-to-find primary action |
| Print CSS hides the app unless a receipt/report root exists (`body * { visibility: hidden }` except `[data-receipt]` / `#print-root`). | `globals.css` | Printing a list/error/login page yields a blank sheet | Broken empty/print state |
| Touch targets are 32–36px. Native select `h-9`, table `px-2 py-2.5`, home links `py-1.5`, draft/pagination `size="sm"`. | select, data-table, erp-home, draft-notice, pagination | Missed taps on a standing counter tablet | Cramped POS |
| Pager is prev/next only, with no accessible name. No page index, no jump, no `<nav aria-label>`. Summary is optional. Often **صفحة N** without total. | `pagination.tsx` and many lists | Long ledgers take many clicks; screen readers get an unlabeled cluster | Too many moves; accessibility |
| No empty-state building block on the table. Loading skeletons are `aria-hidden`, no live status. | `data-table.tsx`, `loading-state.tsx` | Empty lists look like a broken table unless every screen invents copy | Missing empty states |
| Numbers are not actually aligned. `numeric` applies `text-start` on both branches. Headers `nowrap`; cells wrap. | `data-table.tsx` | Amounts and action cells don’t share a stable column rhythm | Inconsistent table layout |
| Textarea can break the card. Default browser resize; no `resize-y` / `min-h`. | `textarea.tsx` | Dragging the corner can overflow a tight POS panel | Broken layout |
| Danger banners may stay polite. Default `role="status"` even for `tone="danger"`. Callers must pass `alert`. | `notice.tsx` | Blocking errors can be missed by AT | Inconsistent error announcement |
| Loading/success text is announced twice (visible label plus `aria-label` on the same `role="status"`). | `loading-state.tsx`, `success-state.tsx` | Duplicate “جارٍ …” chatter | Accessibility |

### Sales, invoices, clients, bookings (additional)

| Issue | Where | Why it hurts | Broken pattern |
|---|---|---|---|
| Admin branch is a gate on every visit (not remembered). Sales admin: header + branch card, then a **second** **بيع جديد** header inside the workspace. | `sales-view.tsx`, `clients-view.tsx`, `bookings-view.tsx`, `invoice-history-view.tsx`, `refunds-view.tsx`, catalog, products, etc. | Extra click every screen; duplicate title | Persist last branch; one header |
| Shift empty state is a dead end. **لا توجد وردية بيع متاحة** tells cashier to open a shift **from the home page** — no button. Booking-to-sale can land here. | `sales-view.tsx` | Extra navigation under a waiting customer | Primary **فتح وردية** on the empty state |
| Pending-sale recovery is a stub. Success = number + total. No print, no **بيع جديد**, no receipt. Authoritative failure has no discard path. | `pending-sale-recovery.tsx` | Unclear if the sale is done; no next action | Incomplete recovery |
| Draft/queue banners bury the form. Restore, booking, conflict, sync, storage, queue, ambiguous, other-shift, unrecoverable can stack. Discarding a queued sale is a ghost **حذف البيع المعلق** then another modal. | `sale-draft-notices.tsx`, `sale-queue-notices.tsx` | Status is noisy; destructive discard is easy to miss then extra-confirmed | One status region; danger styling on destroy |
| Payments: four boxes, partial rules are implicit. Cash is prefilled (good). Visa / Instapay / Vodafone always show. Product-only can stay open (`remaining > 0`); services must be `remaining === 0`. Overpay disables submit with **المدفوع زائد** only. | `sale-payment-step.tsx`, `use-sale-quote.ts` | Split tender looks required; partial vs full is tribal knowledge | One amount + method; show “on account” only when allowed |
| Discount/tax is a required-looking step. Always step 4/5 with two kind+value controls. Most tickets are 0. | `sale-adjustments-step.tsx` | Extra visual step and mis-taps into % vs fixed | Collapsed **خصم / ضريبة** |
| Clients workspace empty states have no action. **لا يوجد عملاء بعد** / no-match have **no** add button (add is header-only, disabled without branch). Create/edit forms **push the table down**. | `clients-view.tsx` | Empty list doesn’t teach the next step | Empty CTA; edit in a dialog or drawer |
| Completed sale: print again + **عرض الإيصال** leaves the till. | `sale-completed-card.tsx` | Extra navigation after a finished ticket | Stay on till; optional print |

### Catalog, stock, money, reports (additional)

| Issue | Where | Why it hurts | Broken pattern |
|---|---|---|---|
| Inline catalog forms push the table away. Create/edit is a card above the list, not a modal. Editing a row jumps the viewport. Category **النوع** is a one-option disabled select. | `catalog-view.tsx`, `category-form.tsx`, `service-form.tsx` | Extra scroll; type field looks required and broken | Inline editor; dead form field |
| Service empty state does not send you to categories. **ابدأ بإضافة أول خدمة** with no category still opens a form whose category dropdown is empty. | `catalog-view.tsx` | Save fails or cannot start; no guidance | Empty state without the real prerequisite |
| Delete-price and remove-override have no confirm. **حذف السعر الثابت** mutates immediately. **إزالة** override with no confirm; employee list can include existing overrides with no “edit” affordance. | `service-form.tsx`, `commission-overrides-dialog.tsx` | Accidental destructive edits | Danger action without confirm |
| Commission dialog table can overflow; employees as `#id`. No `overflow-x`; names fall back to `#123` while employees load. | `commission-overrides-dialog.tsx` | Unreadable modal; looks like missing data | Missing loading/empty for a dependent list |
| **مستهلك** is cryptic. Admin-only text link into consumable config. No explanation. | `product-stock-view.tsx` | Cashiers don’t see it; admins don’t know what it does | Hidden cross-module action |
| Empty products vs filtered products. Search / low-stock still say **لا توجد منتجات**. Low-stock is a toggle with no hint. Movements dropdown only lists the current (filtered) products. | `product-stock-view.tsx` | Looks like an empty warehouse; movements filter is incomplete | Empty state ignores filters |
| Stock tab: English units (`ml`/`gm`); **حجز من مخزون البيع**; balances table has no empty state. No search/pagination on services. Status column is three buttons — overflows on a small till. **الدور** shows a number; overdue is only a warning badge, not the word. | `consumables-view.tsx` (`StockPanel`) | Floor staff vs warehouse mixed; dense, untranslated, overflow | Cramped table actions; missing empty state |
| Commissions: **التفاصيل** opens a second card under the table. Paging clears it. No employee search. | `commissions-view.tsx` | Extra scroll/click; lost context | Detail not in a drawer/dialog |
| Shift list/detail copy and missing back. Links: **تفاصيل الوردية 17**. Detail/report have no back to the list. Report repeats **وقت الإغلاق**. After close, user is thrown to the report with no path hint. | `shift-history-view.tsx`, `shift-detail-view.tsx`, `shift-ending-report.tsx` | Extra sidebar clicks; raw IDs | Unclear copy; missing navigation |
| Cashier accounts: names `max-w-64 truncate` (tooltip only). Multi-select is an in-flow checkbox list (`max-h-48`) inside a scrolling modal — can clip. Empty employees: helper text only, save still allowed. | `cashier-accounts-view.tsx`, `employee-multi-select.tsx` | Hidden who can sell; dropdown cut off | Overflow/truncation; dropdown not portaled |
| Fixed assets: search is its own card. Delete is a card above the table, not `ConfirmDialog`. | `fixed-assets-view.tsx` | Delete can scroll off; search is over-separated | Inconsistent confirm; extra chrome |
| Success toasts never dismiss. | catalog, products, suppliers, expenses, assets | Stale **تم الحفظ** after later edits | Uncleared status |
| Category delete copy is always **لا يمكن حذف تصنيف استُخدم**, even if unused. | `catalog-view.tsx` | Sounds already impossible | Unclear copy |
| Service description is a single-line input. | `service-form.tsx` | Long notes don’t fit | Wrong control |
| Inconsistent required fields and errors. Catalog uses `Field` + required. Products, suppliers, expenses, assets, transfers use `Label` + placeholders, one blob `FieldError`. | many ERP forms | You only learn the rule after a failed save | Inconsistent forms |
| Missing document titles. `products/page.tsx`, `suppliers/page.tsx`, `expenses/page.tsx`, `fixed-assets/page.tsx` have no `metadata`. | those pages | Browser tab stays generic | Inconsistent pages |

---

## Cross-cutting: POS vs admin mixing

Cashiers use the same POS shell for till work and full ERP back-office (catalog, products, suppliers, purchases, transfers, expenses). Admin-only screens (commissions, reports, cashier accounts, fixed assets) are gated, but several cashier screens still look like admin workbenches: always-on create forms, commission fields, and stock configuration.

`/services` is a leftover cashier browse page that is not in the nav. Admin home omits Consumables and Refunds even though they sit in the sidebar.

Cashiers land on the shift screen at `/`; admins get a second **ورديات** item plus a dashboard of links.

---

## Screen-by-screen (short)

| Screen | Verdict |
|---|---|
| Login | Role switch wipes input; errors not per-field |
| Admin home | Duplicate nav; missing refunds/consumables |
| Cashier home (shift) | OK as a shift desk; close fails instead of guiding to open services |
| بيع جديد | Too many steps; silent disable; pay off-screen on tablet |
| دفتر المواعيد | Hidden until first booking; ISO date; no confirm on cancel; arrived hijacks |
| الفواتير | Extra search click; row not clickable |
| إيصال فاتورة | Actions buried; refund missing |
| المرتجعات | Duplicate of invoices; stacked dialogs |
| العملاء | Empty state has no CTA; form pushes the table |
| الكتالوج | First service hidden; inline forms; 50-item cap |
| `/services` | Dead route |
| المنتجات | Always-on form; action overflow; fake pin |
| الموردون | Always-on supplier form; cancel-then-correct |
| التحويلات | Always-on form; no success message |
| المصروفات | Correction steals the create form |
| الأصول | Delete not a shared confirm; extra search card |
| المستهلكات | Three jobs; silent checkbox rules; wrong empty copy |
| العمولات | Detail below fold; no search |
| التقارير | 21 chips; queued export is easy to miss |
| حسابات الكاشير | Truncated employees; better (modal) than other CRUD |
| سجل الورديات | Raw IDs; no back from detail/report |

---

## Click-count (happy paths)

| Job | Approx. clicks / steps | Extra tax |
|---|---|---|
| Cash service sale | **6 numbered panels** + search client (3 chars) + pick cashier + pick employee | Submit disabled silently; pay off-screen &lt; `lg` |
| New client during sale | Search → empty → **إضافة** → form → save → back to sale | Create hidden if any search hit |
| Booking → sale | **وصل العميل** → `/sales` → still pick cashier + employees | Dies if no shift |
| Refund | Search → row → dialog → **استرداد** → qty → **احسب** → reason → confirm → print | **3 nested/sequential modals** |
| Void from receipt | Scroll past receipt → **إلغاء** → reason modal | Refund not on this page |
| Invoice lookup | Type → **بحث** → tap **number only** | Card is not the target |

Typical **service sale** path: admin branch (1) → client search+pick (2–4) → cashier (1) → add lines (1+) → default employee (1) → per-line employee if default skipped → discount/tax → four payment fields → submit. Numbered as **6 on-page steps** (5 if products only). Refund is **8–9 actions and 3 stacked dialogs**.

---

## What already fits a till

- Cash auto-fill from quote (`use-sale-quote.ts`).
- Qty ± at 44px (`sale-basket-step.tsx`).
- Barcode open on invoices/refunds/products.
- Parked-sale close is confirmed (`multi-sale-workspace.tsx`).
- Clients search is live (unlike invoices).
- Shift chip in the topbar (`pos-shell.tsx`).
- Empty/error/retry states exist on most lists.
- Catalog stop/delete and several other destroys use `ConfirmDialog`.
- Purchase create moved to a side panel (better than an always-on invoice).
- Shift money breakdown is readable.
- Cashier accounts create is a proper modal.
- Branch gating for admins is consistent where implemented.
- Skip-to-content link, RTL, focus-visible, thin scrollbars, print isolation for receipts/reports.

The main POS problem is not missing screens — it is **too many screens and steps for one ticket**: numbered sale cards, stacked refund dialogs, and invoice/refund/booking hops that a counter should not take while a customer is waiting.

---

## Highest-impact fixes (order)

1. **Till layout:** one screen = client strip + basket | total + pay. Collapse discount/tax. Default cashier + one employee, override per line only.
2. **Explain a disabled Complete button** (or don’t disable it — jump to the missing field).
3. **One invoice workspace:** scan → view → pay / refund / void.
4. **Show Bookings and Sales** even when empty; empty state with “add first”. Always show catalog Services tab (or keep Services visible with “add category first”).
5. **Confirm** logout-with-drafts, booking cancel/no-show.
6. **Move ERP create forms** into dialogs; overflow row actions into a menu; make `pinned` actually sticky.
7. **Consumables:** record usage when marking complete; explain same-service selection; fix **اختر فرعاً**; empty stock table; warn about open services **before** shift close (send to consumables before confirm).
8. **Reports:** grouped list, not 21 chips; live filters or make Apply primary; export progress in the header.
9. **Remember last admin branch.** Put **فتح وردية** on the sales empty state.
10. Remove or rebuild `/services`. Don’t reuse the sale picker as a page.
11. Standardize forms (`Field`, required, one confirm pattern) so POS and admin don’t feel like two products.

---

## File index (primary)

| Area | Paths |
|---|---|
| Shell | `apps/pos/src/components/shell/*` |
| Sale | `apps/pos/src/features/sales/components/*` |
| Bookings | `apps/pos/src/features/bookings/components/*` |
| Clients | `apps/pos/src/features/clients/components/*` |
| Catalog | `apps/pos/src/features/catalog/components/*` |
| Products | `apps/pos/src/features/products/components/*` |
| Suppliers | `apps/pos/src/features/suppliers/components/*` |
| Transfers | `apps/pos/src/features/stock-transfers/components/*` |
| Consumables | `apps/pos/src/features/consumables/components/*` |
| Expenses | `apps/pos/src/features/expenses/components/*` |
| Fixed assets | `apps/pos/src/features/fixed-assets/components/*` |
| Commissions | `apps/pos/src/features/commissions/components/*` |
| Reports | `apps/pos/src/features/erp-reports/components/*` |
| Cashier accounts | `apps/pos/src/features/cashier-accounts/components/*` |
| Cashier sessions | `apps/pos/src/features/cashier-sessions/components/*` |
| Auth | `apps/pos/src/features/auth/components/*` |
| Routes | `apps/pos/src/app/(protected)/**/page.tsx`, `login/page.tsx` |
