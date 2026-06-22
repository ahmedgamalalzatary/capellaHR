# HR System Design

Date: 2026-06-22  
Status: Draft approved for planning  
Stack: Next.js, Express.js, MySQL, Drizzle ORM, pnpm

## 1. Product Scope

The system is an Arabic RTL web application for HR administration and employee attendance.

The first version supports:

- One seeded admin account loaded from `.env`.
- Employee accounts created only by the admin.
- Branch creation, setup, viewing, and updating.
- Employee CRUD with soft delete.
- Attendance check-in/check-out with location, IP, and device validation.
- Multiple attendance sessions per employee per day.
- Monthly attendance and absence summaries.
- Arabic RTL PDF exports.
- Audit logging for sensitive admin actions.

Out of scope for v1:

- Employee self-registration.
- Employee profile editing.
- Multiple admins.
- Payroll or salary deduction calculations.
- Leave request workflows from employees.
- Branch deletion.

## 2. Architecture

Use a pnpm monorepo:

```text
apps/
  web/      Next.js Arabic RTL frontend
  api/      Express.js API, auth, uploads, attendance validation
packages/
  shared/   Optional shared types and validation schemas
```

The frontend talks to the Express API over HTTP. The API owns authentication, authorization, uploads, MySQL access, attendance validation, and PDF generation.

MySQL is accessed through Drizzle ORM. Timestamps are stored in UTC and displayed/exported in `Africa/Cairo`.

## 3. Roles And Authentication

### Admin

- Exactly one admin exists in v1.
- The admin is seeded from `.env` during setup.
- Admin sessions last 8 hours.
- Admin can have multiple active sessions.
- Admin can create, view, update, delete/update attendance, manage employees, manage branches, assign days off, mark permission absences, export PDFs, and view audit logs.

### Employee

- Employees are created only by admin.
- Employees log in with Egyptian phone number and password.
- Employee sessions last 12 hours.
- Only one active employee session is allowed at a time.
- Employees can view their own profile and attendance history.
- Employees cannot edit their own data.

Authentication uses HTTP-only cookie sessions.

Passwords should be stored with a secure password hash. Implementation can use a modern password hashing library.

## 4. Employee Model

Employee fields:

- Full name.
- Password hash.
- Primary phone.
- WhatsApp phone.
- Email.
- Personal photo.
- ID front image.
- ID back image.
- Branch assignment.
- Age.
- Address.
- Current monthly salary.
- Soft-delete status.

Rules:

- Full name is a single text field.
- Address is a single text field.
- Age is stored directly as a number with no range validation.
- Email is optional, but unique when provided.
- Primary phone is required, Egyptian mobile format, and unique.
- WhatsApp phone is required, Egyptian mobile format, and unique per employee.
- The same employee may use the same number for primary phone and WhatsApp phone.
- Another employee cannot reuse that number.
- Changing the primary phone changes the employee login credential.
- Updating the password changes the employee login credential.
- Soft-deleted employees cannot log in, but their history remains visible to admins.

Egyptian phone format:

- Normalize accepted formats to `01xxxxxxxxx`.
- Valid prefixes are `010`, `011`, `012`, and `015`.

## 5. Employee Files

Required uploads when creating an employee:

- Personal photo.
- ID front image.
- ID back image.

Allowed file types:

- JPEG.
- PNG.

Maximum file size:

- 10 MB per file.

Storage:

- Files are stored under dedicated folders inside the API application:
  - Personal photos.
  - ID front images.
  - ID back images.
- Old files are kept when an admin replaces an image.
- Files are private and served only through authenticated API routes.

## 6. Salary History

Monthly salary is stored as `DECIMAL(12,2)`.

The employee record stores the current salary. Salary changes are also written to a salary history table with:

- Employee ID.
- Salary amount.
- Effective timestamp.
- Changed by admin.

No salary-change reason field is required.

Monthly reports in v1 show attendance and absence counts only. They do not calculate salary deductions or payable salary.

## 7. Branch Model

Branches can be created, viewed, and updated by admin.

Branches cannot be deleted, either hard delete or soft delete.

Branches do not have an active/inactive status. Every completed branch is assignable to employees.

Branch fields:

- Name.
- Address.
- GPS latitude.
- GPS longitude.
- GPS radius in meters.
- Allowed IP/CIDR.
- Registered branch device token.
- Setup status.

Branch search:

- Search by branch name.

## 8. Branch Setup Flow

Branch creation requires a complete attendance policy and branch device registration.

Flow:

1. Admin creates the branch and its GPS/IP policy.
2. The branch is stored as `setup_pending`.
3. The system generates a one-hour setup link.
4. The setup link is opened on the branch attendance device/browser.
5. The API registers that browser as the branch device.
6. The branch becomes completed and assignable to employees.

Rules:

- Employees cannot be assigned to `setup_pending` branches.
- Admin can regenerate or revoke branch setup links.
- Regeneration and revocation are audit logged.
- Replacing an existing branch device uses the same one-hour registration-link flow.
- During replacement, the old branch device continues working until the new device is successfully registered.
- After successful replacement, the old branch device stops working.

## 9. Employee Device Model

Each employee may have:

- One optional registered personal phone/browser device.
- Access to the registered branch device of their assigned branch.

Rules:

- Personal device registration is admin-only.
- Registration uses a one-hour setup link opened on the employee phone/browser.
- Admin can regenerate or revoke employee device setup links.
- Employee personal device setup actions are audit logged.
- Employee personal device is optional because some employees may only use the branch device.
- Replacing the personal device invalidates the old device after successful new registration.

Attendance is allowed from either:

- The employee's registered personal device.
- The registered device for the employee's assigned branch.

## 10. Branch Assignment History

Employee branch assignments are historical.

Rules:

- Store branch assignment history with effective dates.
- Branch changes can be effective now or in the future only.
- Past effective dates are not allowed.
- If an employee has an open attendance session, a branch change applies after the open session is closed.
- Monthly reports use the historical branch for each date/event, not only the current branch.

## 11. Attendance

Employees can record multiple attendance sessions per day.

Session rules:

- Strict alternation is required.
- An employee cannot check in again while they have an open session.
- An employee cannot check out unless they have an open session.
- Multiple sessions on the same date count as one attended day for monthly absence calculations.
- Only completed sessions count as attended days in finalized monthly reports.
- Open sessions show current/in-progress state, but do not count as attended after month locking unless completed or corrected by admin.
- Overnight sessions are not supported in v1. Check-in and check-out must be on the same `Africa/Cairo` calendar date.

Attendance states:

- `open`.
- `completed`.
- `blocked_attempt`.

Blocked attempts:

- Stored when attendance validation fails.
- Include attempted action: `check_in` or `check_out`.
- Include failure reason or reasons.
- Include GPS latitude/longitude.
- Include IP address.
- Include device ID.
- Include branch policy snapshot.
- Do not count as attended days.

## 12. Attendance Validation

Accepted employee attendance requires all checks to pass:

- Allowed device check.
- Branch GPS radius check.
- Branch Wi-Fi/IP check.

If one check is missing or fails, attendance is blocked and saved as a `blocked_attempt`.

Employees must be connected to the branch Wi-Fi/network because the branch IP/CIDR rule is required.

Check-in captures:

- GPS latitude/longitude.
- IP address.
- Device ID.
- Matched branch ID.
- Matched branch policy snapshot.
- UTC timestamp.

Check-out validates against the same branch policy snapshot captured at check-in.

Branch policy updates affect future attendance only. Existing attendance records keep their captured evidence and policy snapshot.

If a future date is marked as weekly off or permission absence, employee attendance on that date is blocked and saved as a flagged blocked attempt.

## 13. Admin Attendance Management

Admin can:

- View attendance.
- Filter attendance.
- Sort attendance.
- Search attendance.
- Create attendance.
- Update attendance.
- Delete attendance.

Admin-created or admin-updated attendance bypasses employee GPS/IP/device validation.

Reason is required for admin attendance create/update/delete actions.

Attendance delete is a hard delete in v1.

If admin tries to create or update attendance on a date that conflicts with an existing day-off or permission absence, the action is blocked and the admin is notified.

All admin attendance mutations are audit logged with before/after data.

## 14. Weekly Days Off

The branch operates 7 days per week.

Employees are rotational and get one weekly day off.

Week definition:

- Saturday to Friday.

Rules:

- Admin assigns each employee's weekly day off before the week.
- Admin can edit the assigned day during the week.
- If an employee does not get their assigned day off, admin can mark the actual day off later.
- By default, an employee can have only one weekly day off per week.
- Admin can override and assign more than one day off in a week.
- Override requires a reason.
- Day-off assignments and overrides are audit logged.

Admin screens should support:

- Individual employee day-off assignment.
- Bulk weekly scheduling for all employees.

## 15. Permission Absence

Permission absence is created only by admin.

Rules:

- Generic permission type only.
- Full-day only.
- No employee request workflow in v1.
- Past-date editing is allowed with audit logging.

No detailed categories such as sick, emergency, vacation, or unpaid are included in v1.

## 16. Absence Calculation

Absence is calculated monthly from calendar days.

Definitions:

- Attendance day: any date with at least one completed attendance session.
- Weekly day off: date assigned by admin as the employee's weekly off day.
- Absence with permission: full-day permission absence marked by admin.
- Absence without permission: expected work date with no attendance, no weekly day off, and no permission.

Monthly summary columns:

- Attendance days.
- Weekly days off.
- Absence with permission.
- Absence without permission.

Formula:

```text
month calendar days
- distinct completed attendance days
- weekly days off
- permission absence days
= absence without permission
```

Conflict rule:

- A date cannot have both attendance and day-off/permission classification.
- Conflicts are prevented by default.
- If a date is already marked as weekly off or permission, employee attendance is blocked and saved as a blocked attempt.

## 17. Monthly Locking

Each month is locked when the month is done.

Rules:

- Locked months cannot be changed by normal attendance, day-off, or permission edits.
- Monthly summaries for locked months remain stable.
- Completed attendance sessions are the only sessions counted as attended in locked monthly reports.
- Open sessions from a locked month must be resolved before locking or handled by an explicit admin correction process.

## 18. Admin Lists And Search

Employee list:

- Server-side pagination.
- Search by employee name only.
- Filter by branch.
- Filter by status: active or soft-deleted.

Branch list:

- Server-side pagination.
- Search by branch name.

Attendance list:

- Server-side pagination.
- Date range filter.
- Employee name search.
- Branch filter.
- Status filter.
- Sort by date/time.
- Sort by employee name.

Audit log list:

- Server-side pagination.
- Read-only admin page.
- Entity/name search only.
- Filters for entity type, action, and date range.

## 19. Employee UI

Employee home screen:

- Current attendance action.
- Today's sessions.
- Profile shortcut.

Employee profile:

- Read-only.

Employee attendance history:

- Paginated all records.
- No employee date-range filter in v1.

## 20. PDF Exports

PDF exports are Arabic RTL.

Supported exports:

- Current filtered employee list.
- Current filtered raw attendance list.
- Monthly attendance/absence summary.

Exports use the current filtered/sorted view where applicable.

No Excel or CSV exports are included in v1.

## 21. Audit Logging

Audit logs record sensitive admin actions.

Log fields should include:

- Admin ID.
- Action type.
- Entity type.
- Entity ID.
- Entity display name where available.
- Timestamp.
- Before JSON.
- After JSON.
- Reason where required.

Audit-required actions include:

- Employee create/update/soft-delete.
- Branch create/update/setup-link actions/device replacement.
- Attendance create/update/delete.
- Salary changes.
- Weekly day-off assignment and override.
- Permission absence changes.
- Employee device registration/replacement/revocation.

Reasons are required for:

- Admin attendance create/update/delete.
- Weekly day-off override beyond one day per Saturday-Friday week.

## 22. Error Handling

API errors should return consistent JSON:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable Arabic message",
    "details": {}
  }
}
```

Important error cases:

- Invalid Egyptian phone format.
- Duplicate phone/WhatsApp/email.
- Missing required employee files.
- File too large or invalid file type.
- Branch still setup pending.
- Expired setup link.
- Attendance validation failed.
- Attendance action out of order.
- Overnight attendance session attempted.
- Date conflict with day off or permission absence.
- Attempted edit inside a locked month.
- Unauthorized or expired session.

## 23. Testing Strategy

Backend tests should cover:

- Egyptian phone normalization and uniqueness.
- Employee CRUD and soft delete behavior.
- Branch setup link expiry and device registration.
- Employee device registration and replacement.
- Attendance validation success and blocked attempts.
- Strict attendance session alternation.
- Rejection of overnight attendance sessions.
- Monthly absence calculations.
- Monthly lock behavior.
- Day-off override rule and required reason.
- Admin attendance mutation audit logs.

Frontend tests should cover:

- Admin employee forms.
- Branch setup flow.
- Attendance check-in/check-out states.
- Employee read-only profile/history.
- PDF export triggers.

## 24. Device Token Recovery

If a browser/device token is lost because browser storage is cleared, the device is no longer trusted.

Recovery is admin-controlled:

- Admin generates a new one-hour setup link.
- The setup link is opened on the replacement browser/device.
- The new device token is registered.
- The old/lost token is no longer accepted.

Employees cannot self-reactivate lost devices.

## 25. Data Retention

Private uploaded files are retained indefinitely unless a later manual archive policy is created.

This includes:

- Personal photos.
- ID front images.
- ID back images.
- Replaced historical files.

## 26. Setup Link Security

Setup links are:

- Valid for one hour.
- Single-use.
- Revocable by admin.
- Replaced when admin regenerates a new setup link.

## 27. Open Assumptions

The following decisions were not finalized and should be confirmed before implementation if they become relevant:

- Exact admin seed variable names in `.env`.
- Exact GPS radius default value.
- Exact PDF visual layout.
- Whether audit logs can ever be deleted or retained forever.
- Exact month-lock mechanism: automatic job, manual admin button, or both.
