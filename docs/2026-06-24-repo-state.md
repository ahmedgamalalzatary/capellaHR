# Capella HR Repo State

Date: 2026-07-01

## Purpose

This document captures the current implementation state of the repository across backend, frontend, shared contracts, and delivery infrastructure.

It answers four questions:

1. What is already implemented?
2. What is only partially implemented?
3. What has not been started yet?
4. In what order should the remaining work be executed?

## Status Legend

- `Done`: implemented enough to be considered working in the current repo shape.
- `Partially Done`: significant implementation exists, but important pieces are still missing.
- `Not Done`: either no implementation exists or only placeholders/navigation stubs exist.

## Repo Overview

### Monorepo shape

- `apps/api`: Express + TypeScript backend.
- `apps/web`: Next.js frontend.
- `packages/shared`: shared schemas, contracts, and types.
- `docs`: project documentation.

### Tooling and delivery

- Workspace/build orchestration exists via `pnpm` + `turbo`.
- Database tooling exists via Drizzle (`db:generate`, `db:migrate`, `db:push`, `db:studio`).
- Docker deployment exists for:
  - MySQL
  - API
  - migration job
  - web app
- Separate Dockerfiles exist for API and web.

Status: `Done`

Notes:

- The repo is structurally ready for multi-app development.
- CI workflow files were not inspected in this pass, so this document only reflects repo-local build/test/deployment assets.

## Current End-to-End Product State

Short version:

- Backend coverage is broad.
- Frontend coverage is still narrower than backend coverage, but it now includes the core admin employee workflow.
- Authentication, branch management, and admin employee management are meaningfully implemented front-to-back today.
- Most HR business features already exist in the backend, but are not yet exposed in the frontend.

## Recommended Delivery Order

This is the recommended implementation order from start to end, based on dependency flow and what is already present.

1. Authentication and role/session enforcement
2. Branch management
3. Employee management
4. Employee device enrollment/setup
5. Employee attendance flow
6. Admin attendance management
7. Weekly day-offs
8. Permission absences
9. Reports and exports
10. Audit logs
11. Month locks
12. Dashboard enrichment and cross-feature polish

Why this order:

- Auth must exist before protected flows.
- Branches define attendance constraints.
- Employees and their branch assignments are prerequisites for attendance.
- Device enrollment is part of attendance validation.
- Reporting, audit logs, and month locks are higher-level operational/admin capabilities on top of core transactional data.

## Detailed State By Area

### 1. Authentication

Status: `Done`

#### Backend

Implemented:

- Employee sign-in
- Admin sign-in
- Current-session lookup
- Sign-out
- Session/actor handling

Evidence:

- [apps/api/src/modules/auth/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/auth/routes.ts:17)

#### Frontend

Implemented:

- Employee sign-in page
- Admin sign-in page
- Role-aware redirect behavior
- Session lookup hooks/api client
- Sign-out from admin shell

Evidence:

- [apps/web/src/app/(auth)/sign-in/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(auth)/sign-in/page.tsx:1)
- [apps/web/src/app/(auth)/admin/sign-in/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(auth)/admin/sign-in/page.tsx:1)
- [apps/web/src/features/auth](/D:/Documents/work/capella/HR/apps/web/src/features/auth/auth.api.ts:1)

Missing:

- Nothing critical surfaced in this pass.

### 2. Branch Management

Status: `Mostly Done`

#### Backend

Implemented:

- Create branch
- List/search branches
- Get single branch
- Update branch
- Branch device lookup
- Branch setup-link generation
- Branch setup completion by token
- Branch setup-link deletion

Evidence:

- [apps/api/src/modules/branches/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/branches/routes.ts:24)

#### Frontend

Implemented:

- Branch list page
- New branch page
- Edit branch page
- Branch form
- Branch list component
- Create/update hooks and API client
- Auto-detect branch GPS via browser geolocation
- Auto-detect allowed IP via backend `GET /network/whoami`

Evidence:

- [apps/web/src/app/(admin)/branches/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/branches/page.tsx:1)
- [apps/web/src/app/(admin)/branches/new/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/branches/new/page.tsx:1)
- [apps/web/src/app/(admin)/branches/[branchId]/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/branches/[branchId]/page.tsx:1)
- [apps/web/src/features/branches/components/branch-form.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/branches/components/branch-form.tsx:1)

Still missing:

- UI for branch device state/setup
- UI for branch setup links
- Full admin operational workflow around branch provisioning

Reason for `Mostly Done` instead of `Done`:

- Core branch CRUD is implemented.
- Secondary branch onboarding/setup capabilities exist only in the backend.

### 3. Network Helper

Status: `Done`

This is a support feature, not a primary business feature.

#### Backend

Implemented:

- `GET /network/whoami`
- Returns caller IP as seen by the API server

Evidence:

- [apps/api/src/modules/network/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/network/routes.ts:11)

#### Frontend

Implemented:

- Network API wrapper
- Branch form integration for IP auto-fill

Evidence:

- [apps/web/src/features/network/network.api.ts](/D:/Documents/work/capella/HR/apps/web/src/features/network/network.api.ts:1)

Missing:

- Nothing critical for its current purpose.

### 4. Employee Management

Status: `Mostly Done`

#### Backend

Implemented:

- Create employee
- List employees
- Get employee details
- Update employee
- Delete employee
- Get employee branch assignments
- Create employee branch assignments
- Employee self endpoint
- Employee file list/download/upload endpoints

Evidence:

- [apps/api/src/modules/employees/employee-crud.routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/employees/employee-crud.routes.ts:17)
- [apps/api/src/modules/employees/employee-file.routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/employees/employee-file.routes.ts:13)
- [apps/api/src/modules/employees/employee-self.routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/employees/employee-self.routes.ts:8)

#### Frontend

Implemented:

- Admin navigation link to `/employees`
- Employee list page with search/status/branch filters and pagination
- Employee create page and form
- Employee detail/edit page
- Soft-delete action from the employee detail page
- Read-only display for soft-deleted employees
- Employee file viewing and replacement UI
- Employee branch assignment history and assignment form
- Feature API/hooks/query keys/schemas/types/components

Evidence:

- [apps/web/src/shared/components/layout/admin-nav.ts](/D:/Documents/work/capella/HR/apps/web/src/shared/components/layout/admin-nav.ts:17)
- [apps/web/src/app/(admin)/employees/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/employees/page.tsx:1)
- [apps/web/src/app/(admin)/employees/new/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/employees/new/page.tsx:1)
- [apps/web/src/app/(admin)/employees/[employeeId]/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/employees/[employeeId]/page.tsx:1)
- [apps/web/src/features/employees/employees.api.ts](/D:/Documents/work/capella/HR/apps/web/src/features/employees/employees.api.ts:1)
- [apps/web/src/features/employees/components/employee-files-section.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/employees/components/employee-files-section.tsx:1)
- [apps/web/src/features/employees/components/employee-branch-assignments-section.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/employees/components/employee-branch-assignments-section.tsx:1)

Missing:

- Employee self/profile UI if needed on the employee side
- Restore/un-delete flow for soft-deleted employees

Reason for `Mostly Done`:

- Backend and admin frontend coverage are substantial.
- The remaining gap is restore/un-delete support and any employee-facing profile screen.

Known backend gap (flagged 2026-06-25):

- `DELETE /employees/:employeeId` performs a soft delete, and the list filter exposes `status=soft_deleted`, but there is **no backend route to restore/un-delete a soft-deleted employee**. The frontend can hide an employee but cannot bring one back. Soft-deleted employees will be shown read-only in the UI until a restore endpoint is added.

### 5. Employee Device Enrollment

Status: `Mostly Done`

#### Backend

Implemented:

- Employee device lookup
- Setup-link creation
- Setup completion by device token
- Device deletion

Evidence:

- [apps/api/src/modules/employee-devices/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/employee-devices/routes.ts:24)

#### Frontend

Implemented:

- Admin employee detail UI to view active/pending employee device state.
- Admin UI to create a one-hour employee device setup link.
- Admin UI to revoke active/pending employee device access.
- Public employee device setup completion page opened from the generated setup link.

Evidence:

- [apps/web/src/features/employees/components/employee-device-section.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/employees/components/employee-device-section.tsx:1)
- [apps/web/src/features/employees/components/employee-device-setup-form.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/employees/components/employee-device-setup-form.tsx:1)
- [apps/web/src/app/employee-device-setup/[deviceToken]/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/employee-device-setup/[deviceToken]/page.tsx:1)

Missing:

- No separate top-level employee-device feature folder; device UI currently lives under the employee feature.
- Setup completion captures a browser fingerprint, but deeper real-device/browser compatibility validation still needs E2E/manual coverage.
- Operational polish can still be added around expired/revoked links and device replacement visibility.

Reason for `Mostly Done`:

- Backend flow exists.
- Core admin setup/revoke UI and public setup completion UI exist.
- Remaining work is mostly polish, coverage, and feature-boundary cleanup rather than basic implementation.

### 6. Employee Attendance

Status: `Done`

#### Backend

Implemented:

- Get current employee attendance state
- Get attendance history
- Record attendance action
- Request IP capture at route level
- Validation pipeline tied to:
  - device
  - GPS/location
  - IP range

Evidence:

- [apps/api/src/modules/attendance/employee-attendance.routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/attendance/employee-attendance.routes.ts:12)

#### Frontend

Implemented:

- Employee route exists

Evidence:

- [apps/web/src/app/(employee)/attendance/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(employee)/attendance/page.tsx:1)

Implemented:

- Employee check-in/check-out UI
- Current attendance-state loading
- Attendance history UI
- Browser geolocation capture for attendance actions
- Device fingerprint submission
- Validation-failure display for:
  - `device_not_allowed`
  - `gps_out_of_range`
  - `ip_not_allowed`
- Unknown/error current-state handling disables submission until server state is available

Reason for `Done`:

- Backend core logic exists.
- The employee-facing product flow is implemented and covered by frontend tests.

### 7. Admin Attendance Management

Status: `Done`

#### Backend

Implemented:

- List admin attendance sessions
- Create admin attendance records
- Update sessions
- Delete sessions

Evidence:

- [apps/api/src/modules/attendance/admin-attendance.routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/attendance/admin-attendance.routes.ts:21)

#### Frontend

Implemented:

- Admin attendance list/filter UI
- Manual attendance creation UI
- Manual attendance editing UI
- Session correction/deletion flow with required admin reason
- Cairo timezone-safe attendance datetime round-trip handling

Evidence:

- [apps/web/src/app/(admin)/admin/attendance/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/admin/attendance/page.tsx:1)
- [apps/web/src/features/attendance/components/admin-attendance-list.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/attendance/components/admin-attendance-list.tsx:1)
- [apps/web/src/features/attendance/components/admin-attendance-form-dialog.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/attendance/components/admin-attendance-form-dialog.tsx:1)
- [apps/web/src/features/attendance/components/admin-attendance-delete-dialog.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/attendance/components/admin-attendance-delete-dialog.tsx:1)
- [apps/web/src/tests/integration/features/attendance/admin-attendance-page.test.tsx](/D:/Documents/work/capella/HR/apps/web/src/tests/integration/features/attendance/admin-attendance-page.test.tsx:1)

Reason for `Done`:

- Admin APIs exist.
- Admin frontend workflow exists for list, filter, create, update, and delete.
- Integration coverage exercises the main workflow and timezone round-trip behavior.

### 8. Weekly Day-Offs

Status: `Done`

#### Backend

Implemented:

- List employee weekly day-offs
- Create assignments
- Update assignments

Evidence:

- [apps/api/src/modules/weekly-day-offs/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/weekly-day-offs/routes.ts:25)

#### Frontend

Implemented:

- Employee detail weekly day-off section
- List existing weekly day-off assignments
- Create weekly day-off assignments
- Update weekly day-off assignments
- Backend conflict/error messages surfaced in Arabic
- Controls hidden for soft-deleted employees via read-only employee detail state

Evidence:

- [apps/web/src/features/employees/components/employee-weekly-day-offs-section.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/employees/components/employee-weekly-day-offs-section.tsx:1)
- [apps/web/src/app/(admin)/employees/[employeeId]/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/employees/[employeeId]/page.tsx:1)
- [apps/web/src/tests/integration/features/employees/employee-detail-weekly-day-offs.test.tsx](/D:/Documents/work/capella/HR/apps/web/src/tests/integration/features/employees/employee-detail-weekly-day-offs.test.tsx:1)

### 9. Permission Absences

Status: `Done`

#### Backend

Implemented:

- List permission absences by employee
- Create absence
- Update absence

Evidence:

- [apps/api/src/modules/permission-absences/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/permission-absences/routes.ts:25)

#### Frontend

Implemented:

- Employee detail permission-absence section
- List existing permission absences
- Create permission absences
- Update permission absences
- Backend conflict/error messages surfaced in Arabic
- Controls hidden for soft-deleted employees via read-only employee detail state

Evidence:

- [apps/web/src/features/employees/components/employee-permission-absences-section.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/employees/components/employee-permission-absences-section.tsx:1)
- [apps/web/src/app/(admin)/employees/[employeeId]/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/employees/[employeeId]/page.tsx:1)
- [apps/web/src/tests/integration/features/employees/employee-detail-permission-absences.test.tsx](/D:/Documents/work/capella/HR/apps/web/src/tests/integration/features/employees/employee-detail-permission-absences.test.tsx:1)

Missing:

- Employee-facing visibility if required
- Cross-linking with attendance/history/reporting flows
- Delete UI is not implemented because no permission-absence delete endpoint exists in the current backend contract.

### 10. Reports and PDF Exports

Status: `Done`

#### Backend

Implemented:

- Monthly attendance summary
- Employees PDF export
- Attendance PDF export
- Monthly summary PDF export

Evidence:

- [apps/api/src/modules/reports/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/reports/routes.ts:34)

#### Frontend

Implemented:

- Admin reports page
- Monthly attendance summary filters by month, employee ID, and branch ID
- Summary totals and table UI
- PDF export actions for:
  - employee list
  - attendance list
  - monthly attendance summary

Evidence:

- [apps/web/src/app/(admin)/admin/reports/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/admin/reports/page.tsx:1)
- [apps/web/src/features/reports/components/admin-reports-dashboard.tsx](/D:/Documents/work/capella/HR/apps/web/src/features/reports/components/admin-reports-dashboard.tsx:1)
- [apps/web/src/tests/integration/features/reports/admin-reports-page.test.tsx](/D:/Documents/work/capella/HR/apps/web/src/tests/integration/features/reports/admin-reports-page.test.tsx:1)

Missing:

- Advanced visualizations beyond summary totals/table
- Named saved report presets, if required later

### 11. Audit Logs

Status: `Partially Done`

#### Backend

Implemented:

- Audit-log listing endpoint

Evidence:

- [apps/api/src/modules/audit-logs/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/audit-logs/routes.ts:18)

#### Frontend

Implemented:

- No frontend feature found.

Missing:

- Audit log page
- Filtering/search UX
- Actor/action/date visibility

### 12. Month Locks

Status: `Partially Done`

#### Backend

Implemented:

- List month locks
- Create month lock

Evidence:

- [apps/api/src/modules/month-locks/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/modules/month-locks/routes.ts:18)

#### Frontend

Implemented:

- No frontend feature found.

Missing:

- Month-lock management UI
- Operational rules visibility around what a lock affects
- Integration with reports/attendance admin flows

### 13. Dashboard

Status: `Partially Done`

#### Frontend

Implemented:

- Admin dashboard route
- Basic landing screen
- Quick links to sections

Evidence:

- [apps/web/src/app/(admin)/dashboard/page.tsx](/D:/Documents/work/capella/HR/apps/web/src/app/(admin)/dashboard/page.tsx:1)

Missing:

- Real metrics
- Activity summaries
- Attendance/report widgets
- Alerts or action queues

Reason for `Partially Done`:

- A shell exists, but it is not yet a functional dashboard.

## Shared Package State

### Shared contracts, schemas, and types

Status: `Done`

Implemented:

- Shared package exports contracts/schemas/types for backend and frontend consumption
- Network response schema/type has been added and exported
- Shared package is already wired as a workspace dependency in both apps

Evidence:

- [packages/shared/package.json](/D:/Documents/work/capella/HR/packages/shared/package.json:1)
- [packages/shared/src/types/index.ts](/D:/Documents/work/capella/HR/packages/shared/src/types/index.ts:1)
- [packages/shared/src/schemas/index.ts](/D:/Documents/work/capella/HR/packages/shared/src/schemas/index.ts:1)

Notes:

- The shared package appears to be the intended contract boundary between apps.
- This area is in good shape relative to the rest of the repo.

## Frontend Coverage Summary

Status: `Partially Done`

Implemented frontend feature folders:

- `auth`
- `branches`
- `attendance`
- `employees`
- `network`
- `reports`

Evidence:

- [apps/web/src/features/auth](/D:/Documents/work/capella/HR/apps/web/src/features/auth/auth.api.ts:1)
- [apps/web/src/features/branches](/D:/Documents/work/capella/HR/apps/web/src/features/branches/branches.api.ts:1)
- [apps/web/src/features/attendance](/D:/Documents/work/capella/HR/apps/web/src/features/attendance/attendance.api.ts:1)
- [apps/web/src/features/employees](/D:/Documents/work/capella/HR/apps/web/src/features/employees/employees.api.ts:1)
- [apps/web/src/features/network](/D:/Documents/work/capella/HR/apps/web/src/features/network/network.api.ts:1)
- [apps/web/src/features/reports](/D:/Documents/work/capella/HR/apps/web/src/features/reports/reports.api.ts:1)

Not yet represented as frontend feature modules in this pass:

- `audit-logs`
- `month-locks`

Interpretation:

- The frontend is still in an early product phase.
- Most of the remaining work is now application/UI work, not core backend enablement.

## Backend Coverage Summary

Status: `Mostly Done`

Registered backend route groups:

- auth
- employees
- branches
- employee-devices
- attendance
- weekly-day-offs
- permission-absences
- reports
- audit-logs
- month-locks
- network

Evidence:

- [apps/api/src/http/routes.ts](/D:/Documents/work/capella/HR/apps/api/src/http/routes.ts:1)

Interpretation:

- The backend already contains most domain surfaces needed for the product.
- Remaining backend work is likely refinement, validation expansion, bug fixing, and contract adjustments rather than brand-new domains.

## What Is Fully Missing

These areas appear missing from the web app as user-facing product capabilities:

- Audit log UI
- Month lock UI

These areas appear missing or not validated in this pass at repo level:

- CI/CD workflow visibility
- Production observability/monitoring assets
- Formal access-control matrix documentation
- E2E browser test suite for the overall user flows
