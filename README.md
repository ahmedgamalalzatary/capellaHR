# Capella HR + Beauty Center ERP

Domain-oriented monorepo for the Capella HR system and the beauty center ERP/POS, built as one modular product with sellable editions (`hr`, `erp`, `full`). Stack: Next.js, Express, Drizzle ORM, MySQL, a Python face-verification service, pnpm workspaces, and Turborepo.

## Workspace

- `apps/web` — HR web application (Arabic RTL): admin modules, attendance kiosk/device pairing, employee self-service
- `apps/pos` — beauty center POS frontend (Arabic RTL): sales, invoices, stock, clients, bookings, commissions, ERP reports
- `apps/api` — versioned REST API modular monolith serving both frontends
- `apps/worker` — background jobs: absence generation, attendance timeout, queued PDF report rendering
- `apps/attendance-ai` — Python face-verification service (YuNet detection, MiniFASNet temporal liveness, embedding comparison) called by the API during enrollment and attendance
- `packages/database` — Drizzle/MySQL schema and migrations
- `packages/contracts` — REST DTO and validation boundary (zod)
- `packages/config` — shared environment parsing and the edition registry
- `packages/ui` — reusable React UI boundary
- `packages/shared` — shared utilities
- `packages/eslint-config` / `packages/typescript-config` — shared linting and compiler configurations

## Editions

`EDITION` (`hr`, `erp`, or `full`) resolves the module set at startup; Compose profiles select the matching containers. All schemas migrate on every installation regardless of edition. See `docs/erp-plan.md` §4 and `docs/docker.md`.

## Development

Requires Node.js ≥ 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm dev        # turbo: all apps
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Documentation

- `docs/hr-specs.md` — living HR product specification (locked module requirements)
- `docs/erp-plan.md` — ERP decisions, reasoning, editions, and delivery status
- `docs/docker.md` — production Docker deployment on the VPS (Nginx/TLS on host, localhost-bound containers)
