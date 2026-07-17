# Architecture

The API is a modular monolith. Each domain owns its HTTP, application, persistence, validation, and test boundaries. Modules may depend on shared packages, but must not import another module's internal files.

Typical request flow:

`web feature -> REST client -> /api/v1/<module> -> route -> controller -> service -> repository -> Drizzle/MySQL`

Shared-package rules:

- `shared` contains framework-independent primitives only.
- `contracts` contains public REST request and response contracts.
- `database` owns Drizzle and MySQL details.
- `ui` contains React code and must not be imported by the API.
- App-specific code stays inside its app.

## Current folder structure

Generated dependency, cache, build, coverage, and Git internals are excluded (`node_modules`, `.turbo`, `.next`, `dist`, `coverage`, and `.git`).

```text
HR/
+-- apps/
|   +-- api/
|   |   +-- src/
|   |   |   +-- modules/
|   |   |   |   +-- attendance/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- audit/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- auth/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- benefits/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- departments/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- documents/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- employees/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- payroll/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- reports/
|   |   |   |   |   +-- controllers/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- dto/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- repositories/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- routes/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- schemas/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- services/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   +-- tests/
|   |   |   |   |   |   \-- .gitkeep
|   |   |   |   |   \-- index.ts
|   |   |   |   \-- README.md
|   |   |   +-- routes/
|   |   |   |   \-- index.ts
|   |   |   +-- shared/
|   |   |   |   +-- errors/
|   |   |   |   |   \-- .gitkeep
|   |   |   |   +-- http/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- logging/
|   |   |   |   |   \-- .gitkeep
|   |   |   |   +-- middleware/
|   |   |   |   |   \-- .gitkeep
|   |   |   |   \-- types/
|   |   |   |       \-- .gitkeep
|   |   |   +-- app.ts
|   |   |   \-- server.ts
|   |   +-- tests/
|   |   |   +-- helpers/
|   |   |   |   \-- .gitkeep
|   |   |   \-- integration/
|   |   |       \-- .gitkeep
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   +-- tsconfig.build.json
|   |   +-- tsconfig.json
|   |   \-- vitest.config.ts
|   \-- web/
|       +-- src/
|       |   +-- app/
|       |   |   +-- layout.tsx
|       |   |   \-- page.tsx
|       |   +-- components/
|       |   |   \-- .gitkeep
|       |   +-- features/
|       |   |   +-- attendance/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- audit/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- auth/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- benefits/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- departments/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- documents/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- employees/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- payroll/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- performance/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- reports/
|       |   |   |   +-- api/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- components/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- hooks/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- schemas/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- types/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   +-- utils/
|       |   |   |   |   \-- .gitkeep
|       |   |   |   \-- index.ts
|       |   |   +-- .gitkeep
|       |   |   \-- README.md
|       |   +-- hooks/
|       |   |   \-- .gitkeep
|       |   +-- lib/
|       |   |   +-- api/
|       |   |   |   \-- .gitkeep
|       |   |   \-- utils/
|       |   |       \-- .gitkeep
|       |   +-- providers/
|       |   |   \-- .gitkeep
|       |   +-- styles/
|       |   |   \-- .gitkeep
|       |   \-- types/
|       |       \-- .gitkeep
|       +-- tests/
|       |   \-- .gitkeep
|       +-- eslint.config.mjs
|       +-- next.config.ts
|       +-- next-env.d.ts
|       +-- package.json
|       +-- tsconfig.json
|       \-- vitest.config.ts
+-- docs/
|   \-- architecture.md
+-- packages/
|   +-- config/
|   |   +-- src/
|   |   |   +-- client.ts
|   |   |   \-- server.ts
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- contracts/
|   |   +-- src/
|   |   |   +-- common/
|   |   |   |   \-- index.ts
|   |   |   +-- modules/
|   |   |   |   +-- attendance/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- audit/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- auth/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- benefits/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- departments/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- documents/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- employees/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- leave/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- notifications/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- onboarding/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- organization/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- payroll/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- performance/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- positions/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- recruitment/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- reports/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- settings/
|   |   |   |   |   \-- index.ts
|   |   |   |   \-- .gitkeep
|   |   |   \-- index.ts
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   +-- README.md
|   |   \-- tsconfig.json
|   +-- database/
|   |   +-- migrations/
|   |   |   \-- .gitkeep
|   |   +-- src/
|   |   |   +-- schema/
|   |   |   |   +-- attendance/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- audit/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- auth/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- benefits/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- departments/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- documents/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- employees/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- leave/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- notifications/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- onboarding/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- organization/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- payroll/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- performance/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- positions/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- recruitment/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- reports/
|   |   |   |   |   \-- index.ts
|   |   |   |   +-- settings/
|   |   |   |   |   \-- index.ts
|   |   |   |   \-- index.ts
|   |   |   +-- seed/
|   |   |   |   \-- index.ts
|   |   |   \-- index.ts
|   |   +-- drizzle.config.ts
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   +-- README.md
|   |   \-- tsconfig.json
|   +-- eslint-config/
|   |   +-- next.mjs
|   |   +-- node.mjs
|   |   \-- package.json
|   +-- shared/
|   |   +-- src/
|   |   |   +-- constants/
|   |   |   |   \-- index.ts
|   |   |   +-- enums/
|   |   |   |   \-- index.ts
|   |   |   +-- schemas/
|   |   |   |   \-- index.ts
|   |   |   +-- types/
|   |   |   |   \-- index.ts
|   |   |   +-- utils/
|   |   |   |   \-- index.ts
|   |   |   \-- index.ts
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   +-- README.md
|   |   \-- tsconfig.json
|   +-- testing/
|   |   +-- src/
|   |   |   +-- builders/
|   |   |   |   \-- .gitkeep
|   |   |   +-- fixtures/
|   |   |   |   \-- .gitkeep
|   |   |   +-- helpers/
|   |   |   |   \-- .gitkeep
|   |   |   +-- index.ts
|   |   |   \-- setup.ts
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- typescript-config/
|   |   +-- base.json
|   |   +-- nextjs.json
|   |   +-- node.json
|   |   +-- package.json
|   |   \-- react-library.json
|   \-- ui/
|       +-- src/
|       |   +-- components/
|       |   |   \-- .gitkeep
|       |   +-- hooks/
|       |   |   \-- .gitkeep
|       |   +-- styles/
|       |   |   \-- .gitkeep
|       |   +-- types/
|       |   |   \-- .gitkeep
|       |   \-- index.ts
|       +-- eslint.config.mjs
|       +-- package.json
|       \-- tsconfig.json
+-- .env
+-- .env.example
+-- .gitignore
+-- package.json
+-- pnpm-lock.yaml
+-- pnpm-workspace.yaml
+-- README.md
\-- turbo.json
```
