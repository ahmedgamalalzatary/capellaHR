# Capella HR

Domain-oriented HR monorepo template using Next.js, Express, Drizzle, MySQL, pnpm workspaces, and Turborepo.

## Workspace

- `apps/web` — employee and HR web application
- `apps/api` — versioned REST API modular monolith
- `packages/database` — Drizzle/MySQL boundary
- `packages/contracts` — REST DTO and validation boundary
- `packages/shared` — framework-independent types, enums, constants, utilities, and schemas
- `packages/config` — shared environment parsing
- `packages/ui` — reusable React UI boundary
- `packages/testing` — shared test setup and helpers
- `packages/eslint-config` — shared linting rules
- `packages/typescript-config` — shared compiler configurations

Business logic, authentication, database tables, deployment, containers, and CI/CD are intentionally excluded from the initial template.
