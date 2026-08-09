# Capella HR implementation tracker (temporary)

Last verified: 2026-08-09

This is the temporary working checklist for completing the full functional product. The locked product rules remain in `docs/hr-specs.md`; this file tracks implementation progress and dependency order only.

## User-confirmed scope decision

- **SKIP — USER CONFIRMED (2026-07-20):** Do not implement Capella-managed facial recognition, face enrollment/templates, liveness challenges, ONNX processing, biometric thresholds, or biometric Settings.
- **ACTIVE REPLACEMENT — USER CONFIRMED (2026-07-22):** Employee-originated check-in and check-out use employee code plus the four-digit PIN while retaining the exact registered browser marker and assigned-branch GPS checks.
- Device verification is silent and does not invoke a pattern, security key, biometric, or device-passcode prompt.

## Tracker boundary

- Track `apps/api`, `apps/worker`, `apps/web`, shared packages, database migrations, and all required tests.
- Implement backend modules and bug fixes with test-driven development; add component and end-to-end coverage for the corresponding web workflows.
- Complete the functional Arabic/RTL web behavior required by `docs/hr-specs.md`; final aesthetic and interaction-system design remains explicitly deferred.
- Preserve the locked scope boundaries. Do not add excluded modules or features merely because placeholders exist.
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

Authentication is complete as a foundation. Employee login/check-in cannot be completed end-to-end until Employees, Devices, and Attendance provide their required data and rules. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition is no longer a dependency.

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

- `accounts`
- `auth_sessions`
- `auth_attempts`
- `auth_login_limits`
- `branches`
- `employee_code_sequence`
- `employees`
- `employee_phone_reservations`
- `employee_images`
- `devices`
- `device_pairing_requests`
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
- [x] Store the initial shift duration and base salary; attendance timing effects remain deferred to Attendance. **SKIP — USER CONFIRMED (2026-07-20):** Face enrollment will not be implemented.
- [x] Add contract, schema, service, router, upload, authorization, replacement-compensation, employee-code concurrency, stale-login rejection, atomic-session-revocation, and real-MySQL integration tests.
- [x] Generate and apply backend migrations through `0007_majestic_thunderbolts.sql` to both databases.
- [x] Run lint, typecheck, tests, and builds for every affected backend package.

## 4. Devices — Complete

- [x] Add schemas for browser-marker devices, one-time pairing requests, and immutable device history.
- [x] Enforce one active personal phone per employee and one active shared phone per branch.
- [x] Prevent a browser profile from having more than one employee/branch assignment or being transferred.
- [x] Add admin-generated, assignment-scoped, single-use QR/link pairing.
- [x] Keep pairing requests active until used, cancelled, or superseded; allow only one pending request per assignment.
- [x] Complete pairing automatically when the target browser opens a valid one-time link and submits its local installation marker.
- [x] Implement replacement while retaining the old device until the new device pairs successfully.
- [x] Revoke replaced/removed devices permanently and require fresh pairing for reuse.
- [x] Cancel pending pairing and revoke the active personal device during employee soft deletion.
- [x] Preserve active employee self-service after device revocation until checkout, while blocking new verification/login; checkout and timeout now end the exception through the Attendance integration.
- [x] Verify personal and branch devices silently by hashing the browser's installation marker and matching it to the assigned active device.
- [x] Wire marker-only personal-device verification into Auth and marker-only branch-device verification into Attendance.
- [x] Add admin-only device list/detail/status/history endpoints, assignment/browser/platform search, filters, and assignment identity without exposing installation-marker data or other secrets.
- [x] Require online API access for pairing; implement no offline queue.
- [x] Add pairing-request concurrency, single-use storage, replacement, revocation, authorization, and MySQL integration tests.
- [x] Keep one-time pairing links valid until used, cancelled, or superseded; pairing requires only the browser's local installation marker.
- [x] Wire silent registered-browser marker verification into employee Auth and both personal-phone and branch-phone Attendance flows.

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

- [x] Reject wrong-assignment, wrong-marker, and revoked-device verification attempts without disabling the valid registered marker.
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

## Completed dependency slices

Attendance, its Payroll/Reports integrations, employee self-service Attendance history, Dashboard operational visibility, all Attendance web workflows, the non-Attendance Roles foundation, and the general Audit/correlation slice are complete. Final infrastructure, security, accessibility, E2E, placeholder, migration, and documentation hardening is the remaining active completion path. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition is removed from the completion path and from downstream dependencies.

## 8. Salaries and Payroll — Backend Complete

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

Production preview/finalization now receives open/closed-session, denied-attempt, eligible-workday, required-minute, overtime, shortage, and missing-reconciliation facts from Attendance inside the payroll transaction. Open previews remain provisional while finalization enforces unresolved actionable denied attempts, open sessions, and completed reconciliation. Finalized snapshots remain readable independently of live Attendance state.

## 9. Bonuses — Complete

- [x] Add positive fixed two-decimal EGP bonuses assigned to one employee and payroll month.
- [x] Allow multiple bonuses per employee-month and no bulk creation or description fields.
- [x] Permit current month or past unfinalized eligible month; reject future/finalized/ineligible months.
- [x] Keep employee immutable; allow amount/month edit and deletion before finalization.
- [x] Make records read-only after employee deletion while preserving them in payroll.
- [x] Keep attendance overtime separate from Bonus records.
- [x] Persist mutation audit events and add eligibility, locking, deletion, payroll-sum, authorization, and MySQL tests.

## 10. Deductions — Complete

- [x] Mirror Bonuses with positive two-decimal EGP values that subtract from payroll.
- [x] Allow multiple manual deductions per employee-month and no bulk creation or description fields.
- [x] Permit current month or past unfinalized eligible month; reject future/finalized/ineligible months.
- [x] Keep employee immutable; allow amount/month edit and deletion before finalization.
- [x] Make records read-only after employee deletion while preserving them in payroll.
- [x] Keep attendance shortage/absence separate from manual Deduction records.
- [x] Persist mutation audit events and add eligibility, locking, deletion, payroll-sum, authorization, and MySQL tests.

## 11. Advances — Complete

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

## 12. Reports and PDF Exports — Backend Complete

- [x] Add admin-only read APIs for Branches, Employees, Devices, Shifts, Weekly Day-Off, Attendance/Absence, Payroll, Bonuses, Deductions, and Advances.
- [x] Add Attendance/Absence and Payroll report readers backed by transaction-aware Attendance facts; production view and PDF paths no longer use their fail-closed placeholders.
- [x] Exclude login/admin-session activity and denied/flagged attendance attempts.
- [x] Provide Arabic detailed rows, fixed safe field sets, and relevant totals/summaries.
- [x] Exclude employee images, PINs and hashes, installation-marker data, and all secrets. **SKIP — USER CONFIRMED (2026-07-20):** No biometric fields or artifacts will exist to report.
- [x] Include historically relevant soft-deleted employees in employee-related reports.
- [x] Label open/finalized payroll rows and relevant soft-deleted employees.
- [x] Add Cairo-correct date ranges, payroll-month ranges, branch/device filters, employee search, and selected/subset/all-filtered selection.
- [x] Match Advances against their actual installment rows, including schedules rewritten by employee-deletion acceleration.
- [x] Support paginated on-screen results and PDF only; exclude CSV/Excel.
- [x] Bound interactive Payroll report work to 5,000 employee-month candidates while keeping durable PDF export batching unrestricted.
- [x] Generate one combined immutable PDF per report tab; never mix tabs.
- [x] Add a durable MySQL export queue with atomic claims, three attempts per cycle, preserved lifetime attempt history, periodic stale-job recovery, and a separate `apps/worker` process.
- [x] Stream bounded MySQL batches through a private disk spool into PDFKit and stream authenticated downloads, avoiding whole-report/PDF buffering under container memory limits.
- [x] Reconcile pending physical deletions, stale spools, and unreferenced PDFs after crashes without diverging file and database state.
- [x] Store PDFs privately under `uploads/reports`, retain them until explicit admin deletion, and preserve export metadata after file deletion.
- [x] Add admin-only export history, status, download, and stored-file deletion endpoints.
- [x] Embed Noto Sans Arabic and visually verify real PDF output for RTL columns, bidirectional dates/numbers, wrapped rows, repeated headers, wide-column bands, and page numbering.
- [x] Add selection, secret-exclusion, lifecycle, concurrency, file-compensation, PDF, authorization, Cairo-boundary, installment-overlap, and real-MySQL tests.

Reports migrations `0014_lyrical_tusk.sql` through `0015_yummy_puma.sql` add the durable export queue and its bounded-cycle/lifetime retry accounting. Audit migrations `0016_clammy_wilson_fisk.sql` and `0017_swift_mac_gargan.sql` add the immutable audit stream and report-export request correlation. Attendance migration `0018_fearless_sunfire.sql` adds sessions, events, denied attempts, snapshots, and database-enforced ownership/open-session invariants; `0019_living_ultron.sql` adds durable absence/timeout jobs, claims, retries, failure visibility, and lifecycle constraints; `0020_many_peter_quill.sql` adds the mutually exclusive audited dismissal state for reviewed-invalid denied attempts. The full 21-entry migration chain through `0020` is applied cleanly to `capella_hr-test`.

Current report endpoints:

- `GET /api/v1/reports/:reportType`
- `POST /api/v1/reports/exports`
- `GET /api/v1/reports/exports`
- `GET /api/v1/reports/exports/:exportId`
- `POST /api/v1/reports/exports/:exportId/retry`
- `GET /api/v1/reports/exports/:exportId/download`
- `DELETE /api/v1/reports/exports/:exportId/file`

## Current frontend implementation

### Complete for currently available backend sources

- [x] Add the Arabic/RTL application shell, responsive admin navigation, Cairo clock, session loading, and admin route protection.
- [x] Add the shared API client, stable error-envelope handling, runtime Cairo/locale formatting, query state, loading, retry, and empty-state foundations.
- [x] Add functional admin views for Branches, Employees, Devices and pairing, Shifts, Weekly Day-Off, Payroll/base salary, Bonuses, Deductions, Advances, and the currently available Reports/PDF workflows.
- [x] Add admin and employee login forms with silent registered-browser marker verification for employees.
- [x] Add the Arabic/RTL employee self-service view for own non-secret profile, branch, shift, current/historical Attendance, open/finalized payroll, weekly-day/absence records, bonuses, deductions, advances/installments, pagination, and logout.
- [x] Add the admin-only immutable Audit History view with search, actor/module/date filters, pagination, retry/empty states, and expandable redacted details.

### Still required

- [x] Replace the placeholder admin Attendance page with attendance/absence, denied/flagged-attempt, approval, manual-event, timeout, and correction workflows.
- [x] Replace the placeholder Dashboard page with all locked operational summaries, bounded live lists, complete totals/status counts, retry/refresh states, and direct links to the owning modules.
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Replace the placeholder Settings page with company-wide face-match and liveness threshold management plus supervised enrollment entry points where relevant.~~
- [x] Implement the personal-device attendance interface with employee code, PIN, GPS, registered-browser marker, check-in, and check-out flows.
- [x] Implement the shared branch-kiosk interface with employee code, PIN, registered branch-device validation, GPS, check-in, and check-out flows. **SKIP — USER CONFIRMED (2026-07-20):** No camera, randomized liveness, or face match.
- [x] Extend employee self-service with its own Attendance history and trustworthy open payroll previews through the completed Attendance gateway.
- [x] Expose the existing Attendance/Absence and Payroll report tabs through their now-trustworthy backend readers.
- [x] Run a final functional web audit for Arabic/RTL rendering, Cairo dates, numeric and monetary presentation, search/filter/reset behavior, empty/error/loading states, authorization, accessibility, and responsive operation.

## Dependency-ordered completion roadmap

The detailed module checklists below remain the acceptance criteria. Completed and skipped steps are marked explicitly; implement the remaining work in this order:

1. **Completed:** Non-Attendance Roles and Employee Self-Service authorization foundation.
2. **Completed:** Shared request correlation and the general immutable Audit system.
3. **SKIP — USER CONFIRMED (2026-07-20):** ~~Implement Facial Recognition, encrypted templates, enrollment, liveness, and recognition Settings.~~
4. **Completed:** Attendance/Absence data model and employee-code/PIN verification flows, employee/admin workflows, denied and flagged attempts, calculations, and corrections.
5. **Completed:** midnight absences, exact 16-hour timeouts, durable retries/reconciliation, and Attendance cross-module hooks. **SKIP — USER CONFIRMED (2026-07-20):** No biometric-processing worker job.
6. **Completed:** trustworthy transaction-aware Attendance facts now feed Payroll previews/finalization and Attendance/Payroll reports in both API and worker runtimes.
7. **Completed:** Employee Attendance history, open Payroll previews, and session/device revocation integration.
8. **Completed:** Dashboard operational visibility through one coherent admin-only snapshot and the Arabic/RTL operations ledger.
9. **SKIP — USER CONFIRMED (2026-07-20):** ~~Implement idempotent legacy seeds.~~
10. **Completed:** Corresponding admin Attendance, personal-device, and shared branch-kiosk web workflows.
11. Perform shared infrastructure and final hardening.

## 13. Roles and Employee Self-Service

Current boundary: employee login requires an open Attendance session, checkout/timeout revokes employee sessions, open payroll previews use trustworthy Attendance facts, and employees can read their own current/historical Attendance. This dependent slice is complete. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition and biometric Settings are removed.

- [x] Retain exactly two fixed actor types in the authentication/session foundation: the singleton Admin and Employee.
- [x] Protect employee image endpoints for Admin only.
- [x] Add the employee-login contracts, service/router flow, PIN/phone/device verification, session support, and Attendance eligibility gateway.
- [x] Enforce Admin/Employee authorization consistently across every currently implemented Express endpoint and keep the employee API structurally GET-only.
- [x] Preserve that authorization coverage across future endpoints, including immutable-state rules that Admin cannot bypass.
- [x] Wire the existing employee-login foundation to the real Attendance gateway in production so an open attendance session is required.
- [x] Limit each employee to their own non-secret profile, branch, shift, Attendance history, days off, open/finalized payroll, bonuses, deductions, and advances/installments.
- [x] Add the employee's own paginated Attendance history without employee/branch identifiers, flags, devices, or admin-only fields.
- [x] Add trustworthy open payroll previews backed by Attendance facts.
- [x] Keep self-service completely read-only and prohibit employee access to images, secrets, Reports, PDFs, and exports.
- [x] Revoke employee sessions on PIN reset and employee deletion.
- [x] Preserve the locked exception in which personal-device revocation does not revoke an already-active self-service session.
- [x] Revoke employee sessions on checkout and automatic timeout, including ending a device-revocation exception at checkout.
- [x] Add horizontal-access, secret/image denial, mutation denial, current session-revocation, and MySQL integration tests.
- [x] Add Attendance-dependent checkout, timeout, and open-session integration tests with the Attendance slice.

## 14. Audit History

Audit migration `0016_clammy_wilson_fisk.sql` creates the immutable audit stream, and `0017_swift_mac_gargan.sql` adds the originating request ID to report exports so background audit events retain correlation.

- [x] Add permanent immutable audit records and admin-only read/search/filter endpoints.
- [x] Audit every mutation and security-sensitive/system event in the currently implemented modules, but not ordinary page/report views.
- [x] Store actor, action/module, entity, before/after values, Cairo timestamp, request ID, network/browser context, and related identifiers where available.
- [x] Redact/exclude passwords, PINs and hashes, session tokens/cookies, raw installation markers and marker hashes, and other secrets. **SKIP — USER CONFIRMED (2026-07-20):** Biometric templates will not exist.
- [x] Integrate auditing transactionally across all currently implemented modules and preserve originating correlation IDs across background report transitions.
- [x] Add immutability, completeness, redaction, authorization, correlation, rollback, background-transition, and MySQL tests.

## 15. Dashboard Operational Visibility — Complete

- [x] Add an admin-only snapshot endpoint for currently checked-in employees and previous-day open sessions.
- [x] Add current-day not-checked-in, latest absences/day-off conversions, and unresolved denied/flagged attempt summaries.
- [x] Add automatic-timeout, pending device pairing/replacement, latest-ended-month payroll blocker, and PDF-job summaries.
- [x] Keep notification center, push, email, SMS, and WhatsApp notifications outside scope.
- [x] Add authorization, unexpected-error forwarding, exact Cairo-midnight boundary, aggregation, safe-field, and MySQL tests.

## 16. Legacy Seeds — SKIP — USER CONFIRMED (2026-07-20)

- [x] **SKIP — USER CONFIRMED (2026-07-20):** ~~Implement developer-run idempotent database seeds with no import UI.~~
- [x] **SKIP — USER CONFIRMED (2026-07-20):** ~~Match legacy employees by immutable numeric employee code and never duplicate an existing code.~~
- [x] **SKIP — USER CONFIRMED (2026-07-20):** ~~Preserve populated/admin-edited production data and fill only genuinely missing required seed fields.~~
- [x] **SKIP — USER CONFIRMED (2026-07-20):** ~~Continue seed-specific employee-code allocation after the highest seeded code.~~ Normal employee creation still allocates after the highest stored code.
- [x] **SKIP — USER CONFIRMED (2026-07-20):** ~~Add seed rerun, preservation, missing-field, allocation, and MySQL tests.~~

## 17. Background Worker and Durable Jobs

- [x] Add `apps/worker` and the first MySQL-backed durable job flow without Redis.
- [x] Add durable handlers/schedules for midnight absences, exact 16-hour timeouts, and Attendance reconciliation. **SKIP — USER CONFIRMED (2026-07-20):** Do not add biometric processing.
- [x] Store PDF-job state, attempts, failure reason, and lifecycle timestamps.
- [x] Retry PDF generation failures up to three times and expose queued, processing, completed, and visibly failed status on the Dashboard.
- [x] Permit admin retry for failed PDF jobs without erasing lifetime attempt/failure history.
- [x] Continue reconciliation retries for Attendance state until success.
- [x] Backfill missed absence schedule dates after worker downtime before scheduling the next Cairo midnight.
- [x] Reconcile Payroll against completed Attendance snapshots, open sessions, denied attempts, and missing ended-day Attendance state through the transaction-aware gateway.
- [x] Make PDF generation, file deletion, automatic absence, and automatic timeout recoverable/idempotent against duplicate jobs and process restarts.
- [x] Add scheduling, retry, crash recovery, idempotency, concurrency, and MySQL tests for the implemented durable handlers.

## 18. Facial Recognition and Settings — SKIPPED; USER CONFIRMED (2026-07-20)

- **SKIP — USER CONFIRMED (2026-07-20):** ~~Create `packages/biometrics` and local ONNX inference integration used by the worker.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Add supervised face enrollment separate from employee/profile/ID images.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Encrypt face templates in MySQL using an environment-only server key.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Store model name/version and enforce embedding-model compatibility.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Implement replacement enrollment while retaining the old template until success.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Permanently delete the encrypted template when an employee is soft-deleted.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Add randomized active liveness challenges plus local model evaluation for branch-phone attendance.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Discard temporary camera frames immediately and retain only scores, outcomes, thresholds, model version, and operational metadata.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Add admin-controlled singleton company-wide face-match and liveness thresholds.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Audit threshold changes and snapshot thresholds into every attempt.~~
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Add encryption, deletion, re-enrollment, compatibility, threshold, liveness, and raw-frame-disposal tests using synthetic/consented fixtures.~~

## 7. Attendance and Absence

- [x] Add attendance sessions/events, denied attempts, flagged attempts, and immutable snapshots.
- [x] Generate automatic absences through the durable worker.
- [x] Use UTC storage and `Africa/Cairo` for all workday decisions.
- [x] Assign a cross-midnight session entirely to its Cairo check-in date.
- [x] Atomically enforce one session per employee/check-in date and one open session per employee.
- [x] Implement personal-phone check-in/out with employee code, PIN, GPS, and the registered browser marker.
- [x] Implement branch-phone check-in/out with employee code, PIN, registered branch-device validation, and GPS. **SKIP — USER CONFIRMED (2026-07-20):** No liveness or face match.
- [x] Validate the employee's assigned branch/device and accept distance exactly on the configured radius.
- [x] Snapshot source, device, timestamps, GPS, accuracy, calculated distance, branch coordinates/radius, and verification results.
- [x] Add separate admin manual check-in and check-out operations that bypass employee verification.
- [x] Permit past/present manual times, reject future times, require checkout after an open check-in, and reject standalone checkout.
- [x] Replace an automatic absence with backdated attendance while preserving audit history.
- [x] Reject attendance over a weekly day off until it is converted back to absence.
- [x] Record every failed attempt as denied and additionally flag security-relevant failures without blocking future attempts.
- [x] Allow admin approval of a denied attempt at its original timestamp without deleting the attempt.
- [x] Allow admin dismissal of a reviewed-invalid denied attempt while preserving and auditing it, and block finalization only on unresolved actionable attempts.
- [x] Enforce all normal session/day-off constraints on denied-attempt approval.
- [x] Automatically checkout open sessions at exactly 16 hours and flag them.
- [x] Immediately timeout newly created backdated sessions already older than 16 hours.
- [x] Allow correction only for system-generated automatic checkout; keep all other attendance immutable.
- [x] Calculate whole completed worked, overtime, and shortage minutes using the check-in shift snapshot.
- [x] Generate absences only after a Cairo date ends; creation/deletion boundaries, shift-change races, existing attendance, and weekly days off are respected.
- [x] End employee self-service immediately on any checkout or timeout.
- [x] Supply the transaction-aware Payroll facts gateway and remove `PAYROLL_ATTENDANCE_UNAVAILABLE` from production previews/finalization.
- [x] Add GPS-boundary, cross-midnight, concurrency, duplicate submission, timeout, correction, approval, immutability, durable-job, and MySQL tests.
- [x] Add Payroll-gateway, payroll-reconciliation, Attendance/Payroll report, PDF-batch, and real-MySQL tests with the dependent Payroll/Reports slice.

## 19. Session Persistence — Foundation and Attendance Integration Complete; Coverage Pending

- [x] Store secure opaque admin and employee session records in MySQL so API restarts do not lose session state.
- [x] Support explicit logout and direct employee-session revocation in the authentication foundation.
- [x] Wire immediate employee-session revocation to PIN reset and employee deletion.
- [x] Wire immediate employee-session revocation to attendance checkout and automatic timeout.
- [x] Preserve the locked exception in which an already-active employee session survives personal-device revocation before attendance checkout.
- [x] End that device-revocation exception at attendance checkout.
- [x] Add production integration coverage for restart persistence and every locked revocation path.

## 20–23. Functional Scope, Verification, Data Integrity, and Final Hardening

- [ ] Standardize every REST error as stable code, Arabic message, optional field errors, and request ID.
- [ ] Add safe unexpected-error handling with no stack, SQL, path, hash, credential, or secret leakage. **SKIP — USER CONFIRMED (2026-07-20):** No biometric data will be processed.
- [ ] Assign and propagate correlation IDs across API logs, jobs, audits, and error responses.
- [ ] Add shared exact-decimal money and UTC/Cairo date utilities.
- [ ] Add transaction helpers and database constraints for all critical invariants.
- [ ] Add filesystem compensation for employee image creation/replacement and report-file deletion.
- [ ] Verify retry/idempotency behavior for attendance, pairing, jobs, payroll, and employee-code allocation.
- [ ] Remove unused out-of-scope module placeholders: Benefits, Departments, Positions, Recruitment, Onboarding, Performance, Documents, Organization, Notifications, and other excluded scaffolds.
- [ ] Remove the placeholder biometric Settings page/module. **SKIP — USER CONFIRMED (2026-07-20):** It must not be implemented as a recognition-threshold or enrollment interface.
- [x] Verify the completed `apps/web` functionality matches the locked Arabic/RTL, authorization, validation, filtering, empty-state, attendance, self-service, reporting, and operational requirements without expanding into deferred aesthetic design.

## Cross-module integration gates

- Employee creation must call the Branches reference-lock operation in the same transaction boundary.
- Attendance must call the Shifts transaction-aware duration reader inside its check-in transaction and persist the returned immutable snapshot on the attendance session.
- Device registration and pairing complete the registered-phone requirement.
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Facial Recognition supplies face enrollment, liveness, templates, and thresholds.~~ Attendance instead verifies employee code and PIN plus the applicable device and GPS requirements.
- Attendance supplies checked-in state, GPS enforcement, and employee self-service access eligibility.
- Payroll consumes attendance duration, shifts, weekly days off, bonuses, deductions, and advances.
- Reports consume finalized read models from every completed module.
- Audit receives transaction-aware mutation/security events from every module and shares request IDs with API errors and background jobs.
- The worker performs midnight absence generation, exact 16-hour timeout, PDF generation, and durable reconciliation without duplicating business effects. **SKIP — USER CONFIRMED (2026-07-20):** No biometric inference.

---

# ERP implementation tracker

Added 2026-07-29 from `docs/erp-plan.md`. The ERP plan remains the source of truth for product decisions and reasoning; this section tracks implementation progress and dependency order.

## ERP completion definition

- [ ] Deliver a production-ready Arabic/RTL POS application backed by the existing API and MySQL database.
- [ ] Preserve HR behavior while sharing accounts, employees, branches, attendance, audit, payroll capabilities, and reporting infrastructure through public module boundaries.
- [ ] Support the named `hr`, `erp`, and `full` editions from one migration history and codebase.
- [ ] Deploy Capella using `EDITION=full`, then validate the sellable `hr` and `erp` editions.

Every functional ERP slice is delivered end to end: database and migration work, contracts, API/domain behavior, authorization and audit, the owning Arabic/RTL Admin or Cashier workflow, and proportional unit, component, integration, MySQL, and end-to-end coverage. A slice is not complete while its required UI is deferred to a later catch-all phase. ERP administration belongs in `apps/pos` so an `erp` installation remains independently operable; only HR-specific additions such as employee self-service belong in `apps/web`. Explicit foundation, architecture, hardening, security, and rollout slices do not require a standalone screen, but must cover both backend and frontend integration surfaces needed by the user-facing slices.

## ERP 1. Account foundation

- [x] Add the general `accounts` schema with Admin and Cashier roles, active state, optional employee link, and timestamps.
- [x] Require Cashier accounts to be linked to an employee while allowing the seeded Admin account to remain independent.
- [x] Keep branch ownership derived from the linked employee rather than duplicating branch scope on the account.
- [x] Generate the initial accounts migration.
- [x] Add normalized Cashier username, login, and employee-promotion contracts.
- [x] Enforce non-empty passwords with the shared 1024-character maximum.
- [x] Add the Cashier account promotion domain service with stable errors and password-hash-safe responses.
- [x] Add focused account schema, contract, service, and migration tests.
- [x] Implement the production Drizzle account repository.
- [x] Wire employee-to-Cashier promotion atomically to MySQL.
- [x] Add an Admin-only Cashier promotion endpoint.
- [x] Add Admin account-management endpoints for listing, enabling, disabling, and resetting Cashier credentials.
- [x] Define and enforce username uniqueness and concurrent-promotion behavior at database and service levels.
- [x] Revoke active account sessions when an account is disabled or its credentials change.
- [x] Add Arabic/RTL POS Admin UI to promote an employee to Cashier, list Cashier accounts, enable or disable them, and reset credentials.
- [x] Add safe confirmation, validation, empty, loading, success, conflict, and error states without exposing password hashes.
- [x] Add component coverage for Cashier promotion and account lifecycle workflows (form-schema and view tests; no dedicated e2e framework exists in this repo, matching `apps/web`'s testing approach).

## ERP 2. Account authentication and authorization

- [x] Migrate the `.env` Admin seed from `admin_credentials` into the Admin account model without breaking existing installations.
- [x] Retire the `admin_credentials` singleton after migrating its credential and active sessions.
- [x] Extend persistent sessions to support acting accounts without turning Cashier into an employee `actor_type`.
- [x] Implement database-backed Admin and Cashier username/password login.
- [x] Keep employee code/PIN login exclusively for HR attendance and read-only self-service.
- [x] Allow Admin accounts through both HR/Admin and ERP account authorization boundaries.
- [x] Allow Cashier accounts through the ERP account boundary only and reject them from Admin/HR boundaries.
- [x] Reject employee self-service credentials from the ERP account boundary.
- [x] Add current-account lookup, logout, invalid-account revocation, and restart-persistence behavior.
- [x] Define and enforce 24-hour account-session and cookie expiry.
- [x] Expose the acting account identity to audit and future ERP operation handlers.
- [ ] Record the acting account on every sensitive ERP operation as each operation is implemented.
- [x] Add login throttling and stable authentication errors to the account login flow.
- [x] Test invalid credentials, role separation, invalid-account revocation, restart persistence, and secret non-disclosure for the delivered account flow.
- [x] Add disabled-account lifecycle, credential-reset revocation, and session-expiry coverage.
- [x] Create the independent `apps/pos` Next.js application using `packages/ui`, `packages/contracts`, IBM Plex Sans Arabic, `ar-EG`, `Africa/Cairo`, and RTL conventions. Infra scaffold only (RTL shell, providers, REST client, Docker); login/routing/session UI is the next phase.
- [x] Add Cashier/Admin account login, logout, session restoration, and ERP-protected routing to the POS application. Route protection also enforces admin-only access to admin-only pages (e.g. `/cashier-accounts`), not just ERP-account membership.
- [x] Provide accessible Arabic loading, invalid-credential, throttled, disabled-account, and retry states (all share the backend's existing Arabic error messages/anti-enumeration design); expired-session resolves via a silent redirect to `/login`, matching `apps/web`'s `RequireAdmin` convention; unauthorized-role (an HR employee session visiting POS, or a cashier on an admin-only page) shows an explicit Arabic message instead of a redirect.
- [x] Add component coverage for account login, role separation (admin/cashier/employee/admin-only-page), session restoration, logout, and retry in the POS application (no dedicated e2e framework exists in this repo, matching `apps/web`'s testing approach).

## ERP 3. Module boundaries and shared capabilities

- [x] Create `apps/api/src/modules/erp/` with public module surfaces for catalog, suppliers, stock, sales, expenses, clients, and ERP reports.
- [x] Add matching ERP namespace surfaces to `packages/database` and `packages/contracts`.
- [x] Expose public HR-core capabilities for account/session verification, employee lookup, branch lookup, present-employee lookup, payroll input, and post-payroll deductions.
- [x] Require ERP modules to consume HR only through those public capabilities.
- [x] Prevent HR core from importing ERP modules.
- [x] Enforce HR/ERP direction and public-surface rules through ESLint import boundaries.
- [x] Preserve public boundaries between ERP modules.
- [x] Scope every ERP business record and operation to a branch.
- [x] Derive the acting Cashier's branch from the linked employee and never trust client-supplied branch identity.
- [x] Define matching public-feature boundaries for `apps/pos` so one POS feature cannot import another feature's internals (enforced via ESLint `no-restricted-imports` banning deep imports into `@/features/<name>/*`; each feature is consumed only through its public `index.ts` barrel).
- [x] Add frontend architecture tests for POS public surfaces and forbidden HR-frontend coupling (`apps/pos/tests/pos-architecture-boundaries.test.ts`, mirroring `apps/api`'s `ESLint.lintText()`-based architecture test; also bans `apps/pos` ↔ `apps/web` cross-app imports in both directions, since the two are independently deployed frontends sharing only the backend API).

This is an architecture slice: no standalone user screen is required. Complete: both API/package boundaries and the POS frontend boundaries are enforced.

## ERP dependency graph and controlled parallel delivery

The docs describe a mostly sequential order, but the real dependency graph allows controlled parallel work.

```text
DONE: ERP 1–19, subject to the explicitly deferred ERP 9 and ERP 18 end-to-end integration harnesses below
        └──> ERP 20 Admin UX ──────────────────────────────┐
                                                          │
                                                     ERP 21 Editions
                                                          │
                                                     ERP 22 Security
```

Safe parallel waves:

1. **Complete:** ERP 1–16 and the ERP 18 software slice, with ERP 9's browser-to-authenticated-HTTP-to-MySQL validation, ERP 11 physical-printer validation, and ERP 18's browser-to-authenticated-HTTP-to-MySQL replay harness deferred until those production/integration environments are available.
2. **Complete:** ERP 17 commission/payroll integration.
3. **Complete:** ERP 19 reports and PDF exports.
4. ERP 18's offline queue, replay, and conflict-resolution workflow is delivered.
5. **Next eligible:** ERP 20.
6. ERP 20 → ERP 21 → ERP 22 should remain sequential.

## ERP 4. Cashier sessions

- [x] Add POS Cashier-session schema and migration.
- [x] Record the branch, acting account, opening time, closing time, and closing account.
- [x] Enforce exactly one open Cashier session per branch with a database invariant.
- [x] Implement open, current, and close Cashier-session operations.
- [x] Require an open Cashier session for counter sales and related mutations.
- [x] Reject concurrent attempts to open a second branch session with a stable conflict.
- [x] Define safe recovery for an abandoned open Cashier session.
- [x] Add authorization, branch-isolation, concurrency, and MySQL integration tests.
- [x] Add POS open/current/close Cashier-session UI with clear active-session ownership and Cairo timestamps.
- [x] Add POS Admin recovery-close UI for an abandoned session with confirmation and audit-visible acting-account context.
- [x] Add integration and component coverage for normal open/close, second-session conflict, authorization, session restoration, and abandoned-session recovery.

No drawer counting, opening balance, closing balance, or reconciliation is included.

## ERP 5. Clients — Complete

- [x] Add branch-scoped client schema and migration.
- [x] Require client name and phone; completed invoices may never be anonymous.
- [x] Normalize, validate, search, and index client phone values. Phone reuses the locked `normalizeEgyptianMobile` form, is unique per branch, and is column-checked with the same `^01[0125][0-9]{8}$` regexp Employees uses.
- [x] Define safe duplicate-client behavior. A duplicate phone within a branch is a stable `CLIENT_PHONE_EXISTS` conflict carrying `existingClientId`, so the counter can continue with the client that already holds the number; the unique index is the real guard and a lost race is translated into the same conflict. The same number in a different branch is a separate client, because ERP records are branch-scoped.
- [x] Implement client create, read, update, list, and phone-search endpoints (`/api/v1/erp/clients`, plus `GET /erp/clients/by-phone` for exact lookup during a sale).
- [x] Preserve clients referenced by historical invoices — achieved structurally: there is no delete endpoint and no soft-delete column, so a client can never be removed.
- [x] Add branch-scoped, paginated client visit-history reads through `GET /api/v1/erp/sales/clients/:clientId/visits`, excluding draft invoices consistently from both rows and totals.
- [x] Add contracts, authorization, branch-isolation, search, duplicate, and MySQL tests.
- [x] Add Arabic/RTL POS Admin client management with create, read, update, list, and phone search.
- [x] Add POS client phone search, selection, duplicate handling, and inline client creation for a sale (`ClientPicker`, consumed by the ERP 9 sale workflow).
- [x] Add component coverage for client administration and the POS client-selection workflow (form-schema, view, and picker tests; no dedicated e2e framework exists in this repo, matching `apps/web` and ERP 1–3).

Cross-branch isolation is enforced on every read and write: a client outside the acting branch is reported as missing rather than forbidden, so a Cashier cannot probe another branch's records by id. The acting branch is always derived from the account through `createErpBranchContextResolver` and never taken from the request body.

**Shared ERP foundation added by this slice** (first ERP slice to mount a router, so it had to build the runtime composition that later ERP slices reuse):

- `audit/erp-audit-capability.ts` + `auditModule.erp` — ERP may not import HR internals, and `audit` is on the restricted list, so audit writes now cross the capability bridge. The ERP-facing event omits `actor`, so the acting account always comes from the authenticated request context.
- `erp/erp-actor.ts` — translates `response.locals.actor` into `ErpAccountIdentity`, and rejects an admin session with no acting account.
- `ErpBranchContextResolver` type export, ERP wiring in `server.ts`, and ERP router mounting in `routes/index.ts` behind HR's auth middleware.

## ERP 6. Categories and services — Complete

- [x] Add one category table with `service` and `expense` type values (`erp_categories`, migration `0045_easy_lizard.sql`).
- [x] Enforce category-name uniqueness within each type. Uniqueness is `(branch_id, type, name_normalized)`: ERP records are branch-scoped, so "unique per type" is enforced inside each branch's own catalog, the same way ERP 5 scopes client phone uniqueness per branch. Normalization reuses the Branches sha256 lower-cased form.
- [x] Implement category create, read, update, list, and safe deletion/deactivation behavior. `is_active` retires a category; `has_ever_been_referenced` is set transactionally the first time a service points at it and permanently blocks deletion (the Branches protection-hook pattern), so deletion only ever removes a category nothing has used. ERP 15 expenses reuse the same `markCategoryReferenced` hook. Category `type` is immutable.
- [x] Add service schema with name, description, fixed EGP price, category, default commission settings, and active state (`erp_services`). Price is `decimal(12,2)` with a `> 0` check; the default commission is `decimal(5,2)` percent of the pre-discount list price with a `between 0 and 100` check. Names are unique per branch.
- [x] Add per-employee service commission overrides (`erp_service_commission_overrides`, unique on `(service_id, employee_id)`, same exact-decimal percentage and range check). Overrides are validated against the acting branch's employees through the HR employee capability.
- [x] Implement service and commission-override administration endpoints. Writes are Admin-only; reads are open to any ERP account so a Cashier can browse the catalog.
- [x] Prevent catalog edits from changing historical invoice facts. Structural: services have no delete operation and no soft-delete column, categories cannot be deleted once referenced, and category type cannot change — so every fact an ERP 8 invoice line will snapshot (name, price, commission rate, category) stays resolvable and every edit affects future invoices only.
- [x] Add exact-money, validation, authorization, branch, lifecycle, and MySQL tests.
- [x] Add Arabic/RTL POS Admin category, service, and employee commission-override management (`/catalog`, admin-only, with the branch selector an Admin needs because they belong to no branch).
- [x] Add POS service browsing and search with active-state, fixed-price, empty, loading, and error behavior (`/services`, `ServicePicker`). "Active" means the service *and* its category are live, so retiring a category removes its services from the counter.
- [x] Add component coverage for catalog administration and POS service discovery (schema, view, and picker tests; no dedicated e2e framework exists in this repo, matching `apps/web` and ERP 1–5).

Current catalog endpoints:

- `POST|GET /api/v1/erp/categories`, `GET|PATCH|DELETE /api/v1/erp/categories/:id`
- `POST|GET /api/v1/erp/services`, `GET|PATCH /api/v1/erp/services/:id`
- `GET|PUT /api/v1/erp/services/:id/commission-overrides`, `DELETE /api/v1/erp/services/:id/commission-overrides/:employeeId`

Commission is modelled as a percentage rate only (no fixed-amount commission kind): the locked decisions describe a "configurable **rate** per service" and ERP 9 calculates commission *from the pre-discount list price*, and fixed-amount commission is never mentioned. The "commission rule" ERP 8 must snapshot is therefore which rule applied — the per-employee override or the service default — alongside the rate itself.

## ERP 7. Attendance assignment capability — Complete

- [x] Publish `listPresentEmployees(branchId)` from Attendance without exposing Attendance internals. The capability now projects explicitly to `{ id, employeeCode, fullName, branchId }`, so no session, event, device, GPS, or credential field can reach the ERP even if the reader widens.
- [x] Return only active employees with an open Attendance session in the requested branch. Presence means an open session of that branch, still inside the locked 16-hour ceiling, for an `active`, non-soft-deleted employee.
- [x] Add an ERP endpoint for employees eligible for invoice assignment: `GET /api/v1/erp/assignable-employees`. It is read-only, behind the ERP account boundary, and resolves the acting branch through `createErpBranchContextResolver` — an Admin must name the branch, a Cashier's branch comes from their linked employee, and naming another branch is rejected.
- [x] Revalidate employee presence inside the sale transaction through `ErpAttendanceCapability.findPresentEmployee(branchId, employeeId, context?)` and `EmployeeAssignmentService.assertAssignable(actor, { employeeId, branchId? }, context?)`, so checkout races reject the whole sale atomically.
- [x] Reject assignment when the employee checked out after being selected. `assertAssignable` re-reads live presence on every call and raises `ERP_EMPLOYEE_NOT_PRESENT` (HTTP 409) once the session closes.
- [x] Provide no Cashier or Admin override for assigning an unchecked-in employee. Structural: both roles run the identical check, `assignEmployeeSchema` is `.strict()` so no override field can be sent, and the service exposes no bypass parameter.
- [x] Add checkout-race, branch-isolation, soft-deletion, and integration tests. Real-MySQL coverage spans presence, branch isolation, never-checked-in, check-out, deactivation, soft deletion, the 16-hour timeout, and an in-transaction re-check.
- [x] Add the POS currently-present employee selector with refresh, empty, checked-out, and stale-selection states (`apps/pos/src/features/employee-assignment`, consumed by the ERP 9 sale workflow like ERP 5's `ClientPicker`). A selection that checked out is dropped with an Arabic warning so the counter notices before submitting — never as a replacement for the server check.
- [x] Add component and end-to-end coverage for assignment eligibility, branch isolation, and the select-then-checkout race (contract, service, router, mounting, component, and real-MySQL tests; no dedicated e2e framework exists in this repo, matching `apps/web` and ERP 1–6).

No migration was needed: assignment eligibility owns no tables and reads live Attendance through the public capability only.

## ERP 8. Core sales schema

- [x] Add invoice schema with branch, client, assigned employee, acting account, Cashier session, status, totals, timestamps, and historical snapshots.
- [x] Add invoice-line schema for services and products.
- [x] Snapshot line item name, type, list price, commission rule/rate, and product cost basis where applicable.
- [x] Add invoice-level percentage/fixed discount fields and computed amount snapshot.
- [x] Add invoice-level percentage/fixed tax fields and computed amount snapshot.
- [x] Add payment records supporting Cash, Visa, InstaPay, and Vodafone Cash.
- [x] Require payment amounts to sum exactly to the final invoice total.
- [x] Add daily invoice sequence schema and Cairo-time allocation.
- [x] Format invoice numbers as `INV-YYYY.MM.DD-HH.MM-<seq>`.
- [x] Accept sequence gaps after rolled-back transactions and never reuse a number.
- [x] Add client-generated sale idempotency keys with a database uniqueness invariant.
- [x] Add immutable commission-ledger schema with reversal support.
- [x] Add all required indexes, foreign keys, checks, and migrations.
- [x] Publish complete sale draft, totals, payment, invoice, and error contracts for the POS application without exposing persistence internals.
- [x] Add contract fixtures that support the complete POS service-sale workflow and its validation/error states.

Complete. This persistence foundation intentionally has no standalone screen. The minimal branch-scoped product catalog identity was pulled forward from ERP 13 so product invoice lines have a real foreign key; ERP 13 still owns product administration, stock balances/movements, availability, and POS product workflows. Migrations `0046_tearful_sentry.sql` and `0047_stiff_gideon.sql` create and harden the sales foundation, preserve branch ownership through composite foreign keys, permit completion only after lines, payments, and earned commissions exactly cover the invoice, lock completed snapshots, and enforce cumulative-rounding-safe append-only commission lineage with database triggers. The public contracts carry exact-money sale drafts, authoritative totals, exact payment-sum and snapshot-consistency validation, stored invoice facts, stable errors, and workflow fixtures for ERP 9.

## ERP 9. Atomic service-sale vertical slice — Complete

- [x] Implement server-side price, discount, tax, payment, and total calculation.
- [x] Assign exactly one present employee to the complete invoice.
- [x] Calculate service commission from the pre-discount list price.
- [x] Resolve per-employee commission override before the service default.
- [x] Complete invoice, lines, payments, invoice number, commission entries, and audit event in one database transaction.
- [x] Return the existing invoice for a repeated idempotency key.
- [x] Reject reuse of an idempotency key with a different payload.
- [x] Keep receipt printing outside the transaction.
- [x] Add happy-path, rollback, calculation, snapshot, duplicate, authorization, attendance-race, and real-MySQL tests.
- [x] Build the Arabic/RTL POS service-sale workflow: select or create the mandatory client, add service lines, assign one present employee, enter invoice-level discount/tax, and enter mixed payments.
- [x] Show server-calculated totals and exact remaining-payment feedback; never treat browser calculations as authoritative.
- [x] Add confirmation, duplicate-submit protection, stored-invoice success, safe failure, ambiguous-response, and retry states.
- [x] Add split component/API/MySQL integration coverage for the authenticated Cashier sale workflow, HTTP authorization/error mapping, and atomic persisted aggregate.
- [ ] Add a single browser-to-authenticated-HTTP-to-MySQL vertical test when the repository gains its end-to-end browser harness; current coverage does not claim that boundary.

Complete. `POST /api/v1/erp/sales/quote` provides authoritative quotes, `POST /api/v1/erp/sales` atomically persists the completed aggregate, and `GET /api/v1/erp/sales/clients/:clientId/visits` completes the deferred client-history capability. The Arabic `/sales` work surface composes the existing client, service, and present-employee selectors with discount/tax, mixed payments, confirmation, exact remaining-payment feedback, idempotent retries, and durable ambiguous-response recovery. Receipt display and printing remain in ERP 11.

## ERP 10. POS application integration and operational UX — Complete

- [x] Integrate the delivered login, Cashier-session, client, service, employee-assignment, and service-sale features into one coherent POS navigation and work surface.
- [x] Preserve authenticated and open-session state across refreshes without bypassing server validation.
- [x] Add consistent Arabic/RTL loading, empty, error, conflict, confirmation, success, and retry behavior across the integrated workflow.
- [x] Ensure the complete counter workflow is keyboard-friendly, accessible, and responsive at the supported POS display sizes.
- [x] Add route-level failure boundaries and recovery that do not lose an in-progress sale draft.
- [x] Add cross-feature component and end-to-end coverage for login through completed service sale.

Complete. The responsive Arabic/RTL shell now joins the delivered account-aware destinations, active-route state, and server-validated Cashier-session status. An owned open session links directly into the sale workspace. In-progress drafts are isolated by actor, branch, and Cashier session, survive refreshes and protected-route failures, and are removed after a completed sale. Component coverage exercises the integrated navigation, session handoff, draft recovery, accessible failure boundary, and sale lifecycle; the Playwright browser harness completes the Cashier login-to-invoice workflow at wide and compact POS viewports with controlled HTTP fixtures. The separate browser-to-authenticated-HTTP-to-MySQL boundary remains explicitly tracked under ERP 9 and is not claimed here.

## ERP 11. Receipts — Software complete; hardware validation deferred

- [x] Add authorized stored-invoice history/detail API operations and contracts for receipt display and reprint.
- [x] Build the stored-invoice receipt view.
- [x] Add Arabic 80mm thermal browser-print CSS as the default mechanism.
- [x] Print only an already-stored invoice and never resubmit a sale to print.
- [x] Support reprinting from invoice history.
- [x] Include invoice number, Cairo date/time, client, assigned employee, lines, discount, tax, payments, total, and authorized-by account.
- [ ] Test output with the selected production printer hardware.
- [ ] Add a local print agent only if the selected hardware cannot be supported reliably by browser printing.
- [x] Add receipt loading, unavailable-printer, print failure, reprint, and authorization states to the POS invoice-history workflow.
- [x] Add component and end-to-end coverage proving printing and reprinting use stored invoice facts and never resubmit a sale.

Software complete. The authorized branch-scoped history/detail API hydrates immutable stored invoice facts for the Arabic/RTL receipt and reprint workflow. Browser printing targets 80mm thermal output and never writes a sale. Component tests cover loading and operational errors; the repeated wide/compact Playwright matrix proves sale → stored receipt → print → history → reprint, safe read-failure recovery with request references, and zero duplicate sale writes. Physical output validation and the conditional local-agent decision are deferred because the selected production printer is unavailable as of 2026-08-04.

## ERP 12. Vertical-slice hardening — Complete

- [x] Lock and verify invoice-number allocation under concurrency.
- [x] Verify idempotency under double-clicks, retries, timeouts, and ambiguous responses.
- [x] Verify full transaction rollback at every persistence failure point.
- [x] Add stable ERP error codes and safe unexpected-error handling.
- [x] Add request/correlation IDs to ERP API, audit, jobs, and errors.
- [x] Add branch-isolation and horizontal-access tests for every completed endpoint.
- [x] Add security tests for cookies, sessions, roles, request validation, and secret leakage.
- [x] Run load/concurrency tests for the completed service-sale path.
- [x] Harden POS behavior for stable ERP errors, correlation IDs, timeouts, ambiguous submissions, expired sessions, and access denial.
- [x] Run browser-level failure-injection and concurrency scenarios for all completed workflows.

Complete. MySQL integration coverage verifies 20 concurrent daily sequence allocations, concurrent idempotent settlement, a 10-sale burst without loss or duplication, branch isolation, and transaction rollback at invoice, line, commission, payment, completion, and audit failure points. API coverage locks stable safe errors, role/validation boundaries, request-ID propagation, and secret non-leakage. POS coverage locks timeouts and ambiguous submission recovery, while browser scenarios exercise same-tick duplicate confirmation, the completed sale/receipt workflow, and injected receipt-read recovery at both supported viewports.

## ERP 13. Products and stock

- [x] Add product schema with name, description, selling price, last purchase cost, low-stock threshold, and active state.
- [x] Add branch product-stock balances.
- [x] Add immutable stock movements with reason, source, quantity delta, and acting account.
- [x] Add product administration endpoints and POS product search.
- [x] Add product lines to invoices and snapshot their last-purchase-cost basis.
- [x] Decrease product stock inside the sale transaction.
- [x] Lock stock rows so concurrent sales of the last unit cannot create negative stock.
- [x] Reject negative stock without an override.
- [x] Add low-stock queries and alerts.
- [x] Add stocktaking adjustments for count correction, wastage, and damage.
- [x] Exclude products from commission calculations.
- [x] Add stock integrity, concurrency, adjustment, audit, branch, and MySQL tests.
- [x] Add Arabic/RTL POS Admin product management, branch stock balances, low-stock alerts, movement history, and stocktaking adjustment workflows.
- [x] Add POS product search, cart lines, availability feedback, and stable out-of-stock conflict handling.
- [x] Add component and end-to-end coverage for product administration, stock adjustment, product sale, and last-unit concurrency behavior.

No product variants, multiple units, consumable tracking, negative-stock override, or inter-branch transfers are included.

Complete. Product balances are branch-scoped and non-negative, movements are append-only with database-enforced reason/source/direction semantics, and product sale settlement locks balances and writes invoice, cost snapshot, stock decrement, and movement atomically. Cashier responses expose selling facts and availability but redact purchase cost and invoice cost basis. Admin product, low-stock, movement-history, and stocktaking workflows are covered alongside real-MySQL rollback and last-unit concurrency tests and wide/compact browser scenarios.

## ERP 14. Suppliers and purchases — Complete

- [x] Add supplier schema, migration, and branch-scoped CRUD.
- [x] Add purchase and purchase-line schemas.
- [x] Record supplier, product, quantity, unit cost, totals, date, and acting account.
- [x] Post each purchase and its stock movements atomically.
- [x] Increase branch stock and update last purchase cost when a purchase posts.
- [x] Preserve posted purchase history and define safe correction/cancellation behavior.
- [x] Add supplier and product purchase-history queries.
- [x] Add validation, exact-money, stock, transaction, authorization, branch, and MySQL tests.
- [x] Add Arabic/RTL POS Admin supplier management, purchase entry/posting, and supplier/product purchase-history workflows.
- [x] Show exact totals, immutable-posted state, correction/cancellation outcomes, and resulting stock changes.
- [x] Add component and end-to-end coverage for supplier lifecycle and purchase-to-stock workflows.

Purchases are fully paid. Supplier balances, credit, and returns are excluded.

Complete. Posted purchases atomically update stock and the last-purchase-cost basis, immutable supplier/product snapshots preserve history, and guarded cancellation/correction workflows safely reverse stock and restore the remaining cost basis. Branch isolation, authorization, exact-money validation, rollback/concurrency behavior, and Arabic wide/compact Admin workflows are covered.

## ERP 15. Expenses — Complete

- [x] Add branch-scoped expense schema and migration.
- [x] Require an expense-type category, exact EGP amount, Cairo date, description, and acting account.
- [x] Implement expense create, read, list/filter, and safe correction behavior.
- [x] Audit every expense mutation.
- [x] Add Arabic/RTL POS Admin expense create, read, list/filter, and safe correction workflows.
- [x] Add validation, category-type, authorization, branch, audit, and MySQL tests.
- [x] Add component and end-to-end coverage for expense creation, filtering, correction, authorization, and audit behavior.

Complete. Admin-only expense workflows use branch-scoped active expense categories, exact positive EGP amounts, valid Cairo calendar dates, and immutable database facts. Corrections atomically append a reversal and active replacement, preserve chained lineage, require a complete pair before the original status can change, and audit all three mutation facts. API, component, real-MySQL rollback/concurrency, and wide/compact browser coverage verifies creation, pagination/filtering, correction, branch isolation, authorization, and audit behavior.

## ERP 16. Voids and refunds — Complete

- [x] Implement void as a same-day full cancellation.
- [x] Implement refund as a full or partial reversal after completion.
- [x] Preserve the original invoice and append all void/refund facts.
- [x] Permit both Admin and Cashier accounts without an approval hierarchy.
- [x] Record the acting account and retain an unused optional approving-account field for future compatibility.
- [x] Restore stock for reversed product quantities.
- [x] Append commission-ledger reversals for reversed service quantities.
- [x] Record reversed payment amounts by their original method labels.
- [x] Prevent over-refunding and invalid invoice-state transitions.
- [x] Make void/refund submissions idempotent.
- [x] Add same-day boundary, partial/full, stock, commission, concurrency, authorization, audit, and MySQL tests.
- [x] Add Arabic/RTL Admin and POS invoice search/detail plus eligible void and partial/full refund workflows.
- [x] Show immutable original facts, reversible quantities/payments, confirmation, idempotent result, and invalid-transition states.
- [x] Add component and end-to-end coverage for same-day voids, later refunds, stock restoration, commission reversal, and repeat submission.

Complete. Same-day Cairo voids and later full/partial refunds preserve immutable invoice facts while appending normalized reversal lines and original-method payment facts. One transaction restores product stock, appends cumulative commission reversals, derives the invoice lifecycle, records the acting account and audit projection, and enforces idempotency, branch authorization, payment/quantity caps, database guards, rollback, and concurrency. Arabic RTL invoice search, detail, exact refund allocation, confirmation, immutable history, and eligible void/refund actions are covered in wide and compact browser journeys.

## ERP 17. Commission and payroll integration — Complete

- [x] Calculate net monthly employee commission from the immutable ERP ledger.
- [x] Publish commission totals to employee self-service through a public capability.
- [x] Project net monthly commission into Payroll through a public payroll-input capability.
- [x] Use the deterministic reference `erp-commission:<month>:<employeeId>`.
- [x] Make repeated payroll projection idempotent and traceable to invoice lines.
- [x] Prevent Payroll from importing or querying ERP internals.
- [x] Submit post-finalization commission reversals as HR deductions through a public capability.
- [x] Add employee commission-total UI to HR self-service.
- [x] Add month-boundary, repeated-projection, refund-reversal, finalized-payroll, traceability, and MySQL tests.
- [x] Add authorized Arabic/RTL POS Admin commission drill-down and traceability from employee/month totals to invoice lines and reversals.
- [x] Add component and end-to-end coverage for employee self-service totals, Admin traceability, payroll projection, and post-finalization reversal behavior.

Each completed service sale or pre-finalization reversal transactionally refreshes one HR-owned live input for the original Cairo payroll month, with the ledger total calculated only after the employee projection lock is held. Open payroll therefore includes the current net commission. Finalization snapshots commission income into the immutable payroll row. The ERP17 migration backfills ledger totals only for months without a finalized payroll; legacy finalized rows retain zero commission and their unpaid legacy reversals do not create deductions. A reversal after a commission-bearing payroll is finalized does not modify that payroll row; it creates one separate, idempotent HR deduction in the Cairo month when the reversal occurred. ERP-only composition may omit the Payroll capability, and HR-only self-service explicitly reports commissions unavailable when the ERP commission reader is absent, preserving the locked edition boundaries without fabricating zero earnings.

## ERP 18. Offline sale submission

- [x] Generate and persist an idempotency key before each sale submission.
- [x] Store unconfirmed completed-sale payloads in browser storage.
- [x] Replay queued submissions when connectivity returns.
- [x] Remove a queued sale only after the API confirms its stored invoice.
- [x] Show pending, syncing, failed, and resolved queue states to the Cashier.
- [x] Distinguish retryable connectivity/server failures from permanent validation conflicts.
- [x] Define resolution UX when attendance, prices, catalog availability, or stock changed while disconnected.
- [x] Test reload persistence, repeated reconnect, timeout, duplicate replay, partial response, interrupted-sync recovery, and permanent-conflict behavior across component and browser suites.
- [x] Add browser-level end-to-end coverage for queue visibility, reconnect replay without duplicate HTTP attempts, and permanent-conflict resolution.
- [ ] Add browser-to-authenticated-HTTP-to-MySQL exactly-once replay coverage when the repository gains that integration harness; API/MySQL idempotency and POS replay are currently verified in their respective suites.

Offline support is resilient submission with idempotent replay, not a fully disconnected catalog or attendance system.

## ERP 19. ERP reports and PDF exports — Complete

- [x] Add branch/date-filtered reports for sales, payment methods, services, products, employees, commissions, discounts, taxes, refunds, voids, expenses, purchases, stock, profit, and client history.
- [x] Calculate product profit using the snapshotted last-purchase-cost basis.
- [x] Build ERP report screens with pagination, filters, totals, and safe fields.
- [x] Reuse the existing database-backed worker report queue.
- [x] Add Arabic A4 invoice PDF export.
- [x] Add Arabic financial and operational report PDFs.
- [x] Read historical names, prices, rates, costs, discounts, and taxes from invoice snapshots.
- [x] Add export authorization, branch-isolation, batching, worker-retry, file-lifecycle, and MySQL tests.
- [x] Add component and end-to-end coverage for report filtering, pagination, totals, export lifecycle, retry, download, and historical-snapshot rendering.

Complete. Admins have one Arabic/RTL report workspace covering all 15 locked financial and operational reports with branch, Cairo-date, and safe search filters, full-result totals, pagination, and the durable export lifecycle. Report pages and streamed export batches read inside repeatable-read snapshots; sale facts are recognized on the sale date and void/refund facts on the Cairo date of the reversal. Historical invoice snapshots supply names, prices, commission rates, discounts, taxes, and product cost bases. Product profit is net product revenue after exact allocated invoice discount, excluding tax, less snapshotted last-purchase cost, with reversals undoing both revenue and cost.

The existing database-backed worker queue now dispatches ERP jobs without coupling HR reports to ERP internals. Tabular reports produce Arabic landscape A4 PDFs; stored invoices produce Arabic portrait A4 PDFs with immutable invoice, line, payment, discount, tax, employee, client, and authorization facts. The invoice detail owns its Admin-only queue/status/download/retry controls without affecting refund or void mutation identity. Contracts reject unsupported selected-row semantics, all report and export endpoints are Admin-only, and migration, real-MySQL branch/snapshot/profit, batching, queue retry, file lifecycle, component, and browser coverage protects the workflow.

## ERP 20. Cross-feature administration UX hardening

- [ ] Integrate the delivered Cashier-account, catalog, client, supplier, purchase, stock, expense, invoice, commission, report, and export workflows into coherent Admin navigation.
- [ ] Remove duplicate or placeholder administration entry points and preserve public feature boundaries.
- [ ] Standardize Arabic/RTL loading, empty, error, confirmation, conflict, permission, and success states across all Admin ERP features.
- [ ] Complete accessibility, keyboard, responsive-layout, focus-management, and destructive-action confirmation review.
- [ ] Verify cross-feature cache invalidation and navigation after mutations without hiding server-side conflicts.
- [ ] Add end-to-end regression journeys spanning related Admin features.

This slice hardens and integrates administration features already delivered in their owning slices; it must not defer missing feature UI from ERP 1–19.

## ERP 21. Editions and runtime module registry

- [ ] Create a startup module registry with core, sellable, and support classifications.
- [ ] Keep auth, branches, employees, and audit always enabled as core.
- [ ] Add dependency expansion for sellable and support modules.
- [ ] Define the supported `hr`, `erp`, and `full` edition module sets.
- [ ] Include Attendance in the ERP edition because employee assignment requires live presence.
- [ ] Fail startup loudly for unknown edition names.
- [ ] Log the resolved module list at startup.
- [ ] Construct and mount only API modules enabled by the resolved edition.
- [ ] Keep one database migration history and migrate every schema in every edition.
- [ ] Build and expose only the frontend routes/navigation supported by each resolved edition; disabled feature URLs must fail safely.
- [ ] Keep `apps/web` HR-only, `apps/pos` ERP-only, and enable both containers for `full`.
- [ ] Add Docker Compose profiles for the HR and POS containers.
- [ ] Add edition-resolution, boot, disabled API/UI route, migration, frontend build, and smoke tests.

## ERP 22. Multi-frontend production security

- [ ] Serve each frontend and its `/api` proxy under the same origin.
- [ ] Route HR and POS `/api` traffic to the shared API container at the reverse proxy.
- [ ] Preserve host-only `SameSite=strict` cookies.
- [ ] Keep HR and POS browser sessions independent.
- [ ] Keep cross-origin allowances limited to explicit development configuration.
- [ ] Add deployment examples for recommended subdomains and supported separate-domain topology.
- [ ] Add safe frontend handling for expired, missing, wrong-role, and cross-application sessions.
- [ ] Add production cookie, proxy, origin, CSRF, protected-route, and session-isolation verification across both frontends and the API.

## ERP locked exclusions

- No ETA/e-invoice or government integration.
- No anonymous clients, deposits, tabs, installments, prepaid packages, appointments, or service price ranges.
- No cashier-entered service pricing; invoice-level discount is the permitted price variation.
- No employee assignment without a live Attendance check-in.
- No product commissions or tracked service consumables.
- No supplier credit, supplier balances, supplier returns, product variants, multiple units, stock transfers, or negative stock.
- No payment-provider references or reconciliation.
- No cash-drawer counting or reconciliation.
- No in-app backup/restore feature.
- No additional account roles beyond Admin and Cashier.
- No granular module combination is sellable until promoted to a named, smoke-tested edition.

## ERP immediate action

ERP 1–19 are delivered subject to the explicitly recorded validation deferrals. ERP 9's browser-to-authenticated-HTTP-to-MySQL validation remains deferred until that integration harness exists. ERP 11 physical-printer validation and the conditional local print-agent decision remain deferred until the selected production hardware is available. ERP 18's browser-to-authenticated-HTTP-to-MySQL exactly-once harness remains explicitly deferred until that integration harness exists. ERP 20 cross-feature administration UX hardening is the next critical-path phase.

## Locked exclusions — do not implement

- Do not add public registration, employee self-registration, extra admin accounts, or additional roles.
- Do not add notification center, push, email, SMS, or WhatsApp notifications.
- Do not add CSV/Excel exports, admin import UI, payment tracking, shift templates, branch archival, or employee restoration. **SKIP — USER CONFIRMED (2026-07-20):** All biometric services, local or cloud, are outside scope.
- Remove rather than implement Benefits, Departments, Positions, Recruitment, Onboarding, Performance, Documents, Organization, Notifications, and other excluded scaffolds.
- Do not treat final aesthetic design as part of this tracker; preserve functional Arabic/RTL and accessibility requirements for the later visual-design pass.

## Immediate action

Perform final infrastructure/security/accessibility/E2E, placeholder, migration-chain, and documentation hardening. The admin Attendance, personal-device Attendance, shared branch kiosk, Dashboard, Attendance-backed employee self-service, Payroll, and Reports workflows are implemented. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition, liveness, biometric processing, recognition Settings, and Legacy Seeds are not prerequisites and will not be implemented.
