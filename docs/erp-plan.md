# Beauty Center ERP — Decisions, Reasoning, and Plan

Status: **ERP 1–22 software slices delivered, subject to the explicitly deferred validation listed below; production deployment remains.** This document records every decision made so far, the reasoning behind it, and what remains open. It is the source of truth for why the ERP is built the way it is. Written 2026-07-29; last revised 2026-08-09 for ERP22 multi-frontend production security; §12 (product sync between branches — decided, not implemented) added 2026-10-27 and rewritten 2026-10-28.

---

## 1. What we are building

A beauty center ERP for Capella, covering (the owner's original requirement list):

1. **Login & auth** — admin seeded from `.env`; accounts with roles (see §6)
2. **Categories** — for services and expenses
3. **Services** — name, description, price, commission settings, …
4. **Products** — name, description, price, stock, …
5. **Sales (POS)** — selling services and products at the counter
6. **Expenses** — categorized outgoing money
7. **Suppliers** — which products were bought from whom
8. **Reports & PDF export** — invoice number, client name, client phone, payment method (**cash, visa, InstaPay, Vodafone Cash**), date & time, who authorized (acting account)
9. **Employee sales** — cashier assigns incoming clients to currently-attendant employees; system tracks what each employee earned
10. **Stock** — product quantities: purchases increase, sales decrease

Context that shaped everything: the same owner already built **Capella HR** (this repository), the beauty center is **one branch** in its `branches` module, employees **check in through HR** (code + PIN, registered browser, assigned branch, and GPS), and the workflow in requirement 9 depends on live attendance data.

---

## 2. The big decision: one codebase, not two

**Decision: the ERP is built inside this repository as a new optional module group, plus a new POS frontend app. There is no separate ERP application.**

### Options that were considered

| | Option | Verdict |
|---|---|---|
| A | **Modular monolith** — ERP modules inside this repo, enabled per customer | **Chosen** |
| B | Separate ERP app integrating with HR over its REST API | Rejected |
| C | Separate ERP app pointing at the same MySQL database | Rejected (runner-up) |

### Why B was rejected

All of C's costs *plus* building and maintaining an integration API, webhooks, and cross-app auth — justified only when two different teams own the two systems. One person owns both. Strictly dominated.

### Why C was rejected

C keeps the HR repo untouched (its main appeal), but:

- **Schema drift:** the ERP would hold its own copy of the table definitions for `employees` / `attendance` / `branches`. Any HR migration that touches those tables silently breaks the ERP at runtime. This is the "fighting sync for life" problem in quieter form.
- **Dirty payroll integration:** commissions would be written into HR's tables from outside HR's codebase, bypassing its validation, or not integrated at all.
- **Duplicated auth** and two deployments per customer.
- **Decisive business fact:** the ERP **will itself be sold** to other salons/clinics. With C, every ERP sale ships *two* products stitched together through a shared database at every installation. With A, there is one product with editions.

### Why A won

- **The attendance workflow becomes trivial** — live presence already exists as data (§3), exposed to the ERP through a public capability.
- **Commissions flow into payroll** through a controlled projection (§8), not ad-hoc writes.
- **One product, multiple editions** — instead of two products with a fragile seam.
- **Second decisive business fact:** HR currently has **no customers besides Capella**, so reshaping core (accounts/roles) costs nothing now. This is the cheapest moment this change will ever have.
- Not a one-way door: modules stay isolated behind boundaries, so extracting the ERP into its own service later remains possible.

### The boundary rules that keep the monolith clean

> **Rule 1 — direction:** ERP modules may depend on HR core (employees, attendance, branches, auth, payroll). HR core must NEVER import from ERP modules.
>
> **Rule 2 — mechanism:** ERP consumes HR core **only through public capability interfaces**, never by reaching into HR repositories or querying HR tables directly. Examples: `listPresentEmployees(branchId)`, employee lookup, branch lookup, session verification, a payroll-input projection API. This matches the pattern the repo already uses internally (e.g. payroll and attendance exchange gateways in `server.ts`).

Rule 1 will be **enforced automatically with an ESLint import-boundary rule** (the repo already ships `packages/eslint-config`). Rule 2 is enforced the same way: ERP modules may import only each HR module's public `index.ts` surface, and the capability functions the ERP needs are added to those public surfaces deliberately, one by one. The existing architecture rule ("modules must not import another module's internal files") continues to apply to ERP modules among themselves.

---

## 3. Verified facts about this repo that the decision rests on

These were confirmed by reading the code on 2026-07-29 (not assumptions):

- **Stack:** Next.js + Express + **Drizzle ORM** + MySQL, pnpm workspaces + Turborepo, Docker Compose deployment, `apps/` = `api` / `web` / `worker` at planning time; the delivered system adds `apps/pos` (ERP frontend) and `apps/attendance-ai` (Python face-verification service for HR attendance). (Note: earlier discussion said "Prisma" — the repo actually uses Drizzle.)
- **Modules are optional at the wiring level.** `apps/api/src/routes/index.ts` mounts each module's router only if its service is passed into `createApp` (`apps/api/src/app.ts`), and the ERP21 runtime composition root now constructs only the resolved edition's modules.
- **Live presence already exists as data.** `attendance_sessions.open_employee_id` is a stored generated column (non-null while the session is open) with a unique index. The ERP will consume it **only** via a public capability such as `listPresentEmployees(branchId)` (Rule 2, §2) — the point is that the capability is cheap to provide, not that ERP queries attendance tables.
- **A payroll-input pipeline already exists.** Ordinary bonuses remain separate, while ERP17 adds an HR-owned deterministic commission input that is included in open previews and snapshotted at finalization, plus an HR-owned post-payroll deduction input for later reversals (§8). ERP never reads or writes HR tables directly.
- **Arabic RTL is already the house style.** `apps/web` renders `lang="ar" dir="rtl"` with IBM Plex Sans Arabic; locale `ar-EG`, timezone `Africa/Cairo`. The POS app follows the same.
- **PDF machinery already exists.** `apps/worker` polls DB-queued report jobs and renders PDFs via `apps/worker/src/reporting` (`report-pdf.ts`). Invoice/report PDF export reuses this pattern instead of introducing a new one.
- **Branches with GPS geofencing exist**; the beauty center is one branch. All ERP data is branch-scoped from day one, so multi-branch POS is cheap later.
- **Auth at the start of planning:** the repository used a singleton `admin_credentials` row and `auth_sessions.actor_type ∈ {admin, employee}`. The completed account slice has since migrated the seeded Admin and Cashiers into `accounts`, migrated persistent Admin sessions to account identity, added expiry, and retired `admin_credentials`. Employee code + PIN remains limited to self-service. The session cookie remains `capella_session`, `SameSite=strict`, and host-only.

---

## 4. Product editions — how "HR only", "ERP only", and "full" are sold

Every customer gets **their own installation**: own server, own MySQL, own `.env` (this is already the deployment model).

### Officially supported editions

The public, sellable, **tested** configurations are three named editions:

```
EDITION=hr      # HR-only customer
EDITION=erp     # beauty-center/POS-only customer
EDITION=full    # HR + ERP (Capella)
```

### The module registry (internal mechanism)

Under the hood, an edition resolves to a set of module names through a startup registry in which modules have one of three natures:

- **Core — always on, cannot be disabled:** `auth` (nothing mounts without it), `branches`, `employees`, `audit`. Core is implicit. When `EDITION` is missing, startup resolves to this core floor so the installation still provides login, branches, and employees.
- **Sellable — grouped into editions:** each declares `requires: [...]`. At boot the edition's set is dependency-expanded (e.g. `bonuses → payroll → attendance → shifts, devices`), so no supported configuration can produce a half-wired server.
- **Support — never sold alone, pulled in automatically:** `shifts`, `devices` (arrive with `attendance`).

Final set = **core ∪ expand(edition)** when `EDITION` names a supported edition; when it is missing, final set = **core**. Any explicitly supplied unknown edition name **fails boot loudly** with a clear error — it never falls back to core. The resolved module list is logged at startup.

**Granular per-module combinations** (e.g. "attendance + payroll only") remain possible through the same registry but are **internal/experimental, not an official product promise** — every additional supported combination multiplies the testing matrix. If a custom combination is ever sold, it gets promoted to a named, smoke-tested edition first.

The Attendance construction boundary accepts the Payroll financial-lock capability optionally. ERP-only construction omits it and treats Attendance records as not payroll-locked because Payroll is absent; full-HR construction explicitly supplies `payrollModule.service.isFinanciallyLocked`, preserving finalized-payroll protection. Payroll still requires Attendance for payroll facts, so the dependency is one-way: `payroll → attendance`.

### The three planes an edition controls

An edition affects three distinct things, deliberately kept separate:

1. **Runtime/API availability** — `server.ts` constructs and passes only the resolved module set into `createApp`; routers for absent modules are never mounted, so their URLs do not exist on that customer's server.
2. **UI/container availability** — Docker Compose **profiles**: `web` serves HR in `hr`/`full` and the restricted attendance surface in `erp`; `pos` carries the `erp`/`full` profiles. An HR-only customer's server never pulls the POS image, while an ERP-only customer can still check staff in without exposing HR administration.
3. **Database migrations** — **all schemas migrate on every installation regardless of edition.** Disabled modules' tables exist and stay empty. This is intentional: one migration history, no per-edition migration forks, and upgrading a customer to a bigger edition is config-only. The cost (unused empty tables) is accepted.

**The "ERP only" nuance (intentional):** ERP-only resolves to the always-on core plus `attendance` and its support dependencies, with `payroll` excluded — because client-assignment requires knowing who is present, while Attendance no longer requires Payroll to be constructed. The `web` container exposes only branch/personal-device attendance and device pairing in this edition; HR administration, payroll, advances, deductions, and self-service stay off. Full HR continues to enable Payroll and inject its financial-lock capability into Attendance. Commercially this is a selling point ("a salon POS with staff check-in built in") and a natural upsell path to full HR via a config change.

**Licensing:** because the owner installs and controls every deployment, `.env` + compose profiles are sufficient. Signed license keys only become relevant if self-service installers are ever distributed — deliberately out of scope now.

---

## 5. Frontends and domains

Two frontends, never merged, one shared brain:

```
apps/
  web/   → HR app         (exists, Arabic RTL)
  pos/   → beauty center  (new,   Arabic RTL)
  api/   → single Express API both talk to
```

They share `packages/ui` (one design language) and `packages/contracts`, but build and deploy as independent containers. Domain layout is a reverse-proxy concern (nginx/Caddy/Traefik routes by hostname):

- **Subdomains (recommended per installation):** `hr.customer.com` + `pos.customer.com`, with each host serving its own `/api` path and both paths forwarding to the shared API.
- **Two unrelated domains:** both DNS records point at the same server; each domain serves the API under its own `/api` path (proxy forwards both to the same API container) so cookies stay first-party.
- Separate big domains are best reserved for **marketing sites** per product edition.

**Security topology (delivered production solution).** Each frontend is served with the API under its own origin: the reverse proxy exposes `hr.customer.com/api` and `pos.customer.com/api`, both forwarding to the same private API container. Browser clients use only `/api/v1`. Cookies remain first-party, host-only, secure, and `SameSite=strict`; production state changes also require an exact same-origin `Origin` header. HR and POS sessions are independent, so an Admin logs into each app separately. Optional credentialed CORS is restricted to an explicit development-only list and production startup rejects it.

---

## 6. Identity and authorization (decided direction)

**"Cashier" is a permission, not a kind of person — and not a new `actor_type`.** The design:

- A general **account** model: username/email + password, active/disabled, with a **role** and (where relevant) **branch scope**.
- **Role set is final (owner decision): Admin and Cashier. Nothing else.** The model stays structurally extensible (role is a column, not a fork), but no other role is planned.
- **The permission matrix is therefore trivial and decided:**
  - **Admin** — full access to everything: HR app and ERP/POS app.
  - **Cashier** — can log into the **ERP/POS only**; the HR app rejects cashier accounts. Within the ERP: all counter operations (sales, invoices, discounts, voids/refunds, clients, stock views).
  - **Employees** — code+PIN login to **HR only** (attendance/self-service); never a business actor in the ERP.
- **An employee may optionally own an account.** Employee stays a business entity (a person who works and gets paid); an account is the ability to operate the system. A person can be both a service provider *and* a cashier without any modeling pain — the two facts live in different tables linked optionally.
- The `.env` admin seed is kept and now synchronizes the first **Admin account**. Migration `0042` copies the legacy singleton credential and sessions into account identity before dropping `admin_credentials`. Employee PIN-based self-service login remains as-is.
- **Every sensitive operation records the acting account.** Invoices record the acting account as "authorized by" (requirement 8). There is **no approval hierarchy** (owner decision: voids/refunds may be done by cashier or admin alike); the data model keeps an optional approving-account field for the future, but nothing requires it today.

---

## 7. Locked product decisions

| Topic | Decision |
|---|---|
| Delivery | Hosted web app (per-customer installation) |
| UI language | Arabic, RTL — consistent with existing `apps/web` |
| Admin login | Seeded from `.env` (kept, becomes first Admin account — §6) |
| Cashier accounts | One branch-scoped cashier login per branch. Admin uses one create/edit form for credentials and a searchable employee multi-select. Creation requires a password; editing can keep the current one and preserves disabled status. Credentials and the branch roster save atomically; assigned employees appear in the accounts table (§6) |
| Inventory | Full stock tracking: purchases increase, POS sales decrease, low-stock alerts |
| Commissions | Configurable rate per service **with per-employee override**; recorded in an ERP-owned immutable ledger, projected into payroll (§8) |
| Receipts | 80mm thermal receipt at POS **and** A4 PDF export in reports |
| Clients | Real clients database: search by phone at POS, visit history — not free text per invoice |
| Payment methods | Cash, Visa, InstaPay, Vodafone Cash (fixed list; adding one is a code change — accepted) |
| Locale | Egypt: EGP single currency, `Africa/Cairo`, `ar-EG`; receipts and PDFs Arabic-only |
| Employee assignment | **One checked-in employee per service or product line.** POS keeps units independently assignable, and the default employee fills unassigned lines. The sale no longer selects a separate cashier employee or requires cashier roster membership; the acting account and open shift still authorize it. A completed, not-yet-refunded service line can be reassigned with a reason, immutable history, and matching commission correction |
| Clients on invoices | **Mandatory** — every invoice references a client record; no anonymous sales |
| Payment timing | Service invoices must be paid in full. **Product-only invoices may be partially paid**, keep an open balance on the same invoice, and accept additional payments later. Deposits, prepaid packages, and service credit remain out of scope |
| Service pricing | Optional catalog price: fixed prices are locked during sale; services without a catalog price require a positive seller-entered unit price. Admins convert modes by deleting or adding the catalog price. |
| Assignment eligibility | **Strictly checked-in employees** for new sales and cashier reassignment. Admins may reassign an existing service to any active employee in the same branch regardless of attendance; reasons, audit history, refund restrictions, and payroll locks still apply |
| Product commission | Configurable percentage per product; paid to the employee assigned to that product line and recorded in the same immutable commission ledger. Zero-commission products still retain their assigned employee. Branch transfers remain employee-free and commission-free |
| Deployment model | **Per-customer installation** (own server + own MySQL) — confirmed; §4 rests on this |
| POS sessions | **Exactly one open cashier session per branch at a time** — two cashiers can never be open simultaneously |
| Login split | Employee code+PIN login exists **for attendance/self-service only**; business actions (selling, invoices, …) require an account (§6) with username + password |
| Migrations & core | All schemas migrate on every installation regardless of edition; `audit` is always-on core — both confirmed |
| Split payments | **Allowed** — a payment may be split across Cash, Visa, InstaPay, and Vodafone Cash. A completed product-only invoice may initially receive less than its total and later receive additional payment rows until settled |
| Discounts | **Invoice-level only** (no line discounts), as **% or fixed amount**, applied/edited freely by the cashier, recorded with the acting account |
| Tax | Symmetric with discount: an invoice-level **% or fixed amount** that can be activated/edited per invoice (adds where discount subtracts) |
| Commission base | **Pre-discount sale unit price.** For open-price services this is the seller-entered price. Discounts are the shop's cost, never the employee's — invoice discounts don't touch the commission ledger |
| Roles | **Admin + Cashier only, final.** Admin = full (HR + ERP); Cashier = ERP/POS login only, HR rejects it; employees = HR attendance/self-service only (§6) |
| Refund after payroll finalized | Becomes an HR **deduction** for the employee (submitted via public capability). Employees can **view their commission totals** |
| Invoice numbers | One global increasing sequence, formatted as a numeric string with a minimum width of six digits (for example, `000001`); numbers do not reset each day, and gaps from rolled-back sales are acceptable because numbers are never reused |
| E-invoice/ETA compliance | **Out of scope** — no legal/government integration |
| Cashier sessions | Open/close and a printable end-of-shift report record cashier, branch, duration, sales, returns, discounts, tax, net sales, expenses, collections, credit sales, and net totals per payment method. There is still no cash-drawer counting or reconciliation; the drawer is trusted |
| Voids & refunds | Performed by cashier **or** admin (no approval hierarchy), always recorded with acting account. For a refund, the cashier freely splits the cash payout across Cash, Visa, InstaPay, and Vodafone Cash, independently of the original tenders. Refund of a product line restores stock; any refund appends commission reversal entries (§8) |
| Payment references | **Not recorded** — payment methods are labels only, no transaction IDs or provider reconciliation |
| Offline behavior | **Degrade gracefully:** completed sales queue locally (browser storage) with their idempotency keys and sync when the connection returns — never a lost sale, never a duplicate (§8) |
| Service queue | Every sold service unit receives a static queue number scoped to its cashier shift and service. Operational status moves from not started (`pending`) through in progress to completed. Numbers print on the receipt and appear in service views and reports; this is not a live serving-position board |
| Customer services and consumables | A Cashier or Admin updates service status independently from consumables. Every sold service must be completed before manual shift closing, but a completed service may still have unrecorded consumables. Recording later stores the quantities used, or explicit confirmation that none were used, without changing service status. Sales cancellations remove unfinished services from the operational workflow. The POS workspace separately manages service status, consumption capture, `ml`/`gm` package configuration, transfers, balances, valued ledger history, usage, and completion reports. Completed services are final in the operational UI. |
| Stock operations | Recommended defaults (owner delegated): stock **adjustments** with reasons (count correction, wastage, damage) via stocktaking; one unit per product; **no** variants. **Superseded in part:** inter-branch transfers **were later implemented** — the `transfers` module moves stock between branches at cost through a generated zero-commission invoice (the receiving branch appears as a transfer client), with idempotency keys and a printable transfer receipt |
| Costing | **Last purchase cost** is the cost basis |
| Suppliers | **No returns; purchases always fully paid** — no supplier balances or credit |
| Negative stock | **Never allowed, with no override** |
| Appointments | **Staff-only appointment book in the POS.** Admin or Cashier records a client, one or more services, optional preferred employees, date/time and note. Arrival hands the booking to the normal sale flow; there is no public booking page, deposit, reminder integration, or automatic double-booking rule. |
| Backup/restore | **No in-app backup feature.** (Strong ops recommendation, separate from the product: automated server-level MySQL dumps per installation) |
| Categories | **One table** with a type flag (`service` / `expense`), name unique per type — chosen as the production-ready option (single CRUD, single audit path) |
| Multi-frontend security | **Same-origin `/api` proxy path per frontend** (§5): cookies stay `SameSite=strict` host-only, no CORS relaxation, independent HR/POS sessions |

---

## 8. POS correctness requirements (decided direction)

These are architectural invariants, not features — the sales module is designed around them from day one.

### Commission ledger, not direct bonus rows

Commissions are **ERP-owned** in an **immutable, append-only ledger**: one earned entry per service or commissioned product line for that line's assigned employee, snapshotting the rule and rate that applied. Refunds append reversal entries. A permitted post-sale employee correction appends reassignment-out and reassignment-in entries instead of erasing the original assignment. Every completed service sale or pre-finalization reversal/reassignment transactionally refreshes the affected HR-owned payroll inputs containing each employee/month's current **net** commission. Their deterministic identities make retries idempotent and keep open payroll previews current. Payroll finalization snapshots the value into the immutable payroll row. If a later refund targets a month whose payroll is already finalized, ERP leaves the snapshot untouched and submits one idempotent HR deduction in the Cairo month of the reversal. Payroll never reads or writes ERP tables directly; ERP uses HR-core public projection and deduction capabilities while the immutable ERP ledger remains the traceable source.

Admins and cashiers can pay any part of currently available commission before payroll finalization. Cashiers view employees with commission activity in their assigned branch and pay from that branch's drawer; admins select the paying branch. Each payout requires an open cashier shift in the paying branch and atomically creates a linked cash expense and audit event. Payroll shows gross commission and the amount already paid separately. If a later refund makes commission smaller than payouts, the excess is carried against future commission instead of reducing base salary; prior commission reversals use the same carry. The general expense correction screen cannot alter a linked payout expense.

Why not insert ordinary bonus rows at sale time: they lose refund reversibility, historical rate context, deterministic replacement under retries, and the audit path from salary back to invoice. The dedicated live input can be updated only until payroll finalization; the immutable ERP ledger remains the source of the calculated total.

ERP17's migration backfills deterministic live inputs from the existing ledger only for employee-months without a finalized payroll snapshot. Historical finalized payrolls keep `commission_amount = 0.00`, explicitly recording that legacy ERP commission was not paid through Payroll; later reversals of those unpaid legacy amounts do not create deductions. New finalized payrolls snapshot the live input and remain eligible for later reversal deductions.

### One transaction per completed sale

Completing a POS sale is **one database transaction** covering, atomically:

1. Invoice + invoice-line creation
2. Payment record(s)
3. Stock movements
4. Commission ledger entries
5. Audit event
6. Invoice number allocation

Either the whole sale exists or none of it does. Receipt **printing is outside the transaction**: printing failures trigger reprint of the stored invoice, never a re-submission of the sale.

### Idempotency and concurrency

- Every POS sale submission carries a **client-generated idempotency key**; double-clicks, network retries, and API retries all resolve to the same single invoice. The same mechanism powers offline degradation (§7): a sale completed during a network loss is queued locally and replayed on reconnect, and the key guarantees replay can never duplicate an invoice.
- Concurrent sales of the last stock item are decided at transaction commit (row-level locking on stock); the loser gets a clear "out of stock" outcome. Negative stock is never allowed, with no override.
- **Exactly one open POS cashier session per branch** is a database-enforced invariant (a unique open-session index, the same pattern attendance uses for `open_employee_id`). Opening a second session while one is open is rejected.

### Historical snapshots on every invoice line

Invoices are **facts about the past** and must never change when the catalog changes. Each **line** snapshots at sale time:

- Item name and type (service/product)
- Unit price (fixed catalog price or seller-entered open price — also the commission base, §7)
- Commission rule and rate used
- Cost basis, where relevant (products)

Each service line snapshots its original assigned employee. Reads overlay any later audited reassignment as the current performer while retaining the original assignment history. The invoice also snapshots the discount (kind: % or fixed, value, and computed amount), tax (same shape), totals, and payment history. Product lines have no performer. Additional product-only partial-payment rows and refund-payment rows append later without rewriting the original sale facts.

Renaming a service or changing its price affects future invoices only.

### ERP reporting and recognition — delivered in ERP19

ERP reports are Admin-only and branch/date filtered. Each tab keeps its own business row scope; for example, sales use one row per invoice while commissions use one row per employee with service count, earned, reversed, and net commission. Rows can be selected across result pages for selective PDF export, and every on-screen or printed report presents each applicable total as a dedicated table row. Screen pages and export batches share one ERP SQL reader and use repeatable-read snapshots so totals and rows describe one database state. Sales are recognized on the Cairo sale date; refunds and voids are separate reversal events recognized on their Cairo event date. Historical labels and monetary bases come from immutable invoice and ledger snapshots rather than current catalog records.

Product profit is calculated as net product revenue after the invoice discount is allocated exactly across invoice lines, excluding tax, less the product line's snapshotted last-purchase-cost basis multiplied by quantity. A product reversal negates both the allocated net revenue and the corresponding snapshotted cost. This preserves historical profit when catalog names, prices, or purchase costs later change.

The shared database-backed report queue renders Arabic landscape A4 PDFs for the 21 tabular ERP reports and Arabic portrait A4 PDFs for one selected stored invoice. Invoice PDFs include snapshotted client, employee, line, payment, discount, tax, total, and acting-account facts. The Admin invoice detail exposes queue, status, retry, and download controls independently from void/refund mutation state.

### Cross-feature administration UX — delivered in ERP20

The POS now exposes one role-aware, grouped Arabic/RTL navigation model and an Admin landing page for the delivered cashier-account, catalog, client, supplier/purchase, product/stock, expense, invoice, commission, report, and export workflows. Duplicate page headings were removed, Admin-only product and supplier URLs are guarded directly, and page landmarks, skip navigation, responsive layouts, loading and success announcements, empty/error states, and destructive confirmations follow shared patterns.

Related mutations invalidate their owning data and every affected downstream view, including reports, stock, clients, commissions, and sales. Pending mutations keep their editor, confirmation state, and identity active until settlement, while local branch/tab controls plus shell navigation and logout remain locked. Component coverage and wide/compact browser journeys verify navigation continuity, direct-route permissions, destructive actions, purchase-to-product-stock propagation, and cross-feature layout behavior.

---

## 9. ERP module group status

The `apps/api/src/modules/erp/` group is delivered through ERP20, with matching schema folders in `packages/database/src/schema/` and contracts in `packages/contracts`. The `erp-reports` module was the final backend module delivered in ERP19, ERP20 integrated the workflows into the hardened Admin experience, ERP21 delivered the named runtime editions, and ERP22 delivered the multi-frontend production boundary. Section 10 still tracks documentation and validation work for void/refund semantics, the offline sale queue, and invoice numbering, as well as the printing decision and deployment validation:

| Module | Purpose |
|---|---|
| `catalog` | Categories (services + expenses), services, products |
| `suppliers` | Suppliers and purchases (purchases feed stock) |
| `stock` | Quantities on hand, movements, low-stock alerts |
| `sales` | POS: invoices, invoice lines, payment ledger/open balances, per-service-line employee assignment and correction, refunds, static service queue numbers, cashier sessions, and printable shift reports |
| `expenses` | Categorized expenses |
| `clients` | Client records (name, phone, visit history) |
| `assignment` | Read-only surface listing strictly checked-in employees eligible for service-line assignment |
| `bookings` | Staff-only appointment book (§7) |
| `commissions` | Immutable commission ledger, payouts, and payroll projection (§8) |
| `consumables` | `ml`/`gm` package configuration, consumption capture, balances, and valued ledger |
| `transfers` | Inter-branch stock transfers at cost through a generated zero-commission invoice |
| `fixed-assets` | Fixed-asset register |
| `erp-reports` | 21 tabular ERP reports plus invoice/report PDF export and browser printing through the existing worker pipeline |

Plus: `apps/pos` (new Next.js frontend), the account/role model in HR core (§6), and the edition wiring (§4).

---

## 10. Remaining design and validation work

The ERP schemas, POS sale flow, employee commission visibility, void/refund endpoints, offline sale queue, and global invoice allocator are implemented. Since this list was written, two items have been resolved in code:

- **Thermal printing — decided and implemented.** Browser print CSS through the Windows driver; no local print agent. The counter hardware is known and codified in `apps/pos/src/lib/print/hardware.ts`: an Xprinter XP-T80Q 80mm receipt printer, an Xprinter XP-233B sticker printer (product barcode labels), and a Datalogic QW2100 1D scanner. Receipts, refund notes, shift reports, transfer receipts, booking tickets, and label sheets all print via `window.print()` with dedicated `@page` rules. The cash drawer stays manual because a browser cannot address the drawer port.
- **Void and refund semantics — implemented behavior.** A void is a full reversal allowed only on the same Cairo date as the sale (`VOID_DATE_EXPIRED` afterwards) and only for completed, fully-paid invoices (a partially paid open invoice cannot be voided). Refunds are full or partial, allowed on completed or partially refunded invoices, restore stock on product lines, and append commission reversals (§8). Both record the acting account.

The remaining work is:

1. **Offline queue** — document and validate the implemented local storage, replay, and failure experience at the counter against §7/§8.
2. **Invoice sequence** — validate the implemented global, non-reusable numeric sequence in the deployment environment and reconcile any remaining legacy daily-sequence references.
3. **Deployment and environment validation** — verify these workflows with the target infrastructure and hardware.

---

## 11. Build order

**Start with a thin vertical slice, not with the edition/registry wiring.** The registry generalizes *proven* boundaries; building it first would mean generalizing guesses.

1. **Vertical slice** (single branch, minimal UI, real database):
   `cashier login → client lookup → service sale → employee assignment (from live attendance) → payment → receipt`
   This forces the account model, the attendance capability, the sale transaction, invoice numbering, snapshots, and the first POS screens — every risky unknown — to the front.
2. Harden the slice: idempotency, concurrency, commission ledger, audit.
3. Grow outward: products + stock, suppliers, expenses, clients history, reports/PDF.
4. **Delivered:** module registry, editions, compose profiles, and multi-frontend production security.
5. Deploy Capella as `EDITION=full`, then validate the `hr` and `erp` editions from the same codebase.

---

## 12. Product sync between branches — decided, not implemented

Status: **decided by the owner on 2026-10-27 and revised on 2026-10-28 (the 2026-10-28 answers replaced every conflicting earlier decision). Nothing here is implemented yet.** The feature must work for **any** branches; no rule depends on specific branches or on sample data.

### 12.1 Goal

A sender branch (A) shouldn't need its products created by hand again in the branches it supplies (B). The admin links A ⇒ B; from then on, **every product A creates is created once in B with the same name and description**. After that one-time copy, B's product is B's own. Linked products also let transfers find the right product in the other branch.

### 12.2 How products work today (verified in code on 2026-10-27 and 2026-10-28)

```
Branch A ── own product rows ──┐
Branch B ── own product rows ──┤  no link between them
                               │
Only meeting point: a transfer ┘  finds the receiving-branch product by NAME,
                                   or creates a copy if none exists
```

- `erp_products` is branch-scoped: name, description, selling price (required, `not null`), last purchase cost, commission %, low-stock alert, barcode, active. Name and barcode are unique **per branch** (`erp_products_branch_name_unique`, `erp_products_branch_barcode_unique`).
- Stock (`erp_product_stocks`), movements, consumable settings/balances and batch balances are per branch.
- A **batch** (`erp_stock_batches`) has no branch column. After a transfer, both branches point at the **same** batch record, so an expiry edit in one branch changes the other (decided below to change).
- Name matching uses `normalizeCatalogName` = sha256 of the trimmed, lower-cased name (`apps/api/src/modules/erp/catalog/categories-service.ts:47`).
- In-store barcode = `200` + product ID + EAN-13 check digit (`packages/contracts/src/modules/erp/stock/index.ts:69`). Product IDs are global, so the same item gets a different in-store code in each branch.
- **Selling price is only ever typed by hand** (product create/edit). A purchase updates only `lastPurchaseCost` (`suppliers/suppliers-repository.ts:61`); purchase lines carry `unit_cost`, never a selling price. A transfer copies A's price only when it *creates* B's product, and never changes an existing product's price.
- **Inactive products are blocked everywhere**: purchases reject them (`PURCHASE_PRODUCT_INACTIVE`, `suppliers-repository.ts:57`), transfers reject an inactive receiving product (`TRANSFER_DESTINATION_PRODUCT_INACTIVE`, `stock-transfer-repository.ts:193`), and the till quotes only active products (`sales/sale-repository-read.ts:414`).
- Products are never deleted, only deactivated.

#### Every action that changes a product, or is driven by one

| # | Action | Who | What it changes | Source |
|---|---|---|---|---|
| A1 | Create product | Admin, cashier (own branch) | New product + stock 0 | `apps/api/src/modules/erp/stock/product-stock-service.ts` `create` |
| A2 | Edit details | Admin, cashier (screen hides commission from cashier) | Product row | same, `update` |
| A3 | Deactivate / reactivate | Admin, cashier | `isActive`; inactive can't be sold, bought or transferred | same, `update` |
| A4 | Generate in-store barcode | Admin, cashier | Barcode from product ID | same, `generateBarcode` |
| A5 | Print labels | Admin, cashier | Nothing | `apps/pos/src/features/products/components/product-label-sheet.tsx` |
| A6 | Stock adjustment | Admin (screen); API also accepts cashier | Stock, batches, movement | `product-stock-repository.ts` `adjust` |
| A7 | Edit batch expiry | Admin | Batch expiry (shared after transfer) | `product-stock-repository.ts` `updateBatchExpiry` |
| A8 | Post purchase | Admin, cashier | Stock up, new batch, last purchase cost replaced | `suppliers/suppliers-repository.ts` `postPurchase` |
| A9 | Cancel purchase | Admin, cashier | Stock down, cost rolled back | same, `cancelPurchase` |
| A10 | Sale | Admin, cashier | Stock down; snapshots name, price, cost, commission % | `sales/sale-repository-complete.ts`, `sale-repository-read.ts` `quoteProducts` |
| A11 | Refund / void | Admin / cashier | Stock back up | `sales/sale-repository-reverse.ts` |
| A12 | Transfer | Admin, cashier (from own branch) | Sender: invoice at cost, stock down. Receiver: product found by name or auto-created, stock up, cost replaced | `transfers/stock-transfer-*.ts` |
| A13 | Consumable unit / package size | Admin | Consumable settings (only when balance is 0) | `consumables/consumables-repository.ts` |
| A14 | Reserve / return consumable packages | Admin | Sellable stock ↔ consumable pool | same |
| A15 | Record / correct consumption | Admin, cashier | Consumable balance | same |
| A16 | Offline sale queue | Till | Replays by product ID; a rejected replay becomes a `conflict` with the server's message | `apps/pos/src/features/sales/offline-sale-queue.ts` |
| A17 | Reports | Admin | Read only; inventory uses current values, sales/profit use snapshots | `erp-reports/*-facts.ts` |

Bookings, commission payouts, expenses and fixed assets don't touch products. Transfer invoices can't be voided or refunded (`TRANSFER_NOT_REVERSIBLE`); a mistake is corrected by a reverse transfer.

### 12.3 Problems found during the investigation, and what was decided

| # | Problem | Decision |
|---|---|---|
| P1 | A transfer that auto-creates the product in the receiving branch copies name, description, price, cost and alert only — **no barcode and 0% commission** (`stock-transfer-repository.ts:202-209`) | **Fix.** The auto-created product also copies barcode and commission % |
| P2 | Transfers match the receiving product **by exact name only** (`:186-191`); a rename in either branch, or a hand-made link between differently named products, makes the next transfer create a duplicate | **Fix.** Linked products: transfers use the link. Otherwise: barcode first, then smart name match, then create (§12.8) |
| P3 | In-store barcodes differ per branch for the same item | **Intended.** Barcodes are never synced (§12.5); each branch owns its own |
| P4 | **Money risk.** The server doesn't block a cashier from setting commission % on products **or services**, or from stock adjustments; only the screens hide them. A cashier calling the API directly could set e.g. 100% commission, sell the item, and the employee assigned to the line earns the whole line (audited, but not blocked). Products: `product-stock-service.ts` `create`/`update`/`adjust`. Services: `catalog/services-service.ts` `create`/`update` (only per-employee overrides call `assertCatalogAdmin`) | **Fix first, on its own, before the sync work.** Server rejects commission % from cashiers (create and update, products and services) and rejects cashier stock adjustments, matching the screens |
| P5 | Name matching ignores only case and outer spaces; double spaces, أ/إ/آ vs ا, ة vs ه, ى vs ي, and تشكيل make the same item look different | **Fix, between branches only** (§12.7) |
| P6 | A synced product in B starts inactive with no stock, but inactive products can't receive a purchase or transfer, so it could never be activated | **Fix.** New product state **"awaiting first stock"**, separate from "inactive" (§12.9) |

### 12.4 Link rules (which branches can be linked)

```
Allowed:                 Not allowed:
  A ⇒ B                    B ⇒ A   while A ⇒ B exists   (reverse / two-way)
  A ⇒ C                    A ⇒ B ⇒ C                    (chain: a receiver can't send)
  (one sender, many        A ⇒ B  and  D ⇒ B            (two senders for one receiver)
   receivers)
```

- **One way.** A link has a sender (A) and a receiver (B). Products only flow A ⇒ B.
- **A sender can have many receivers.**
- **A receiver has exactly one sender.**
- **No chains.** A branch is either a sender, a receiver, or neither — never both.
- Admin only: create a link, run setup, settle conflicts, unlink.
- Where: a new admin-only section inside "المنتجات والمخزون".
- Products only — not services, not categories.

### 12.5 What is copied

When A creates a product, B's copy is created **once** with:

| Field | B's copy | Notes |
|---|---|---|
| Name | A's name | Once. B can rename it later; nothing follows from A |
| Description | A's description | Once. Same as name |
| Selling price | **0** | Set by B's admin at activation (§12.9) |
| Last purchase cost | 0 | Comes from B's own purchases/transfers |
| Stock | **0** | Never synced. Moving goods is a transfer |
| State | **Awaiting first stock** | Not sellable (§12.9) |
| Barcode | Empty | Never synced. Each branch manages its own |
| Commission %, low-stock alert | Defaults | B sets its own |
| Batches / expiry, consumable settings | None | B's own (§12.10) |

After the copy, **nothing syncs again**: A's renames, description edits, price changes, deactivation and barcode changes never touch B, and B can change anything on its copy. The link between the two products stays, for transfers.

### 12.6 First link (setup, one time per A ⇒ B, admin only)

The link is **pending** until setup is finished. Nothing syncs while it is pending.

```
Automatic (no popup):
  same barcode in A and B                 → linked
  else exactly one smart name match       → linked
  B's name, description and everything else stay B's own

Conflict popup (the admin must settle every row):
  1. one product matches 2+ products (either side) → pick the right one
  2. same name, but each has a DIFFERENT barcode    → same item (link) | not the same item
  3. a link the system made is wrong                → change it to the right product
  4. product only in A                              → create it in B (as in §12.5) | don't copy to B
  5. product only in B                              → left alone; it is B's own (no row to settle)

"Not the same item" (row 2, or a create clash in §12.11) — B can't hold a
second product with the same name, so the admin chooses:
  → create B's copy under a NEW name the admin types (linked, as in §12.5)
  → don't copy to B
```

- **All rows must be green before sync starts.** If the admin closes the popup halfway, the link stays pending and nothing is half-synced.
- The setup screen is calculated live: a product A creates while setup is open appears as one more row.
- Product links are **one-to-one per A ⇒ B**: a B product can be linked to only one A product, and the other way round.
- **"Don't copy to B"** is a settled (green) answer, stored as an **excluded** entry for that A product (and, for "not the same item", the B product it was compared with). It is never asked again automatically. The sync screen lists excluded products, so the admin can later link or create them by hand.
- Data shape: one `erp_product_links` row per settled A product per A ⇒ B: `sender_branch_id, receiver_branch_id, sender_product_id, receiver_product_id (null when excluded), state linked | excluded, not_same_as_product_id (null unless "not the same item")`. Unique on `(sender_branch_id, receiver_branch_id, sender_product_id)` and on `(sender_branch_id, receiver_branch_id, receiver_product_id)`; MySQL allows many nulls, so excluded rows don't collide. Branch links live in `erp_branch_links` (`sender_branch_id, receiver_branch_id, state pending | active`).

### 12.7 Smarter name matching (P5)

- Comparison ignores repeated spaces and Arabic diacritics (تشكيل), treats أ/إ/آ as ا, ة as ه, ى as ي, plus the existing trim + lower-case.
- Used **only between branches**: first link, the clash check when A creates a product, and transfers.
- The duplicate-name check **inside** one branch stays exactly as today (not changed for products, services or categories), so no existing names need renaming.
- **Stored, not computed on the fly:** a new `erp_products.match_key` column (sha256 of the smart-normalized name), backfilled by migration and updated on every create and rename, with a **non-unique** index on `(branch_id, match_key)`. It has to be stored because transfers find and **lock** the receiving row by it, and setup compares whole branches. It is non-unique because in-branch uniqueness still uses the old rule, so one branch can hold "Hair Oil" and "Hair  Oil"; two hits = "matches 2+" (§12.6 row 1).

### 12.8 Transfers

- **Linked products**: the receiving product is found **through the link**, in either direction (a transfer B → A of a linked product also uses it). Renames and hand-made links no longer create duplicates. Product links stay after the branch link is removed (§12.11), so they keep working here.
- **Not linked**: find the receiving product by **same barcode first**, then **smart name match**, and only if neither finds one, create it, copying barcode and commission % too (P1).
  - Example: both branches sell the same oil with the same box barcode, but each typed a different name. A sends 5 boxes to C → they're added to C's existing oil, not to a new product.
  - Because barcode is matched first, a newly created product can't collide with an existing barcode in the receiving branch.
- **Auto-link on transfer:** when the transfer goes **along an active link** (A ⇒ B direction), the A product has no entry yet for that link, and the receiving product found (or created) isn't linked to another A product, the transfer also records the product link. Otherwise nothing is linked automatically.
- **Excluded / "not the same item":** a transfer never lands on a B product that was marked "not the same item" for this A product, and never creates around an exclusion. If that leaves no valid receiving product (e.g. the only free name is taken), the transfer is **refused** with an Arabic message pointing the admin to the sync screen to link or create the product first.
- A transfer into an **awaiting first stock** product is allowed (§12.9). An awaiting product can't be **sent** (it was never activated); today's sender check already refuses non-active products (`stock-transfer-service.ts:222`), so that stays.
- The receiving branch gets **its own batch copies** (§12.10).
- Lock order: the current deadlock-safe sort by `nameNormalized` becomes a sort by the receiving product's lookup key (link target id first, then `match_key`), kept deterministic.
- Everything else stays as today: at cost, zero commission, generated invoice, not reversible.

### 12.9 Awaiting first stock and activation

```
A creates X ──► B: X created  (price 0, stock 0, AWAITING FIRST STOCK — not sellable)
                     │
     purchase or transfer arrives (stock > 0) — product still not sellable
                     │
     B's admin presses "Activate" → types the selling price (> 0) → ACTIVE
```

- **"Awaiting first stock" is its own state**, not "inactive":
  - purchases and transfers into it are **allowed**;
  - the till **can't sell it** (same as inactive);
  - "inactive" (turned off by someone) keeps refusing purchases and transfers exactly as today.
- **Activation is always a manual button for B's admin**, never automatic — after a purchase *and* after a transfer, so both work the same way.
- **Activate requires stock > 0 and a selling price > 0.**
- **Where the price comes from:** a purchase has no selling price (§12.2), so the admin types it. After a transfer, the price box is pre-filled with the sending branch's selling price; the admin can keep or change it.
  - Pre-fill source: the **current** selling price of the source product on the **latest transfer line into this product** (`erp_stock_transfer_lines.destination_product_id` → `source_product_id`). No new column. No transfer → empty box.
- The same state is used for products created in B by setup row 4 and by the "new name" choice (§12.6).
- **Column shape:** keep `is_active` and add `awaiting_first_stock boolean not null default false`, with a check that `awaiting_first_stock = true` implies `is_active = false`. Reason: the till and every "sellable" check already filter on `is_active = true`, so they refuse awaiting products with **no change**. Only the purchase check (`suppliers-repository.ts:57`) and the receiving-side transfer checks (`stock-transfer-repository.ts:193`, `:223`) change, to `is_active or awaiting_first_stock`. Existing rows migrate as `false` (no behavior change).
- Activate sets `is_active = true`, `awaiting_first_stock = false`, `selling_price = <typed>`, in one transaction with the stock row locked (stock > 0 checked under the lock). Deactivating an awaiting product makes it plain inactive (`awaiting_first_stock = false`).
- Product list: shows three states (active / inactive / awaiting) with an awaiting filter.
- `selling_price` stays `not null` (0 until activation). Empty price on a **service** keeps its existing, different meaning ("the seller types the price at sale time"); products don't use that rule.

### 12.10 Batches and expiry

- Today a transfer makes B's boxes point at A's batch record, so an expiry fix in either branch changes both.
- **Decided: change it.** After a transfer, the receiving branch gets **its own batch copy**, starting with the sent expiry date. From then on each branch edits its own expiry; nothing goes A → B or B → A. Each branch's expiry comes from its own purchase (supplier) or the transfer that brought the goods.
- Example: A buys 20 boxes (expiry 1 Jan) and sends 5 to B. B finds the real date on its 5 boxes is 1 Feb and edits it. A's 15 boxes stay 1 Jan.
- Implementation note: today's shared-lot model (`stock-batches.ts` `addBatchQuantities` reuses the sender's batch ID on transfer-in) must change: on transfer-in, create a new `erp_stock_batches` row (`origin_product_id`/`origin_branch_id` = the receiving product/branch, same expiry) and put the received quantity on it.
- **Batches already shared by past transfers: not migrated; only new transfers split.** Reason: sale, refund, void and purchase-cancellation snapshots store batch IDs (`batches` JSON on movements and lines), and reversals put stock back into those exact IDs (`sale-repository-reverse.ts:182`). Rewriting IDs in historical snapshots risks corrupting refunds and reports. Old shared batches run out as stock is sold. Until then, editing the expiry of a batch that another branch also holds shows a warning naming that branch before saving.

### 12.11 Behavior once linked (setup all green)

| Event | Behavior |
|---|---|
| A creates a product (admin or cashier) | Created in B as in §12.5, and the two are linked |
| A creates "X", B already has its own "X" (smart name match) | **Conflict for the admin.** Only that product waits in a "needs attention" list; every other new product keeps syncing. Settle by: **same item → link to B's "X"** (if it isn't already linked to another A product) · **not the same item → create under a new name** · **don't copy to B** (§12.6) |
| Creating the copy in B fails for any reason | **A's product is still created.** The failure goes to the same "needs attention" list (settle: retry, or the same choices as above) |
| A edits, renames, reprices, deactivates or changes the barcode of a product | Nothing happens in B |
| B edits its copy (anything) | Allowed. Nothing happens in A |
| B creates a product | Stays in B only, not linked (one way) |
| Purchases, sales, refunds, voids, adjustments, consumable reserve/return/usage | Never synced; own branch only |
| Products list | A "linked" badge on linked products |
| Audit | Each branch gets its own audit entry; B's says it was created by sync from branch A by account Y |

**Unlink** removes the A ⇒ B branch link only:
- No more products are copied from A to B.
- Everything stays as it is: products in both branches, and the product links between them (so transfers keep using them).
- B can then be linked to a different sender. Linking A ⇒ B again later reuses the existing product links, so setup only shows the new differences.

**How "A is created even if B fails" is guaranteed (no crash gap, no worker):** A's product insert and all of its B copies run in **one database transaction**; each B copy runs inside its own **savepoint** (a nested Drizzle transaction). If a copy fails, only its savepoint is rolled back and a "needs attention" row is written in the same outer transaction, then A's product commits. A crash can't leave "A created, copy silently lost": either everything commits (product + copies + needs-attention rows) or nothing does. Locks are taken A first, then each receiver in branch-id order. One exception: a MySQL **deadlock** rolls back the whole transaction, so product create retries once on a deadlock error before failing. No outbox or worker job is needed (`apps/worker` today only runs attendance and reports).

### 12.12 Rights summary

| Who | Can |
|---|---|
| Admin | Create a link, run setup, settle conflicts and the "needs attention" list, unlink, activate awaiting products; everything a cashier can |
| Cashier in A | Create and edit products as today (no commission %, no stock adjustments — P4); a product they create is copied to B |
| Cashier in B | Edit B's products as today; can't activate an awaiting product |

### 12.13 Former open points — answered 2026-10-28

The owner asked Claude to answer these on their behalf; the answers are written into the sections above.

| # | Question | Answer |
|---|---|---|
| O1 | "X" in A is **not the same item** as B's "X", and B can't hold a second "X" | Admin chooses: create B's copy under a **new name** they type, or **don't copy to B** (§12.6) |
| O2 | Batches already shared by past transfers | **Not migrated**; only new transfers split. Expiry edit on a still-shared old batch warns first (§12.10) |
| O3 | Transfer of a not-yet-linked A product along an active link | **Auto-link** when both sides are free; never across an exclusion (§12.8) |
| O4 | How a "needs attention" clash is settled | Link to B's "X" · new name · don't copy (§12.11) |
| — | Store the smart match key or compute it? | **Stored** `match_key` column, non-unique index (§12.7) |
| — | Product state shape | Keep `is_active` + add `awaiting_first_stock` (§12.9) |
| — | Can an awaiting product be sent? | **No** (§12.8) |
| — | Activation price pre-fill source | Latest transfer line's source product, current price (§12.9) |
| — | Guaranteeing A's create when B's copy fails | One transaction + a savepoint per copy; retry once on deadlock (§12.11) |

### 12.14 Suggested order of work

1. **P4 money fix** (products + services, server-side), on its own.
2. Smart name matching helper (P5), used only between branches.
3. Transfers: link-aware matching, barcode-first when not linked, P1 copy fields, per-branch batch copies.
4. "Awaiting first stock" state + activation (stock > 0, price > 0), with purchases, transfers and the till updated.
5. Link model (rules in §12.4) + admin setup + conflict popup; new `erp-product-sync` module in the edition registry (on in `erp` and `full`).
6. Copy-on-create A ⇒ B, "needs attention" list, linked badge, audit in both branches, unlink.
