# Shared package

This package is safe to import from either app. Keep it free of Express, Next.js, React, Drizzle, Node-only APIs, browser-only APIs, and domain persistence details.

- `types` — cross-application TypeScript primitives
- `constants` — stable shared values
- `enums` — closed shared value sets
- `utils` — pure framework-independent helpers
- `schemas` — shared Zod schemas that are not REST-specific
