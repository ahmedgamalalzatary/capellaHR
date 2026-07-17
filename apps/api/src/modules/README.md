# API module convention

Each domain module owns these boundaries:

- `routes` — Express route registration
- `controllers` — HTTP request/response translation
- `services` — use cases and domain orchestration
- `repositories` — persistence interfaces and Drizzle implementations
- `schemas` — module validation and domain schemas
- `dto` — internal application data-transfer types
- `tests` — module-focused unit and integration tests

Only a module's root `index.ts` is public. Do not import internal layers from another module.
