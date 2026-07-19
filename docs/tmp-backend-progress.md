# Backend implementation tracker (temporary)

Last rebuilt: 2026-07-19

This is a temporary working checklist for backend implementation. The locked product rules remain in `docs/hr-specs.md`; this file tracks implementation progress only.

## Backend boundary

- Backend work only: `apps/api`, backend packages, database migrations, and backend tests.
- Do not modify `apps/web` unless the user explicitly requests it.
- Implement each module with test-driven development.
- Runtime database: `capella_hr` from `.env`.
- Test database: `capella_hr-test` from `.env.test`.

## Completed

### 1. Authentication foundation

- [x] Admin credential singleton stored in MySQL.
- [x] Plaintext admin password read from environment and hashed before database storage.
- [x] Startup credential upsert supports environment password replacement.
- [x] Admin login, session lookup, logout, and admin authorization middleware.
- [x] Hashed opaque session tokens and persistent sessions.
- [x] Authentication-attempt recording and flagging foundation.
- [x] Employee four-digit PIN validation and hashing utilities/foundation.
- [x] Auth contracts, service tests, repository tests, router tests, middleware tests, and MySQL integration tests.
- [x] Drizzle migrations for `admin_credentials`, `auth_sessions`, and `auth_attempts`.

Authentication is complete as a foundation. Employee login/check-in cannot be completed end-to-end until Employees, Devices, Attendance, and Facial Recognition provide their required data and rules.

### 2. Branches

- [x] Branch schema and Drizzle migration.
- [x] Admin-only create, list, get, update, and conditional delete endpoints.
- [x] Name uniqueness with normalized duplicate detection.
- [x] Text location, detected GPS coordinates, GPS accuracy, and admin-controlled attendance radius.
- [x] Search, pagination, and validation contracts.
- [x] Permanent `hasEverBeenReferenced` protection hook.
- [x] Branch contracts, schema, service, router, authorization, and MySQL integration tests.
- [x] Migration applied to `capella_hr` and `capella_hr-test` and live schema verified.

Current branch endpoints:

- `POST /api/v1/branches`
- `GET /api/v1/branches`
- `GET /api/v1/branches/:id`
- `PATCH /api/v1/branches/:id`
- `DELETE /api/v1/branches/:id`

## Current database tables

- `admin_credentials`
- `auth_sessions`
- `auth_attempts`
- `branches`
- `employee_code_sequence`
- `employees`
- `employee_phone_reservations`
- `employee_images`
- `devices`
- `device_pairing_requests`
- `device_authentication_challenges`
- `device_history`
- `attendance_daily_records`
- `employee_salary_periods`
- `payroll_months`
- `bonuses`
- `deductions`
- `advances`
- `advance_installments`
- `financial_audit_events`
- `report_exports`

## 3. Employees — Complete

- [x] Add employee request/response contracts and validation.
- [x] Add employee schema and migration.
- [x] Use an internal database ID plus a unique incremental legacy-compatible employee code.
- [x] Require name, personal phone, WhatsApp phone, four-digit PIN, age, address, branch, shift duration, monthly base salary, personal photo, ID-front photo, and ID-back photo.
- [x] Normalize Egyptian mobile numbers (`010`, `011`, `012`, `015`) and enforce cross-field uniqueness, including permanent reservation after deletion.
- [x] Hash employee PINs; never persist or return plaintext PINs.
- [x] Assign exactly one branch at creation and make that assignment immutable.
- [x] Transactionally mark the assigned branch as permanently referenced when the first employee is assigned.
- [x] Store private uploads under `apps/api/uploads` with the locked 16 MB per-image limit and content-based image validation.
- [x] Add admin-only CRUD, protected image reads, search, branch filters, and pagination.
- [x] Implement irreversible soft deletion, exclude deleted employees from normal reads, and fail closed until Attendance supplies checked-in-state verification.
- [x] Permit edits to editable employee fields while keeping employee code and branch immutable.
- [x] Store the initial shift duration and base salary; attendance timing effects and face enrollment remain deferred to their own modules.
- [x] Add contract, schema, service, router, upload, authorization, replacement-compensation, employee-code concurrency, stale-login rejection, atomic-session-revocation, and real-MySQL integration tests.
- [x] Generate and apply backend migrations through `0007_majestic_thunderbolts.sql` to both databases.
- [x] Run lint, typecheck, tests, and builds for every affected backend package.

## 4. Devices — Complete

- [x] Add schemas for devices, WebAuthn credentials, installation markers, pairing requests, and immutable device history.
- [x] Enforce one active personal phone per employee and one active shared phone per branch.
- [x] Prevent a browser profile from having more than one employee/branch assignment or being transferred.
- [x] Add admin-generated, assignment-scoped, single-use QR/link pairing.
- [x] Keep pairing requests active until used, cancelled, or superseded; allow only one pending request per assignment.
- [x] Complete successful pairing automatically without a second approval after a server-generated WebAuthn registration challenge and cryptographic attestation verification.
- [x] Implement replacement while retaining the old device until the new device pairs successfully.
- [x] Revoke replaced/removed devices permanently and require fresh pairing for reuse.
- [x] Cancel pending pairing and revoke the active personal device during employee soft deletion.
- [ ] Preserve active employee self-service after device revocation until checkout, while blocking new verification/login; Auth/Attendance integration remains pending.
- [x] Verify personal and branch devices with one-time server challenges, origin/RP-ID validation, assertion signatures, user verification, and monotonic signature counters. Static credential IDs and installation markers are explicitly not accepted as authentication proof.
- [x] Wire the cryptographic personal-device verifier into Auth and expose the branch-device verifier for Attendance consumption when that module is implemented.
- [x] Add admin-only device list/detail/status/history endpoints, assignment/browser/platform search, filters, and assignment identity without exposing credentials or secrets.
- [x] Require online API access for pairing; implement no offline queue.
- [x] Add pairing-request concurrency, single-use storage, replacement, revocation, authorization, and MySQL integration tests.
- [x] Add real WebAuthn registration/authentication through `@simplewebauthn/server`, strict RP/origin and user-verification checks, one-time expiring authentication challenges, signature counters, malformed-proof tests, and MySQL replay tests.
- [x] Wire the registered personal-device verifier and authentication-options flow into employee Auth; expose the assignment-scoped verifier for the future Attendance module.

Migrations through `0010_cool_the_watchers.sql` are applied to both `capella_hr` and `capella_hr-test`.

## 5. Shifts — Complete

- [x] Keep one employee-specific required-duration assignment per employee; no reusable shift templates exist.
- [x] Require the initial shift duration during employee creation and retain both Employee and Shifts update entry points with one shared contract rule.
- [x] Store duration in whole minutes with contract and MySQL constraints from 1 minute through 12 hours inclusive.
- [x] Add admin-only list, detail, and single-employee update endpoints with employee search, branch filter, and pagination.
- [x] Exclude bulk update, independent creation, and independent deletion.
- [x] Retain only the current assignment value; no shift-change history is created.
- [x] Expose a transaction-aware, row-locking duration reader for Attendance to capture the required-duration snapshot atomically at check-in. Attendance remains responsible for persisting that immutable session snapshot.
- [x] Cover boundary validation, unknown/deleted employees, authorization, filtering, pagination, persistence, updates, and snapshot reads with contract, service, router, and MySQL integration tests.

No new migration was needed: migrations `0004` and `0005` already created and constrained `employees.shift_duration_minutes`, and migrations through `0010_cool_the_watchers.sql` remain applied to both databases.

## Current-slice hardening audit

- [x] Burn one-time WebAuthn authentication challenges on every attempted proof, including wrong assignment, credential, marker, and revoked-device paths.
- [x] Use a consistent device/challenge lock order and revalidate employee/branch assignments inside pairing transactions.
- [x] Keep branch deletion and employee creation races on stable domain errors instead of foreign-key 500 responses.
- [x] Bound MySQL integer identifiers and pagination before database access.
- [x] Treat search text literally across Branches, Employees, Devices, and Shifts.
- [x] Return structured `413 PAYLOAD_TOO_LARGE` errors for oversized JSON.
- [x] Normalize and validate the web origin, bound the API port, and leave reverse-proxy trust disabled unless an explicit trusted hop count is configured.
- [x] Reject configuration drift from the locked `Africa/Cairo` business timezone and `ar-EG-u-nu-latn` Arabic locale.
- [x] Compile runtime workspace packages for plain Node production while resolving live TypeScript sources during development and tests.

## 6. Weekly Day-Off — Complete

- [x] Add canonical absence/day-off state and stored required-shift snapshots.
- [x] Allow only an existing absence record to become a weekly day off; expose no arbitrary create, update, or delete endpoint.
- [x] Reject current/future Cairo dates and allow eligible historical dates without a time limit.
- [x] Enforce at least seven Cairo calendar days between day-off dates per employee.
- [x] Treat a selected day plus the following six days as the rolling cycle; use no fixed weekday/week.
- [x] Serialize conversions on the employee row and use a locking/current read so concurrent requests cannot bypass spacing.
- [x] Allow day-off-to-absence correction and restore the original absence-duration snapshot exactly.
- [x] Exclude soft-deleted employees and their records from normal reads and transitions.
- [x] Give days off zero effective required minutes while retaining the original absence snapshot internally.
- [x] Provide a transaction-aware payroll financial-lock hook; Payroll will supply the finalized-month check when implemented.
- [x] Add admin-only list, detail, conversion, and reversion endpoints with search, filters, and pagination.
- [x] Add contract, schema, service, router, authorization, transition, spacing-boundary, concurrency, Cairo-date, payroll-lock, and MySQL tests.
- [x] Generate migration `0011_sour_kang.sql` and apply it to `capella_hr` and `capella_hr-test`.

Current weekly day-off endpoints:

- `GET /api/v1/weekly-day-offs`
- `GET /api/v1/weekly-day-offs/:recordId`
- `POST /api/v1/weekly-day-offs/:recordId/convert`
- `POST /api/v1/weekly-day-offs/:recordId/revert`

Attendance remains responsible for generating an absence only after a Cairo day ends, enforcing employee creation/deletion eligibility, proving that no attendance session exists, and atomically replacing an absence with eligible backdated attendance. Payroll remains responsible for supplying the financial-lock check and consuming zero effective required minutes for a weekly day off.

## Deferred slices moved to immediately before final hardening

Facial Recognition and Attendance were explicitly deferred. Their full checklists now appear after Background Worker and Durable Jobs and immediately before Shared Backend Infrastructure and Final Hardening.

## 9. Salaries and Payroll — Backend Complete; Attendance Gateway Deferred

- [x] Require a positive two-decimal EGP base salary during employee creation.
- [x] Add base-salary view/update with no deletion.
- [x] Apply a changed salary to the whole current Cairo month and future months.
- [x] Preserve effective salary periods so later changes do not recalculate ended/finalized months.
- [x] Implement creation/deletion-month eligibility and exact required-workday proration inputs.
- [x] Consume transaction-aware per-date Attendance facts and use exact `BigInt` rational-cent arithmetic.
- [x] Handle zero eligible workdays without division by zero.
- [x] Calculate overtime, shortage/absence, bonuses, deductions, advances, and prior negative carry.
- [x] Round final components to two decimals while retaining exact rational inputs.
- [x] Allow negative net salary and carry it only to the same employee's next finalized sequence.
- [x] Add open monthly previews and immutable finalized snapshots.
- [x] Finalize one employee-month or atomically finalize all remaining employee-months for one branch.
- [x] Allow finalization only after month end and only when the Attendance gateway reports ready.
- [x] Enforce chronological finalization: no newer month while an older month is unfinalized.
- [x] Return employee-scoped branch blockers and commit nobody if any employee is blocked.
- [x] Permanently lock all financial inputs; do not implement reopen/unfinalize.
- [x] Keep actual payment tracking outside scope.
- [x] Add proration, rounding, eligibility, branch atomicity, idempotency, lock, concurrency, HTTP, and MySQL tests.

Production preview/finalization intentionally returns `PAYROLL_ATTENDANCE_UNAVAILABLE` until the deferred Attendance module supplies closed-session, denied-attempt, eligible-workday, required-minute, overtime, and shortage facts inside the payroll transaction. Base salary and all other financial CRUD remain available.

## 10. Bonuses — Complete

- [x] Add positive fixed two-decimal EGP bonuses assigned to one employee and payroll month.
- [x] Allow multiple bonuses per employee-month and no bulk creation or description fields.
- [x] Permit current month or past unfinalized eligible month; reject future/finalized/ineligible months.
- [x] Keep employee immutable; allow amount/month edit and deletion before finalization.
- [x] Make records read-only after employee deletion while preserving them in payroll.
- [x] Keep attendance overtime separate from Bonus records.
- [x] Persist mutation audit events and add eligibility, locking, deletion, payroll-sum, authorization, and MySQL tests.

## 11. Deductions — Complete

- [x] Mirror Bonuses with positive two-decimal EGP values that subtract from payroll.
- [x] Allow multiple manual deductions per employee-month and no bulk creation or description fields.
- [x] Permit current month or past unfinalized eligible month; reject future/finalized/ineligible months.
- [x] Keep employee immutable; allow amount/month edit and deletion before finalization.
- [x] Make records read-only after employee deletion while preserving them in payroll.
- [x] Keep attendance shortage/absence separate from manual Deduction records.
- [x] Persist mutation audit events and add eligibility, locking, deletion, payroll-sum, authorization, and MySQL tests.

## 12. Advances — Complete

- [x] Add positive two-decimal EGP advances assigned to one immutable employee.
- [x] Treat creation as already disbursed; add no payment/status workflow or description fields.
- [x] Support one through four consecutive monthly installments beginning in current, future, or past-unfinalized eligible month.
- [x] Divide exact cents equally and put the complete rounding remainder in the final installment.
- [x] Allow multiple active advances/installments in one employee-month and sum them in payroll.
- [x] Transactionally generate/regenerate the full schedule on create/edit.
- [x] Permit amount/count/start-month edits and deletion only before any installment is finalized.
- [x] Permanently lock the whole advance once any installment is finalized.
- [x] Move the complete remaining balance into the deletion month's unfinalized payroll inside employee deletion.
- [x] Persist mutation/schedule audit events and add rounding, schedule, locking, acceleration, concurrency, authorization, and MySQL tests.

## 13. Reports and PDF Exports — Backend Complete for Available Sources

- [x] Add admin-only read APIs for Branches, Employees, Devices, Shifts, Weekly Day-Off, Bonuses, Deductions, and Advances.
- [ ] Add Attendance/Absence and Payroll report readers after Attendance supplies trustworthy facts; both currently fail closed with `REPORT_SOURCE_UNAVAILABLE`.
- [x] Exclude login/admin-session activity and denied/flagged attendance attempts.
- [x] Provide Arabic detailed rows, fixed safe field sets, and relevant totals/summaries.
- [x] Exclude employee images, PINs and hashes, device credentials, biometrics, and all secrets.
- [x] Include historically relevant soft-deleted employees in employee-related reports.
- [ ] Label open/finalized payroll rows when the deferred Payroll report reader becomes available.
- [x] Add Cairo-correct date ranges, payroll-month ranges, branch/device filters, employee search, and selected/subset/all-filtered selection.
- [x] Match Advances against their actual installment rows, including schedules rewritten by employee-deletion acceleration.
- [x] Support paginated on-screen results and PDF only; exclude CSV/Excel.
- [x] Generate one combined immutable PDF per report tab; never mix tabs.
- [x] Add a durable MySQL export queue with atomic claims, three attempts per cycle, preserved lifetime attempt history, periodic stale-job recovery, and a separate `apps/worker` process.
- [x] Stream bounded MySQL batches through a private disk spool into PDFKit and stream authenticated downloads, avoiding whole-report/PDF buffering under container memory limits.
- [x] Reconcile pending physical deletions, stale spools, and unreferenced PDFs after crashes without diverging file and database state.
- [x] Store PDFs privately under `uploads/reports`, retain them until explicit admin deletion, and preserve export metadata after file deletion.
- [x] Add admin-only export history, status, download, and stored-file deletion endpoints.
- [x] Embed Noto Sans Arabic and visually verify real PDF output for RTL columns, bidirectional dates/numbers, wrapped rows, repeated headers, wide-column bands, and page numbering.
- [x] Add selection, secret-exclusion, lifecycle, concurrency, file-compensation, PDF, authorization, Cairo-boundary, installment-overlap, and real-MySQL tests.

Migrations `0014_lyrical_tusk.sql` and `0015_yummy_puma.sql` are applied to both `capella_hr` and `capella_hr-test`. Both databases report the full 16-entry migration chain.

Current report endpoints:

- `GET /api/v1/reports/:reportType`
- `POST /api/v1/reports/exports`
- `GET /api/v1/reports/exports`
- `GET /api/v1/reports/exports/:exportId`
- `POST /api/v1/reports/exports/:exportId/retry`
- `GET /api/v1/reports/exports/:exportId/download`
- `DELETE /api/v1/reports/exports/:exportId/file`

## 14. Roles and Employee Self-Service

- [ ] Retain exactly two fixed roles: the singleton Admin and Employee.
- [ ] Enforce all authorization in Express, including immutable-state rules that Admin cannot bypass.
- [ ] Protect employee image endpoints for Admin only.
- [ ] Complete self-service login using registered personal phone, employee code, PIN, and an active attendance session.
- [ ] Limit each employee to their own non-secret profile, branch, shift, attendance, days off, payroll, bonuses, deductions, and advances.
- [ ] Keep self-service completely read-only and prohibit Reports/PDF/export access.
- [ ] Revoke employee sessions on PIN reset, checkout, timeout, and deletion; preserve the locked device-revocation exception until checkout.
- [ ] Add horizontal-access, secret/image denial, mutation denial, session-revocation, and MySQL integration tests.

## 15. Audit History

- [ ] Add permanent immutable audit records and admin-only read/search/filter endpoints.
- [ ] Audit every mutation and security-sensitive/system event, but not ordinary page/report views.
- [ ] Store actor, action/module, entity, before/after values, Cairo timestamp, request ID, network/browser context, and related identifiers where available.
- [ ] Redact/exclude passwords, PINs and hashes, session tokens/cookies, credential material, biometric templates, and other secrets.
- [ ] Integrate auditing transactionally across all modules.
- [ ] Add immutability, completeness, redaction, authorization, correlation, and MySQL tests.

## 16. Dashboard Operational Visibility

- [ ] Add admin-only summary endpoints for currently checked-in employees and previous-day open sessions.
- [ ] Add current-day not-checked-in, latest absences/day-off conversions, and denied/flagged attempt summaries.
- [ ] Add automatic-timeout, device pairing/replacement, payroll blocker, and PDF-job summaries.
- [ ] Keep notification center, push, email, SMS, and WhatsApp notifications outside scope.
- [ ] Add authorization, Cairo-boundary, aggregation, and MySQL tests.

## 17. Legacy Seeds

- [ ] Implement developer-run idempotent database seeds with no import UI.
- [ ] Match legacy employees by immutable numeric employee code and never duplicate an existing code.
- [ ] Preserve populated/admin-edited production data and fill only genuinely missing required seed fields.
- [ ] Continue new employee-code allocation after the highest seeded/stored code.
- [ ] Add rerun, preservation, missing-field, allocation, and MySQL tests.

## 18. Background Worker and Durable Jobs

- [x] Add `apps/worker` and the first MySQL-backed durable job flow without Redis.
- [ ] Add the remaining durable handlers/schedules for midnight absences, 16-hour timeouts, biometrics, and reconciliation.
- [x] Store PDF-job state, attempts, failure reason, and lifecycle timestamps.
- [x] Retry PDF generation failures up to three times; dashboard exposure remains pending.
- [x] Permit admin retry for failed PDF jobs without erasing lifetime attempt/failure history.
- [ ] Continue reconciliation retries for attendance/payroll state until success.
- [x] Make PDF generation and file deletion recoverable/idempotent against duplicate jobs and process restarts; other future handlers remain pending.
- [ ] Add scheduling, retry, crash recovery, idempotency, concurrency, and MySQL tests.

## Deferred: Facial Recognition and Settings — Implement Immediately Before Hardening

- [ ] Create `packages/biometrics` and local ONNX inference integration used by the worker.
- [ ] Add supervised face enrollment separate from employee/profile/ID images.
- [ ] Encrypt face templates in MySQL using an environment-only server key.
- [ ] Store model name/version and enforce embedding-model compatibility.
- [ ] Implement replacement enrollment while retaining the old template until success.
- [ ] Permanently delete the encrypted template when an employee is soft-deleted.
- [ ] Add randomized active liveness challenges plus local model evaluation for branch-phone attendance.
- [ ] Discard temporary camera frames immediately and retain only scores, outcomes, thresholds, model version, and operational metadata.
- [ ] Add admin-controlled singleton company-wide face-match and liveness thresholds.
- [ ] Audit threshold changes and snapshot thresholds into every attempt.
- [ ] Add encryption, deletion, re-enrollment, compatibility, threshold, liveness, and raw-frame-disposal tests using synthetic/consented fixtures.

## Deferred: Attendance and Absence — Implement Immediately Before Hardening

- [ ] Add attendance sessions/events, denied attempts, flagged attempts, automatic absences, and immutable snapshots.
- [ ] Use UTC storage and `Africa/Cairo` for all workday decisions.
- [ ] Assign a cross-midnight session entirely to its Cairo check-in date.
- [ ] Atomically enforce one session per employee/check-in date and one open session per employee.
- [ ] Implement personal-phone check-in/out with PIN, GPS, and registered WebAuthn proof.
- [ ] Implement branch-phone check-in/out with employee code, PIN, GPS, liveness, and face match.
- [ ] Validate the employee's assigned branch/device and accept distance exactly on the configured radius.
- [ ] Snapshot source, device, timestamps, GPS, accuracy, calculated distance, branch coordinates/radius, and verification results.
- [ ] Add separate admin manual check-in and check-out operations that bypass employee verification.
- [ ] Permit past/present manual times, reject future times, require checkout after an open check-in, and reject standalone checkout.
- [ ] Replace an automatic absence with backdated attendance while preserving audit history.
- [ ] Reject attendance over a weekly day off until it is converted back to absence.
- [ ] Record every failed attempt as denied and additionally flag security-relevant failures without blocking future attempts.
- [ ] Allow admin approval of a denied attempt at its original timestamp without deleting the attempt.
- [ ] Enforce all normal session/day-off constraints on denied-attempt approval.
- [ ] Automatically checkout open sessions at exactly 16 hours and flag them.
- [ ] Immediately timeout newly created backdated sessions already older than 16 hours.
- [ ] Allow correction only for system-generated automatic checkout; keep all other attendance immutable.
- [ ] Calculate whole completed worked, overtime, and shortage minutes using the check-in shift snapshot.
- [ ] Generate absences only after a Cairo date ends; creation/deletion boundaries and weekly days off must be respected.
- [ ] End employee self-service immediately on any checkout or timeout.
- [ ] Supply the transaction-aware Payroll facts gateway and remove `PAYROLL_ATTENDANCE_UNAVAILABLE` from production previews/finalization.
- [ ] Add GPS-boundary, cross-midnight, concurrency, duplicate submission, timeout, correction, approval, immutability, payroll-gateway, and MySQL tests.

## 19. Shared Backend Infrastructure and Final Hardening

- [ ] Standardize every REST error as stable code, Arabic message, optional field errors, and request ID.
- [ ] Add safe unexpected-error handling with no stack, SQL, path, hash, credential, or biometric leakage.
- [ ] Assign and propagate correlation IDs across API logs, jobs, audits, and error responses.
- [ ] Add shared exact-decimal money and UTC/Cairo date utilities.
- [ ] Add transaction helpers and database constraints for all critical invariants.
- [ ] Add filesystem compensation for employee image creation/replacement and report-file deletion.
- [ ] Verify retry/idempotency behavior for attendance, pairing, jobs, payroll, and employee-code allocation.
- [ ] Remove unused out-of-scope module placeholders: Benefits, Departments, Positions, Recruitment, Onboarding, Performance, Documents, Organization, Notifications, and other excluded scaffolds.
- [ ] Run complete lint, typecheck, builds, unit tests, real-MySQL integration tests, concurrency tests, and critical end-to-end backend workflows.
- [ ] Apply the final migration chain cleanly to empty `capella_hr` and `capella_hr-test` databases.
- [ ] Verify no backend implementation changed `apps/web`.
- [ ] Update this tracker, `docs/architecture.md`, and the target tree after backend completion.

## Deferred integration hooks

- Employee creation must call the Branches reference-lock operation in the same transaction boundary.
- Attendance must call the Shifts transaction-aware duration reader inside its check-in transaction and persist the returned immutable snapshot on the attendance session.
- Device registration and pairing complete the registered-phone requirement.
- Facial Recognition supplies face enrollment, liveness, templates, and thresholds.
- Attendance supplies checked-in state, GPS enforcement, and employee self-service access eligibility.
- Payroll consumes attendance duration, shifts, weekly days off, bonuses, deductions, and advances.
- Reports consume finalized read models from every completed module.

## Immediate action

Proceed to Roles and Employee Self-Service without touching `apps/web`, while keeping attendance-dependent login/session rules deferred with Attendance. The Attendance/Absence and Payroll report adapters remain deferred until Attendance is trustworthy. Facial Recognition and Attendance remain intentionally deferred until immediately before final hardening.
