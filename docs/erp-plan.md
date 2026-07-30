# Beauty Center ERP — Decisions, Reasoning, and Plan

Status: **Step 1 — planning.** This document records every decision made so far, the reasoning behind it, and what remains open. It is the source of truth for why the ERP is built the way it is. Written 2026-07-29; revised same day after external design review (identity model, module boundaries, commission ledger, transactional invariants, snapshots, edition scoping, build order, cookie/CORS correction).

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

Context that shaped everything: the same owner already built **Capella HR** (this repository), the beauty center is **one branch** in its `branches` module, employees **check in through HR** (GPS-geofenced, face-verified), and the workflow in requirement 9 depends on live attendance data.

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

- **Stack:** Next.js + Express + **Drizzle ORM** + MySQL, pnpm workspaces + Turborepo, Docker Compose deployment, `apps/` = `api` / `web` / `worker`. (Note: earlier discussion said "Prisma" — the repo actually uses Drizzle.)
- **Modules are already optional at the wiring level.** `apps/api/src/routes/index.ts` mounts each module's router only if its service is passed into `createApp` (`apps/api/src/app.ts`). `server.ts` currently wires all 15 unconditionally; per-edition enablement is a small change, not a redesign.
- **Live presence already exists as data.** `attendance_sessions.open_employee_id` is a stored generated column (non-null while the session is open) with a unique index. The ERP will consume it **only** via a public capability such as `listPresentEmployees(branchId)` (Rule 2, §2) — the point is that the capability is cheap to provide, not that ERP queries attendance tables.
- **A payroll-input pipeline already exists.** `bonuses(employee_id, payroll_month, amount, reason)` is summed into `payroll_months.bonus_amount` at payroll finalization. Commissions are projected into this pipeline in a controlled way (§8) — ERP does not write HR tables directly.
- **Arabic RTL is already the house style.** `apps/web` renders `lang="ar" dir="rtl"` with IBM Plex Sans Arabic; locale `ar-EG`, timezone `Africa/Cairo`. The POS app follows the same.
- **PDF machinery already exists.** `apps/worker` polls DB-queued report jobs and renders PDFs via `packages/reporting` (`report-pdf.ts`). Invoice/report PDF export reuses this pattern instead of introducing a new one.
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
2. **UI/container availability** — Docker Compose **profiles**: the HR `web` container carries the `hr` profile, the new `pos` container carries the `erp` profile. An HR-only customer's server never even pulls the POS image.
3. **Database migrations** — **all schemas migrate on every installation regardless of edition.** Disabled modules' tables exist and stay empty. This is intentional: one migration history, no per-edition migration forks, and upgrading a customer to a bigger edition is config-only. The cost (unused empty tables) is accepted.

**The "ERP only" nuance (intentional):** ERP-only resolves to the always-on core plus `attendance` and its support dependencies, with `payroll` excluded — because client-assignment requires knowing who is present, while Attendance no longer requires Payroll to be constructed. HR-exclusive modules (payroll, advances, deductions, self-service, the HR frontend) stay off. Full HR continues to enable Payroll and inject its financial-lock capability into Attendance. Commercially this is a selling point ("a salon POS with staff check-in built in") and a natural upsell path to full HR via a config change.

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

- **Subdomains (recommended per installation):** `hr.customer.com` + `pos.customer.com` + `api.customer.com`, one wildcard certificate.
- **Two unrelated domains:** both DNS records point at the same server; each domain serves the API under its own `/api` path (proxy forwards both to the same API container) so cookies stay first-party.
- Separate big domains are best reserved for **marketing sites** per product edition.

**Security topology (decided — production solution).** The current implementation is single-frontend by construction: session cookie is `SameSite=strict` and host-only, and CORS accepts exactly one origin. Decision: **each frontend is served with the API under its own origin** — the reverse proxy exposes `hr.customer.com/api` and `pos.customer.com/api`, both forwarding to the same API container. Cookies stay first-party, host-only, and `SameSite=strict` exactly as today; no CORS relaxation and no new CSRF surface in production. HR and POS sessions are independent (an admin logs into each app separately). The CORS origin list is only ever a development convenience.

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
| Cashier accounts | Accounts with roles; employee optionally linked (§6) |
| Inventory | Full stock tracking: purchases increase, POS sales decrease, low-stock alerts |
| Commissions | Configurable rate per service **with per-employee override**; recorded in an ERP-owned immutable ledger, projected into payroll (§8) |
| Receipts | 80mm thermal receipt at POS **and** A4 PDF export in reports |
| Clients | Real clients database: search by phone at POS, visit history — not free text per invoice |
| Payment methods | Cash, Visa, InstaPay, Vodafone Cash (fixed list; adding one is a code change — accepted) |
| Locale | Egypt: EGP single currency, `Africa/Cairo`, `ar-EG`; receipts and PDFs Arabic-only |
| Employee assignment | **One employee per invoice** (the client's whole visit). Consequence, accepted: a client served by two specialists in one visit gets two invoices |
| Clients on invoices | **Mandatory** — every invoice references a client record; no anonymous sales |
| Payment timing | **Always paid in full at sale.** No deposits, tabs, installments, or prepaid packages — explicitly out of scope |
| Service pricing | One **fixed price** per service — no ranges, no cashier price entry; discounts are the only variation |
| Assignment eligibility | **Strictly checked-in employees**, no cashier override — an unchecked-in employee checks in via HR first |
| Product commission | **None** — commission applies to services only; product sales are tracked per invoice but earn nothing |
| Deployment model | **Per-customer installation** (own server + own MySQL) — confirmed; §4 rests on this |
| POS sessions | **Exactly one open cashier session per branch at a time** — two cashiers can never be open simultaneously |
| Login split | Employee code+PIN login exists **for attendance/self-service only**; business actions (selling, invoices, …) require an account (§6) with username + password |
| Migrations & core | All schemas migrate on every installation regardless of edition; `audit` is always-on core — both confirmed |
| Split payments | **Allowed** — one invoice may be paid by a mix of methods (e.g. part cash, part Visa); per-method amounts recorded, must sum to the invoice total |
| Discounts | **Invoice-level only** (no line discounts), as **% or fixed amount**, applied/edited freely by the cashier, recorded with the acting account |
| Tax | Symmetric with discount: an invoice-level **% or fixed amount** that can be activated/edited per invoice (adds where discount subtracts) |
| Commission base | **Pre-discount list price.** Discounts are the shop's cost, never the employee's — invoice discounts don't touch the commission ledger |
| Roles | **Admin + Cashier only, final.** Admin = full (HR + ERP); Cashier = ERP/POS login only, HR rejects it; employees = HR attendance/self-service only (§6) |
| Refund after payroll finalized | Becomes an HR **deduction** for the employee (submitted via public capability). Employees can **view their commission totals** |
| Invoice numbers | `INV-YYYY.MM.DD-HH.MM-<seq>` in Cairo time; `<seq>` is a daily incrementing counter; gaps from rolled-back transactions are acceptable (numbers are never reused) |
| E-invoice/ETA compliance | **Out of scope** — no legal/government integration |
| Cashier sessions | Open/close recorded (**who + when only**) — no cash-drawer counting or reconciliation; drawer is trusted |
| Voids & refunds | Performed by cashier **or** admin (no approval hierarchy), always recorded with acting account. Refund of a product line restores stock; any refund appends commission reversal entries (§8) |
| Payment references | **Not recorded** — payment methods are labels only, no transaction IDs or provider reconciliation |
| Offline behavior | **Degrade gracefully:** completed sales queue locally (browser storage) with their idempotency keys and sync when the connection returns — never a lost sale, never a duplicate (§8) |
| Consumables | **Not tracked** — products used while performing services are invisible to stock |
| Stock operations | Recommended defaults (owner delegated): stock **adjustments** with reasons (count correction, wastage, damage) via stocktaking; **no** inter-branch transfers; one unit per product; **no** variants |
| Costing | **Last purchase cost** is the cost basis |
| Suppliers | **No returns; purchases always fully paid** — no supplier balances or credit |
| Negative stock | **Never allowed, with no override** |
| Appointments | **Out of scope** |
| Backup/restore | **No in-app backup feature.** (Strong ops recommendation, separate from the product: automated server-level MySQL dumps per installation) |
| Categories | **One table** with a type flag (`service` / `expense`), name unique per type — chosen as the production-ready option (single CRUD, single audit path) |
| Multi-frontend security | **Same-origin `/api` proxy path per frontend** (§5): cookies stay `SameSite=strict` host-only, no CORS relaxation, independent HR/POS sessions |

---

## 8. POS correctness requirements (decided direction)

These are architectural invariants, not features — the sales module is designed around them from day one.

### Commission ledger, not direct bonus rows

Commissions are **ERP-owned** in an **immutable, append-only ledger**: one entry per service line for the invoice's assigned employee (rates vary per service; the employee is fixed per invoice — §7), snapshotting the rule and rate that applied. Refunds append **reversal entries**; nothing is ever updated or deleted. On payroll finalization, the applicable **net** commission per employee per month is **projected** into the existing payroll-input pipeline (a bonus-like input) with a **deterministic reference** (e.g. `erp-commission:<month>:<employeeId>`), making the projection idempotent and traceable from a payroll number back to individual invoice lines. Payroll never reads ERP tables; the ERP calls an HR-core public capability to submit the projection (Rule 2, §2).

Why not "insert a bonus row at sale time": it loses refund reversibility, historical rate context, idempotency under retries, and the audit path from salary back to invoice.

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
- Unit price (list price — also the commission base, §7)
- Commission rule and rate used
- Cost basis, where relevant (products)

The **invoice** snapshots: the assigned employee (§7), the discount (kind: % or fixed, value, and computed amount), the tax (same shape), the resulting totals, and the per-method payment breakdown.

Renaming a service or changing its price affects future invoices only.

---

## 9. Planned ERP module group (draft — detailed design is Step 2)

New group `apps/api/src/modules/erp/` (mirroring the existing module conventions: `routes/controllers/services/repositories/schemas/dto/tests`), with matching schema folders in `packages/database/src/schema/` and contracts in `packages/contracts`:

| Module | Purpose |
|---|---|
| `catalog` | Categories (services + expenses), services, products |
| `suppliers` | Suppliers and purchases (purchases feed stock) |
| `stock` | Quantities on hand, movements, low-stock alerts |
| `sales` | POS: invoices, invoice lines, payments, invoice-level employee assignment, cashier sessions, commission ledger |
| `expenses` | Categorized expenses |
| `clients` | Client records (name, phone, visit history) |
| `erp-reports` | Sales/expense/employee-earnings reports + PDF export via the existing worker pipeline |

Plus: `apps/pos` (new Next.js frontend), the account/role model in HR core (§6), and the edition wiring (§4).

---

## 10. Open questions & Step 2 design work

All owner-level questions from the original list are now **answered and locked in §7** (rounds recorded 2026-07-29). What remains falls into two small buckets:

### Genuinely open (deferred by the owner)

1. **Thermal printing mechanism** — browser print CSS vs a local print agent. Deferred until printer hardware is chosen; the invoice/receipt data model does not depend on it. Default when building: browser print CSS first, agent only if the hardware demands it.

### Step 2 design deliverables (direction decided, details to draft)

2. **Full Drizzle schemas** for every ERP table + the accounts/roles migration in HR core (including retiring the `admin_credentials` singleton).
3. **Void vs refund definitions** — the *authority* is decided (§7: cashier or admin, no hierarchy); the exact semantics to draft: void = same-day full cancellation, refund = full or partial after the fact; both reverse stock (products) and append commission reversals.
4. **POS screen flow** (owner delegated the default): search/pick client → add service/product lines → assign present employee → discount/tax if any → mixed payment entry → complete (one transaction) → print/reprint. To be drafted as wireframes with the Arabic RTL layout.
5. **Employee commission visibility** — where employees see their totals (natural candidate: the existing HR self-service surface, fed by the ERP ledger through a public capability).
6. **Offline queue design** — the §7/§8 local-queue-with-idempotency-keys mechanism, drafted concretely (storage, replay, failure UX at the counter).
7. **Invoice sequence implementation** — the daily counter behind `INV-YYYY.MM.DD-HH.MM-<seq>` (same singleton-sequence pattern the repo already uses for `employee_code_sequence`).

---

## 11. Build order

**Start with a thin vertical slice, not with the edition/registry wiring.** The registry generalizes *proven* boundaries; building it first would mean generalizing guesses.

1. **Vertical slice** (single branch, minimal UI, real database):
   `cashier login → client lookup → service sale → employee assignment (from live attendance) → payment → receipt`
   This forces the account model, the attendance capability, the sale transaction, invoice numbering, snapshots, and the first POS screens — every risky unknown — to the front.
2. Harden the slice: idempotency, concurrency, commission ledger, audit.
3. Grow outward: products + stock, suppliers, expenses, clients history, reports/PDF.
4. **Then** generalize: module registry, editions, compose profiles, multi-frontend security design.
5. Capella goes live as `EDITION=full`; the `hr` and `erp` editions are cut from the same codebase afterwards.
