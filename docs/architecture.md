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
