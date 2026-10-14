# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Reception / cashier** (primary by hours): works the front desk of one branch most of the day. Opens and closes the shift, sells services and products, manages the bookings diary, clients, refunds, consumables and stock of their own branch in the POS app (`apps/pos`).
- **Owner / single admin** (the paying client): oversees every branch, often **from a phone**. Uses the POS app in admin mode (all branches, reports, commissions, cashier accounts) and the HR web app (`apps/web`): employees, attendance, payroll, bonuses, deductions, advances, devices, reports, audit.
- **Employees**: check in and out on the branch phone (kiosk) or their registered personal phone, and read their own attendance, payroll and commissions in self-service.

Every screen must work fully on phone, tablet, laptop and desktop. Mobile isn't a reduced mode, because the owner works from a phone.

## Product Purpose

One system for a beauty center chain. It covers the counter (sales, bookings, invoices, stock, suppliers, expenses, commissions, reports) and the people (attendance with face verification, payroll, financial adjustments). It's sold as `hr`, `erp`, or `full` editions. Success means staff can finish counter work quickly without mistakes, and the owner can see and act on any branch from anywhere.

## Positioning

A salon POS with staff check-in built in. Sales are assigned to employees who are checked in at that moment, so commissions, attendance and payroll come from the same facts.

## Operating Context

- Arabic only, right-to-left, `Africa/Cairo` time for every date and time.
- Receipts print on 80mm thermal paper. Report, payroll and transfer sheets print on A4. Products have barcode labels, and the till uses barcode scanners.
- Admins choose a branch, and that choice is shared across POS pages. A cashier is always pinned to their own branch.
- Money moves through an open cashier shift. Payment methods: cash, visa, InstaPay, Vodafone Cash.

## Capabilities and Constraints

- Locked requirements in `docs/hr-specs.md` (Global interface requirements): every admin list has search where records are searchable, relevant default filters, combined search and filters, a reset action, and a clear Arabic empty message for filtered results.
- The same spec defers visual and interaction design ("Visual design boundary — Deferred"). The redesign fills that gap and must keep every locked RTL, functional, authorization, validation and workflow rule.
- Shared component boundary: `packages/ui`, used by both apps.
- Stack: Next.js 16, React 19, Tailwind CSS 4, TanStack Query, sonner toasts, lucide icons.

## Brand Commitments

- Name: **Capella — Spa & Beauty Center**. Logo: `assets/brand/capella-logo.png`.
- The new visual identity is built from the logo: dark espresso brown and a rose-gold / champagne nude (user confirmed, 2026-10-14).

## Evidence on Hand

- The logo is the only brand asset. There's no photography, illustration set or brand guideline document. Don't make up customers, prices or claims.

## Product Principles

1. Counter speed first: the most frequent cashier jobs take the fewest steps and never hide behind extra clicks.
2. The same thing looks and behaves the same everywhere: one search, one filter bar, one table, one confirmation, one feedback rule.
3. Every number explains itself: totals, states and locks are shown before the user acts, not discovered through an error.
4. Works fully on a phone; nothing important is desktop-only.
5. Never lose or misstate money: destructive or financial actions are confirmed and clearly labelled.

## Accessibility & Inclusion

- Arabic RTL throughout. Touch targets at least 44px on touch layouts. Visible keyboard focus. WCAG AA contrast for text and status colours.
