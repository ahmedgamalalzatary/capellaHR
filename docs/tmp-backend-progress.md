# Capella HR implementation tracker (temporary)

Last rebuilt: 2026-07-20

This is the temporary working checklist for completing the full functional product. The locked product rules remain in `docs/hr-specs.md`; this file tracks implementation progress and dependency order only.

## User-confirmed scope decision

- **SKIP — USER CONFIRMED (2026-07-20):** Do not implement Capella-managed facial recognition, face enrollment/templates, liveness challenges, ONNX processing, biometric thresholds, or biometric Settings.
- **ACTIVE REPLACEMENT — USER CONFIRMED (2026-07-20):** Employee-originated check-in and check-out use employee code plus the four-digit PIN while retaining the applicable registered-device/WebAuthn and assigned-branch GPS checks.
- Face ID, fingerprint, or device passcode used internally by a phone to satisfy WebAuthn user verification is device-platform behavior, not Capella facial recognition, and remains allowed.

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
- [x] Store the initial shift duration and base salary; attendance timing effects remain deferred to Attendance. **SKIP — USER CONFIRMED (2026-07-20):** Face enrollment will not be implemented.
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

## Previously deferred slices

Attendance was previously deferred and is now the immediate active completion path after the completed non-Attendance Roles foundation and general Audit/correlation slice. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition is removed from the completion path and from downstream dependencies.

## 8. Salaries and Payroll — Backend Complete; Attendance Gateway Deferred

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

## 12. Reports and PDF Exports — Backend Complete for Available Sources

- [x] Add admin-only read APIs for Branches, Employees, Devices, Shifts, Weekly Day-Off, Bonuses, Deductions, and Advances.
- [ ] Add Attendance/Absence and Payroll report readers after Attendance supplies trustworthy facts; both currently fail closed with `REPORT_SOURCE_UNAVAILABLE`.
- [x] Exclude login/admin-session activity and denied/flagged attendance attempts.
- [x] Provide Arabic detailed rows, fixed safe field sets, and relevant totals/summaries.
- [x] Exclude employee images, PINs and hashes, device credentials, and all secrets. **SKIP — USER CONFIRMED (2026-07-20):** No biometric fields or artifacts will exist to report.
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

Reports migrations `0014_lyrical_tusk.sql` through `0015_yummy_puma.sql` add the durable export queue and its bounded-cycle/lifetime retry accounting. The full 18-entry migration chain is applied to `capella_hr-test`.

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
- [x] Add admin and employee login forms plus the employee WebAuthn authentication-options flow.
- [x] Add the Arabic/RTL employee self-service view for own non-secret profile, branch, shift, finalized payroll, weekly-day/absence records, bonuses, deductions, advances/installments, pagination, and logout.
- [x] Add the admin-only immutable Audit History view with search, actor/module/date filters, pagination, retry/empty states, and expandable redacted details.

### Still required

- [ ] Replace the placeholder admin Attendance page with attendance/absence, denied/flagged-attempt, approval, manual-event, timeout, and correction workflows.
- [ ] Replace the placeholder Dashboard page with all locked operational summaries.
- **SKIP — USER CONFIRMED (2026-07-20):** ~~Replace the placeholder Settings page with company-wide face-match and liveness threshold management plus supervised enrollment entry points where relevant.~~
- [ ] Implement the personal-device attendance interface with employee code, PIN, GPS, WebAuthn, check-in, and check-out flows.
- [ ] Implement the shared branch-kiosk interface with employee code, PIN, registered branch-device validation, GPS, check-in, and check-out flows. **SKIP — USER CONFIRMED (2026-07-20):** No camera, randomized liveness, or face match.
- [ ] Extend employee self-service with Attendance history and trustworthy open payroll previews after the Attendance gateway exists.
- [ ] Expose the Attendance/Absence and Payroll report tabs only after their backend readers become trustworthy.
- [ ] Run a final functional web audit for Arabic/RTL rendering, Cairo dates, numeric and monetary presentation, search/filter/reset behavior, empty/error/loading states, authorization, accessibility, and responsive operation.

## Dependency-ordered completion roadmap

The detailed module checklists below remain the acceptance criteria. Step 1 is complete; implement the remaining work in this order:

1. **Completed:** Non-Attendance Roles and Employee Self-Service authorization foundation.
2. **Completed:** Shared request correlation and the general immutable Audit system.
3. **SKIP — USER CONFIRMED (2026-07-20):** ~~Implement Facial Recognition, encrypted templates, enrollment, liveness, and recognition Settings.~~
4. Implement the Attendance/Absence data model and employee-code/PIN verification flows, employee/admin workflows, denied and flagged attempts, calculations, and corrections.
5. Extend the worker with midnight absences, exact 16-hour timeouts, and attendance/payroll reconciliation; wire all Attendance cross-module hooks. **SKIP — USER CONFIRMED (2026-07-20):** No biometric-processing worker job.
6. Supply trustworthy Attendance facts to Payroll and Reports and remove their production fail-closed gateways.
7. Complete production employee self-service, including all session-revocation and device-revocation rules.
8. Implement Dashboard operational visibility.
9. Implement idempotent legacy seeds.
10. Complete the corresponding web workflows as each backend slice becomes available, then perform shared infrastructure and final hardening.

## 13. Roles and Employee Self-Service

Current boundary: the Roles and Employee Self-Service work possible without the Attendance gateway is complete. The remaining login eligibility, Attendance history, open-payroll preview, checkout/timeout revocation, and related tests resume after Attendance/Absence exists. The immediate next project slice is Attendance/Absence. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition and biometric Settings are removed.

- [x] Retain exactly two fixed actor types in the authentication/session foundation: the singleton Admin and Employee.
- [x] Protect employee image endpoints for Admin only.
- [x] Add the employee-login contracts, service/router flow, PIN/phone/device verification, session support, and Attendance eligibility gateway.
- [x] Enforce Admin/Employee authorization consistently across every currently implemented Express endpoint and keep the employee API structurally GET-only.
- [ ] Preserve that authorization coverage across future endpoints, including immutable-state rules that Admin cannot bypass.
- [ ] Wire the existing employee-login foundation to the real Attendance gateway in production so an open attendance session is required.
- [x] Limit each employee to their own non-secret profile, branch, shift, days off, finalized payroll, bonuses, deductions, and advances/installments.
- [ ] Add the employee's own Attendance history and open payroll preview after trustworthy Attendance facts exist.
- [x] Keep self-service completely read-only and prohibit employee access to images, secrets, Reports, PDFs, and exports.
- [x] Revoke employee sessions on PIN reset and employee deletion.
- [x] Preserve the locked exception in which personal-device revocation does not revoke an already-active self-service session.
- [ ] Revoke employee sessions on checkout and automatic timeout, including ending a device-revocation exception at checkout.
- [x] Add horizontal-access, secret/image denial, mutation denial, current session-revocation, and MySQL integration tests.
- [ ] Add Attendance-dependent checkout, timeout, and open-session integration tests with the Attendance slice.

## 14. Audit History

Audit migration `0016_clammy_wilson_fisk.sql` creates the immutable audit stream, and `0017_swift_mac_gargan.sql` adds the originating request ID to report exports so background audit events retain correlation.

- [x] Add permanent immutable audit records and admin-only read/search/filter endpoints.
- [x] Audit every mutation and security-sensitive/system event in the currently implemented modules, but not ordinary page/report views.
- [x] Store actor, action/module, entity, before/after values, Cairo timestamp, request ID, network/browser context, and related identifiers where available.
- [x] Redact/exclude passwords, PINs and hashes, session tokens/cookies, credential material, and other secrets. **SKIP — USER CONFIRMED (2026-07-20):** Biometric templates will not exist.
- [x] Integrate auditing transactionally across all currently implemented modules and preserve originating correlation IDs across background report transitions.
- [x] Add immutability, completeness, redaction, authorization, correlation, rollback, background-transition, and MySQL tests.

## 15. Dashboard Operational Visibility

- [ ] Add admin-only summary endpoints for currently checked-in employees and previous-day open sessions.
- [ ] Add current-day not-checked-in, latest absences/day-off conversions, and denied/flagged attempt summaries.
- [ ] Add automatic-timeout, device pairing/replacement, payroll blocker, and PDF-job summaries.
- [x] Keep notification center, push, email, SMS, and WhatsApp notifications outside scope.
- [ ] Add authorization, Cairo-boundary, aggregation, and MySQL tests.

## 16. Legacy Seeds

- [ ] Implement developer-run idempotent database seeds with no import UI.
- [ ] Match legacy employees by immutable numeric employee code and never duplicate an existing code.
- [ ] Preserve populated/admin-edited production data and fill only genuinely missing required seed fields.
- [ ] Continue new employee-code allocation after the highest seeded/stored code.
- [ ] Add rerun, preservation, missing-field, allocation, and MySQL tests.

## 17. Background Worker and Durable Jobs

- [x] Add `apps/worker` and the first MySQL-backed durable job flow without Redis.
- [ ] Add the remaining durable handlers/schedules for midnight absences, 16-hour timeouts, and reconciliation. **SKIP — USER CONFIRMED (2026-07-20):** Do not add biometric processing.
- [x] Store PDF-job state, attempts, failure reason, and lifecycle timestamps.
- [x] Retry PDF generation failures up to three times; dashboard exposure remains pending.
- [x] Permit admin retry for failed PDF jobs without erasing lifetime attempt/failure history.
- [ ] Continue reconciliation retries for attendance/payroll state until success.
- [x] Make PDF generation and file deletion recoverable/idempotent against duplicate jobs and process restarts; other future handlers remain pending.
- [ ] Add scheduling, retry, crash recovery, idempotency, concurrency, and MySQL tests.

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

- [ ] Add attendance sessions/events, denied attempts, flagged attempts, automatic absences, and immutable snapshots.
- [ ] Use UTC storage and `Africa/Cairo` for all workday decisions.
- [ ] Assign a cross-midnight session entirely to its Cairo check-in date.
- [ ] Atomically enforce one session per employee/check-in date and one open session per employee.
- [ ] Implement personal-phone check-in/out with employee code, PIN, GPS, and registered WebAuthn proof.
- [ ] Implement branch-phone check-in/out with employee code, PIN, registered branch-device validation, and GPS. **SKIP — USER CONFIRMED (2026-07-20):** No liveness or face match.
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

## 19. Session Persistence — Foundation Complete; Attendance Integration Pending

- [x] Store secure opaque admin and employee session records in MySQL so API restarts do not lose session state.
- [x] Support explicit logout and direct employee-session revocation in the authentication foundation.
- [x] Wire immediate employee-session revocation to PIN reset and employee deletion.
- [ ] Wire immediate employee-session revocation to attendance checkout and automatic timeout.
- [x] Preserve the locked exception in which an already-active employee session survives personal-device revocation before attendance checkout.
- [ ] End that device-revocation exception at attendance checkout.
- [ ] Add production integration coverage for restart persistence and every locked revocation path.

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
- [ ] Run complete lint, typecheck, builds, unit tests, component tests, real-MySQL integration tests, concurrency tests, worker tests, and critical end-to-end admin, employee, attendance, payroll, and report workflows.
- [ ] Apply the final migration chain cleanly to empty `capella_hr` and `capella_hr-test` databases.
- [ ] Verify the completed `apps/web` functionality matches the locked Arabic/RTL, authorization, validation, filtering, empty-state, attendance, self-service, reporting, and operational requirements without expanding into deferred aesthetic design.
- [ ] Update this tracker, `docs/architecture.md`, and the target tree after full functional completion.

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

## Locked exclusions — do not implement

- Do not add public registration, employee self-registration, extra admin accounts, or additional roles.
- Do not add notification center, push, email, SMS, or WhatsApp notifications.
- Do not add CSV/Excel exports, admin import UI, payment tracking, shift templates, branch archival, or employee restoration. **SKIP — USER CONFIRMED (2026-07-20):** All biometric services, local or cloud, are outside scope.
- Remove rather than implement Benefits, Departments, Positions, Recruitment, Onboarding, Performance, Documents, Organization, Notifications, and other excluded scaffolds.
- Do not treat final aesthetic design as part of this tracker; preserve functional Arabic/RTL and accessibility requirements for the later visual-design pass.

## Immediate action

Proceed with Attendance/Absence using employee code and PIN plus the applicable device and GPS checks, followed by its durable worker jobs. Use trustworthy Attendance facts to unlock Payroll and Reports, then complete employee self-service, Dashboard, legacy seeds, the corresponding functional web workflows, and final hardening. **SKIP — USER CONFIRMED (2026-07-20):** Facial Recognition, liveness, biometric processing, and recognition Settings are not prerequisites and will not be implemented.
