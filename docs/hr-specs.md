# Capella HR System Specification

## Document status

This is the living product specification for the Capella HR system. Modules are discussed and approved individually. A module marked **Locked** reflects the agreed requirements unless a later cross-module decision requires an explicitly approved revision.

## Product scope

The system manages one company with multiple branches. Its planned functional areas are login and identity, branches, employees, shifts, attendance and absence, salaries, deductions, bonuses, advances, reports and selective exports, and role-based admin/employee access.

## Global interface requirements — Locked

- The entire website uses Arabic language and right-to-left layout.
- Dates, times, numbers, monetary values, tables, navigation, forms, statuses, and validation messages must render correctly in RTL context.
- All calendar/time behavior remains based on `Africa/Cairo`.
- Every admin module/page provides search when its records have searchable fields.
- Every admin list provides relevant default filters, such as branch, employee, status, date range, payroll month, or device type.
- Search and filters work together, and a reset action returns filters to their default state.
- Empty filtered/search results display a clear Arabic empty-state message.

## Visual design boundary — Deferred

- Visual and interaction design will be completed later by another AI.
- This specification does not select navigation layout, colors, typography, component appearance, spacing, responsive breakpoints, or other aesthetic/UI-system choices.
- The later visual design must preserve all locked Arabic/RTL, functional, authorization, validation, and workflow requirements in this document.

## 1. Login and identity — Locked

### Actors and account creation

- The system has exactly one admin account.
- No public registration or employee self-registration exists.
- The admin creates and manages all employee accounts and credentials.

### Admin authentication

- The admin email and a precomputed password hash are stored in server-only environment variables.
- The submitted password is checked against the configured hash; a plaintext admin password must never be stored.
- No admin database table or additional admin accounts exist.
- Changing admin credentials requires changing the server environment and restarting the API.
- A successful login creates a secure HTTP-only cookie session.
- Admin sessions remain valid until explicit logout.
- Multiple concurrent admin sessions are allowed and do not invalidate one another.
- Audit records identify admin actions as actions by the single system admin.

### Employee PIN

- Every employee has an exactly four-digit numeric PIN.
- PINs are stored only as secure hashes.
- Only the admin can set or reset a PIN.
- An existing PIN cannot be retrieved or displayed after it is stored.
- Resetting a PIN immediately invalidates all active self-service sessions for that employee.
- Authentication failures never temporarily or permanently lock a PIN.

### Employee self-service authentication

- Starting a self-service session requires the employee code, four-digit PIN, personal phone number, and proof from the employee's currently registered personal device.
- The employee must have an active attendance check-in session.
- A new self-service session can be created only from the employee's registered personal phone.
- If the admin later revokes that device, the already-active session follows the explicit Devices exception and remains available until attendance check-out; no new session may be created.
- Access ends immediately and automatically when the attendance session is checked out, including an admin-forced check-out.

### Personal-device registration and verification

- Each employee may have exactly one registered personal device at a time.
- Initial registration and replacement require admin approval.
- Registering a replacement immediately revokes the previous device and its credential.
- During registration, the phone creates a device-bound WebAuthn credential.
- The server stores the public credential identifier against the employee; private credential material remains on the phone.
- Personal-phone attendance verification requires the employee PIN, valid GPS location, and proof from the registered WebAuthn credential.
- The phone may satisfy WebAuthn user verification using Face ID, fingerprint, or its secure device passcode.
- Clearing the browser's site data, losing the credential, or replacing the phone requires admin-approved re-registration.

### Shared branch-phone identity verification

- A branch has one registered shared branch phone.
- An employee using the shared phone provides their employee code and four-digit PIN.
- The attempt must originate within the permitted GPS range of the employee's assigned branch.
- The shared phone uses camera-based facial recognition to verify that the person matches the claimed employee.
- Face enrollment is supervised by the admin and captures multiple angles with liveness checks.
- The face-recognition template is separate from the employee profile photo and ID-card images.

### Failed and suspicious attempts

- Authentication and attendance-verification attempts are unlimited.
- Failed PIN, device, GPS, liveness, and face-match attempts are recorded and flagged.
- Flagged attempts retain the employee or claimed employee, timestamp, device, location, and failure reason when available.
- Failed attempts never cause a temporary or permanent automatic block.
- A failed factor does not create a successful login or attendance record.

## 2. Branches — Locked

### Company and branch model

- The system manages one company with multiple branches.
- A branch contains a name, text location/address, GPS latitude, GPS longitude, detected GPS accuracy, and an allowed attendance radius measured in meters.
- Branch name and text location/address are required.
- Branch names are unique across the company after trimming surrounding whitespace and comparing without letter-case sensitivity.
- Branches have no active, inactive, or archived state.

### GPS setup

- The admin must grant browser location access while creating a branch.
- The system automatically detects the admin device's current latitude and longitude; manual coordinate entry and map-pin selection are excluded.
- The admin is expected to be physically present at the branch during setup.
- The setup screen displays the detected coordinates and the GPS accuracy reported by the device.
- The admin must explicitly confirm the reading or retry detection before saving.
- Branch creation cannot complete if location permission is denied or coordinates cannot be detected.

### Attendance radius

- Each branch has its own admin-configured attendance radius.
- The radius is entered in meters and must be greater than zero.
- The system imposes no minimum or maximum beyond the positive-value requirement.

### Branch operations

- The admin can create, list, view, and edit branches.
- Editing GPS coordinates or the attendance radius affects only future attendance attempts.
- Historical attendance attempts retain the branch coordinates, detected employee coordinates, measured distance, configured radius, and evaluation used at the time of the attempt.
- A branch can be permanently deleted only while no employee, shift, attendance, payroll, or other related record has ever referenced it.
- After the first reference, branch deletion is permanently unavailable even if all employees are later reassigned.
- The system does not provide branch deactivation or archival as an alternative to deletion.

### Device boundary

- Shared branch-phone registration is not part of the Branches module.
- A branch may be created without a paired phone.
- Branch-phone registration, replacement, and revocation belong to the separate Devices module.

## 3. Employees — Locked

### Employee identity

- Each employee has a hidden internal database identifier and a separate visible employee code.
- Employee codes are company-wide incremental positive integers: `1`, `2`, `3`, and so on.
- Seeded legacy employees retain their existing employee codes.
- After seeding, the next employee receives the next integer after the highest existing code.
- Code allocation must be atomic so concurrent creation cannot issue the same code twice.
- Employee codes are immutable and are never reused, including after employee deletion.
- Employee codes are used in login, attendance, administration, imports, exports, and reports.

### Required fields

Every employee field is required at creation:

- Full name
- Personal phone number
- WhatsApp number
- Four-digit employee PIN
- Age
- Address
- Branch assignment
- Shift assignment
- Monthly base salary
- Personal photo
- ID-card front image
- ID-card back image

Device registration and live facial enrollment are separate post-creation workflows and are not employee-creation fields.

### Name, age, and address

- The employee name is stored in one required full-name text field.
- The system stores a manually entered age rather than a date of birth.
- Age is required and must be a positive whole number greater than zero.
- Address is required plain text.

### Phone and WhatsApp numbers

- Personal phone and WhatsApp numbers use normalized Egyptian mobile format.
- A normalized number contains exactly 11 digits, contains no spaces or separators, and begins with `010`, `011`, `012`, or `015`.
- The same employee may use the same number for both personal phone and WhatsApp.
- A current number cannot belong to two different employees across either phone field.
- If the admin edits a number away from an active employee, that old number becomes available for reuse provided no current or deleted employee still uses it.
- The current personal and WhatsApp numbers of a soft-deleted employee remain permanently reserved.
- Changing a personal phone number does not invalidate an already active employee self-service session; future authentication requires the new number.

### Branch and shift assignments

- Every employee must belong to exactly one branch at creation.
- An employee cannot be created without a branch or belong to multiple branches.
- Branch assignment is permanent and cannot be edited after creation.
- A shift assignment is required at creation.
- The admin may change the shift assignment; the timing and attendance effects of that change are defined by the Shifts module.

### Employee images

- Personal photo, ID-front image, and ID-back image are all required at creation.
- Each file must be a recognized image format and must not exceed 16 MB.
- Validation checks actual file content/MIME type rather than trusting only the filename extension.
- Files are stored privately under `apps/api/uploads`.
- MySQL stores file metadata and a relative storage path rather than the image binary.
- Uploads are excluded from version control and are not exposed as a public static directory.
- Authorized API endpoints serve protected employee images.
- The system generates safe unique storage filenames.
- Replacing an image deletes the old file only after the replacement has been stored successfully.
- Soft-deleted employees retain their current image files as part of the preserved record.

### Editing

- The admin may edit full name, personal phone, WhatsApp number, PIN, age, address, shift assignment, personal photo, ID-front image, and ID-back image.
- Employee code and branch assignment are not editable.
- PIN changes follow the session-revocation rules in Login and identity.

### Face enrollment

- Admin-supervised live face enrollment is a separate step after employee creation.
- A created but unenrolled employee cannot use facial recognition on the shared branch phone.
- The enrollment template remains separate from personal and ID images.

### Employee deletion

- Employee deletion is always a soft delete; the database record and related history remain.
- A checked-in employee must be checked out before deletion is allowed.
- Deleted employees disappear from normal employee-management lists and searches.
- There is no deleted-employees screen, restore operation, or employee reactivation.
- Deleted employees cannot authenticate, check in, or use self-service.
- Historical attendance and payroll reports continue to display the deleted employee's code and name.

## 4. Devices — Locked

### Scope and assignments

- The Devices module owns registration, pairing, replacement, revocation, status, and device history.
- Login, attendance, employees, and branches consume device status but do not manage credential lifecycle.
- Each employee may have at most one active registered personal phone.
- Each branch may have at most one active registered shared branch phone.
- One registered browser profile may have only one assignment and purpose: one employee or one branch.
- A device cannot be transferred between employees, between branches, or between employee and branch roles.

### Pairing flow

- The admin initiates pairing from the relevant employee or branch record.
- Pairing generates a QR code/link that is active, single-use, and scoped to that assignment.
- A pairing request has no automatic time expiry; it remains valid until used, cancelled, or superseded.
- Each employee or branch may have only one active pairing request.
- Creating a new request cancels the existing pending request.
- Successful completion consumes the request and activates the device automatically; no second admin approval is required.
- Pairing creates a device-bound WebAuthn credential and a local installation marker.
- Private credential material remains on the device.

### Replacement

- During replacement, the existing device remains active while the new pairing is pending.
- When the replacement pairs successfully, the old device is revoked immediately.
- A cancelled or failed replacement leaves the existing device active.

### Removal and revocation

- Removing a device revokes it and permanently retains its record in device history.
- Device records are never hard-deleted.
- Revoked credentials cannot be reactivated.
- Reusing the same phone after revocation requires a fresh admin-initiated pairing and a new credential.
- Revocation does not require the admin to enter a reason or note.
- Revoking an employee device prevents future device verification and future self-service logins.
- An employee self-service session that was already active before revocation remains available until attendance check-out.
- Revoking a branch phone immediately prevents new attendance attempts from that phone.
- Soft-deleting an employee revokes their active device and cancels any pending pairing request.

### Admin device view

- The admin can view assigned employee or branch, device type, current status, paired time, last-used time, revoked time, and browser/platform information.
- The UI does not expose credential identifiers, private credential material, raw tokens, or other secrets.
- Devices do not have admin-defined friendly labels.

### Connectivity and web-platform constraints

- Pairing, verification, attendance, and employee self-service require an online API connection.
- No offline device access, queued offline attendance, or later synchronization is supported.
- The product remains web-only; a native mobile application is excluded.
- Browsers do not expose a permanent hardware identifier. Uniqueness is therefore enforced at the browser-profile level through the WebAuthn credential and local installation marker.
- Clearing browser/site data, losing the credential, or changing browser profiles may make the same physical phone appear new, but it does not grant access; a fresh admin-initiated pairing is required.

## 5. Shifts — Locked

### Shift model

- A shift is an employee-specific required work duration, not a reusable named template.
- Every employee must have exactly one shift-duration assignment.
- Multiple employees may independently have the same duration.
- A shift has no name, scheduled start time, scheduled end time, late-arrival rule, or early-arrival rule.
- The admin assigns the initial duration during employee creation.

### Duration rules

- Duration is entered in hours and minutes and stored with minute precision.
- The minimum duration is 1 minute.
- The maximum duration is 12 hours inclusive.
- Worked duration is measured in whole completed minutes; seconds are ignored.
- There is no grace period.
- Worked minutes greater than required minutes produce the difference as overtime minutes.
- Worked minutes less than required minutes produce the difference as deduction minutes.
- Equal worked and required minutes produce neither overtime nor deduction.
- Monetary treatment of overtime and shortfall is defined by the payroll-related modules.

### Shift operations

- The Shifts area lists and views employee-duration assignments.
- The admin edits one employee's duration at a time.
- Bulk shift assignment and bulk shift updates are excluded.
- A shift assignment cannot be deleted independently because every employee must always have one.
- Soft-deleting the employee removes the assignment from normal administration while preserving attendance history.

### Changes and active attendance

- Editing a duration retains only the new current value; there is no separate shift-change history.
- If the employee has an active attendance session, that session retains the required-duration snapshot captured at check-in.
- The changed duration applies beginning with the employee's next check-in.
- Completed attendance records retain the required duration used for their own calculation.

### Cross-module attendance rules

- Each employee may have only one attendance check-in/session per workday.
- Cross-midnight workday boundaries and session behavior are defined in the Attendance and absence module.
- Expected working days and automatic absence detection are defined by the Weekly Day-Off module.

## 6. Weekly Day-Off — Locked

### Retrospective day-off model

- Weekly days off are recorded retrospectively and are never scheduled in advance.
- A date without an attendance session first becomes an absence after the Cairo calendar day ends.
- The admin may contact the employee and convert that past absence into a weekly day off.
- Current and future dates cannot be marked as days off.
- Only an absence with no attendance session can be converted.
- The admin may convert any eligible past absence, with no historical time limit.

### Rolling seven-day rule

- Day-off dates for the same employee must be at least seven calendar days apart.
- A selected day off plus the following six consecutive calendar days form the rolling seven-day cycle.
- The cycle is anchored to the selected day off rather than a fixed calendar week or weekday.
- An employee may go longer than seven days without a recorded day off.
- Working every day does not create an overdue-day-off warning.

### Corrections

- The admin may convert a day off back into an absence.
- After correction, the admin may select another eligible past absence if the rolling spacing rule remains satisfied.
- Converting an absence to a day off preserves the original absence and its required-shift snapshot internally.
- Converting the day off back restores the original absence duration exactly, rather than using the employee's current shift.

### Absence lifecycle boundaries

- Absence tracking begins on the Cairo calendar day after employee creation.
- The employee's creation date never becomes an automatic absence.
- Absence generation stops after employee soft deletion.
- The API is assumed to remain continuously online; missed-midnight backfill behavior is excluded.

### Payroll effect

- A day off represents an excused non-working day.
- It has zero worked minutes and zero required minutes.
- It creates no absence deduction, overtime, or credited work time.
- Payroll-period locking and the effect of later corrections are defined in the payroll-related modules.

### Cross-module cross-midnight rule

- Allocation of attendance sessions that cross Cairo midnight is defined by the Attendance and absence module.

## 7. Attendance and Absence — Locked

### Attendance-session boundaries

- All attendance date/time decisions use `Africa/Cairo`.
- A session belongs entirely to its Cairo check-in date, including when check-out occurs after midnight.
- Cross-midnight worked minutes are not split between dates.
- Each employee may have at most one attendance session for a Cairo check-in date.
- Each employee may have at most one open session at a time.
- A new check-in is denied while another session remains open.
- After a previous-date session closes, the employee may start a new session on the current date if no session already belongs to that check-in date.
- Duplicate and concurrent submissions must be handled atomically so they cannot create multiple sessions.

### Employee check-in and check-out

- Employees may use either their registered personal phone or their assigned branch's registered shared phone.
- Check-in and check-out do not have to use the same device type.
- Every employee-originated check-in and check-out requires successful GPS validation.
- The measured position must be within or exactly on the configured radius of the employee's permanently assigned branch.
- Attendance from another branch's shared phone or GPS area is not allowed.
- Each event stores its source, device, timestamp, coordinates when available, reported GPS accuracy, calculated distance, branch coordinates, and radius snapshot.
- Personal-phone verification requires the four-digit PIN, assigned-branch GPS validation, and proof from the registered WebAuthn credential.
- Branch-phone verification requires employee code, four-digit PIN, assigned-branch GPS validation, liveness, and face match.
- Raw face images captured during attendance attempts are discarded and never stored.
- Face-match/liveness results and operational metadata are retained.

### Manual admin events

- The admin attendance screen provides separate Check-in and Check-out actions/tabs.
- The admin explicitly chooses which event to record.
- Admin manual events bypass employee PIN, GPS, device, liveness, and face verification.
- Such events use source `admin_manual`.
- Manual event timestamps may be in the past or present but never in the future.
- Manual check-out requires an existing open session and must be after its check-in.
- Standalone check-out records are not allowed.
- Creating backdated manual attendance automatically replaces an existing automatic absence while preserving the correction in audit history.
- Manual attendance cannot overwrite a weekly day off. The admin must first convert the day off back to absence.
- An open session created through manual check-in grants employee self-service access under the normal registered-device rules.

### Denied and flagged attempts

- Every failed attendance attempt is recorded as denied and is visible to the admin.
- Security-relevant failures are additionally flagged, including wrong PIN, unrecognized or revoked device, face mismatch, liveness failure, and out-of-range GPS.
- Ordinary technical failures may remain denied without the additional suspicious flag.
- A denied attempt retains event type, claimed employee when known, timestamp, device/source, coordinates and distance when available, recognition/liveness result when applicable, and failure reason.
- Attempts remain unlimited and do not automatically block an employee.
- The admin may approve any denied attempt as a manual override.
- Approval preserves the original denied attempt and creates the attempted check-in or check-out at its original timestamp.
- The resulting event records that it came from an admin-approved denied attempt.
- Only one denied check-in may be approved for an employee on a given Cairo check-in date.
- Approved check-out requires the employee's existing open session.
- Approval cannot create a second session or overwrite a weekly day off.
- An open session produced by an approved denied check-in grants employee self-service access.

### Automatic timeout

- An open session automatically checks out exactly 16 hours after check-in.
- The generated event uses source `automatic_timeout` and flags the session.
- Worked, overtime, and deduction minutes initially use the full 16-hour duration.
- If a newly created manual or approved check-in is already more than 16 hours old, the system immediately creates its automatic check-out at `check-in + 16 hours` and flags it.
- The admin may correct the time/duration of a system-generated automatic check-out.
- A corrected check-out must remain after check-in and cannot be in the future.
- Correction recalculates worked, overtime, and deduction minutes.
- The original automatic value and correction remain in audit history.
- Employee-originated events, admin-manual events, and approved-denial events are read-only after creation.

### Duration calculation

- Worked duration uses whole completed minutes; seconds are ignored.
- The required duration is the employee-shift snapshot captured at check-in.
- Worked minutes greater than required minutes create overtime minutes equal to the difference.
- Worked minutes less than required minutes create deduction minutes equal to the difference.
- Equal values create neither overtime nor deduction minutes.
- Converting these minutes to money is defined by payroll-related modules.

### Automatic absence

- During an open Cairo date, employees without a current-date session appear as `not checked in yet`; this is not an official absence.
- The dashboard distinguishes checked in, checked out, active previous-day session, and not checked in yet.
- If no attendance session belongs to an expected date, an absence is generated only after that Cairo date ends.
- The admin cannot manually create an absence before the date ends.
- Absence deduction minutes equal the employee's full shift-duration snapshot for that date.
- Backdated attendance converts the absence to attendance as described above.
- Weekly day-off conversion follows the separate Weekly Day-Off rules.
- No public-holiday or company-holiday exemption exists.

### Immutability and self-service

- Attendance sessions cannot be hard- or soft-deleted.
- Only the correction of a system-generated automatic check-out is permitted after creation.
- Any valid open attendance session satisfies the checked-in requirement for employee self-service.
- Employee, admin-manual, and approved-denial check-ins are treated equally for that requirement.
- Employee self-service ends immediately upon employee check-out, admin check-out, approved check-out, or automatic timeout.

## 8. Salaries — Locked

### Base salary

- Every employee requires a monthly base salary during employee creation.
- Currency is fixed to Egyptian pounds (EGP).
- Monetary values support two decimal places.
- Base salary must be greater than EGP 0.00.
- Base salary cannot be deleted; the admin may view and update it.
- Payroll periods follow Cairo calendar months.

### Base-salary changes

- Changing base salary applies the new amount to the employee's entire current calendar month and future months.
- There is no old/new salary proration within the current month.
- When a month ends, it retains its month-end base-salary snapshot even if payroll is not yet finalized.
- A later salary change does not recalculate an ended or finalized month.

### Employment-period proration

- Mid-month employment uses required-workday proration.
- `prorated base = monthly base × eligible workdays ÷ full-month workdays`.
- Full-month workdays are all Cairo dates in the month except the employee's recorded weekly days off.
- Eligible workdays begin after employee creation.
- The creation date is eligible only when the employee attends that date; if not attended, it creates no absence or deduction.
- The deletion date is eligible only when attended.
- Dates after soft deletion are excluded.
- An attended creation or deletion date is treated as a normal shift day: regular time up to the required duration and overtime beyond it.

### Required minutes and attendance rate

- Monthly required minutes are the sum of each eligible date's stored required-shift snapshot.
- When a shift changes within a month, earlier dates retain their old requirement and later dates use the new requirement.
- For a stable shift, the per-minute rate is equivalent to `salary amount ÷ (days required to work × shift duration in minutes)`.
- The exact payroll rate is `per-minute rate = prorated base ÷ summed required minutes for eligible workdays`.
- This summed-minutes formula handles shift changes by using each date's snapshot.
- If an employee-month has zero eligible workdays, prorated base and attendance-derived amounts are EGP 0.00; bonuses, deductions, advances, and prior negative carry may still affect net salary without performing a division by zero.
- One overtime minute, one regular minute, and one deduction minute use the same 1× per-minute rate.
- Regular required work is included in base salary; overtime adds value and shortage/absence subtracts value.

### Provisional net formula

`net salary = prorated base + overtime + bonuses - attendance shortage/absence - deductions - advances + prior negative carry`

- Bonus, deduction, and advance behavior is defined in their separate modules.
- Calculations retain high precision internally.
- Each final payroll component is rounded to two decimal places.
- Net salary may be negative.
- A finalized negative amount carries forward to the same employee's next month and is subtracted there.
- A carried balance is never transferred to another employee.

### Payroll finalization

- An employee-month remains open until the admin finalizes it.
- Finalization is available only after the Cairo calendar month has ended.
- The admin may finalize one employee-month or all employee-months in one selected branch.
- Branch-wide finalization is atomic: if any employee is blocked, nobody in that branch is finalized.
- The UI lists all employees blocking a branch finalization.
- Payroll months must be finalized chronologically per employee.
- A newer employee-month cannot be finalized while any older employee-month remains unfinalized.
- Branch-wide finalization applies the same chronological validation to every employee in the branch.
- Every attendance session belonging to the employee-month must be closed before finalization.
- The admin must approve any valid denied attendance attempts before finalization.
- Finalization permanently prevents later approval of denied attempts from that employee-month.
- Finalization financially locks all salary, attendance, weekly day-off, bonus, deduction, and advance inputs affecting that employee-month.
- Finalization is permanent and cannot be reopened.

### Payment boundary

- The system calculates, previews, and finalizes payroll.
- Actual salary payment status and payment dates are outside the current scope.

## 9. Bonuses — Locked

### Bonus model

- A bonus is a fixed EGP amount with two decimal places.
- Bonus amount must be greater than EGP 0.00.
- A bonus has no reason, title, or description field.
- The admin assigns each bonus to exactly one employee and one target payroll month.
- One employee may have multiple bonus records in the same month.
- Payroll sums all eligible bonus records for that employee-month.
- Bonuses are created one employee at a time; bulk creation is excluded.

### Eligible payroll months

- A bonus may target the current Cairo calendar month.
- A bonus may target a past month only while that employee-month remains unfinalized.
- Future months cannot receive bonuses.
- Finalized employee-months cannot receive bonuses.

### Editing and deletion

- Before finalization, the admin may edit or delete a bonus.
- The assigned employee is immutable after creation.
- The admin may edit the amount and target month.
- A changed target month must satisfy the same current/past-unfinalized eligibility rules.
- Create, edit, and delete actions remain in audit history.
- Payroll finalization permanently locks included bonus records.

### Employee-deletion behavior

- No new bonus may be created after an employee is soft-deleted.
- Existing bonuses remain included in payroll after deletion.
- Existing bonuses become read-only immediately after employee deletion.
- Employee deletion does not remove or recalculate existing bonuses.

### Attendance boundary

- Attendance overtime remains a separate calculated payroll component.
- Overtime does not create a Bonus-module record automatically.

## 10. Deductions — Locked

### Deduction model

- A manual deduction mirrors the Bonus-module model but subtracts from payroll.
- A deduction is entered as a positive fixed EGP amount with two decimal places.
- Deduction amount must be greater than EGP 0.00.
- A deduction has no reason, title, or description field.
- The admin assigns each deduction to exactly one employee and one target payroll month.
- One employee may have multiple manual deduction records in the same month.
- Payroll sums all eligible manual deductions for that employee-month and subtracts the sum.
- Deductions are created one employee at a time; bulk creation is excluded.

### Eligible payroll months

- A deduction may target the current Cairo calendar month.
- A deduction may target a past month only while that employee-month remains unfinalized.
- Future months cannot receive deductions.
- Finalized employee-months cannot receive deductions.

### Editing and deletion

- Before finalization, the admin may edit or delete a deduction.
- The assigned employee is immutable after creation.
- The admin may edit the amount and target month.
- A changed target month must satisfy the same current/past-unfinalized eligibility rules.
- Create, edit, and delete actions remain in audit history.
- Payroll finalization permanently locks included deduction records.

### Employee-deletion behavior

- No new deduction may be created after an employee is soft-deleted.
- Existing deductions remain included in payroll after deletion.
- Existing deductions become read-only immediately after employee deletion.
- Employee deletion does not remove or recalculate existing deductions.

### Attendance boundary

- Manual deductions remain separate from calculated attendance-shortage and absence deductions.
- Attendance shortfall does not create a Deductions-module record automatically.

## 11. Advances — Locked

### Advance model

- Creating an advance means the money has already been given to the employee.
- No pending, paid, cancelled, or other disbursement status exists.
- An advance is a fixed EGP amount with two decimal places and must be greater than EGP 0.00.
- The admin assigns one employee, full amount, installment count, and starting payroll month.
- Advances have no reason, title, or description.
- Advances are created one employee at a time; bulk creation is excluded.
- An employee may have multiple active advances with installments in the same month.
- Payroll sums all installments belonging to an employee-month.

### Installment schedule

- Admin chooses whether the advance is one-time or split by selecting an installment count from 1 through 4.
- A one-time advance is represented by one installment.
- The system divides the full amount into equal consecutive monthly installments.
- Installments cannot contain month gaps.
- Every installment uses two decimal places.
- The final installment absorbs any rounding remainder so the installment sum exactly equals the full amount.
- The starting month may be the current month, a future month, or a past unfinalized month.
- A past start month is rejected if the relevant employee-month is finalized.

### Editing and deletion

- Before any installment is included in finalized payroll, the admin may edit or delete the advance.
- The assigned employee is immutable and an advance can never be transferred.
- Before lock, the admin may edit full amount, installment count, and starting month.
- Editing regenerates the complete installment schedule.
- Create, edit, schedule-regeneration, and delete actions remain in audit history.
- Once any installment is finalized, the entire advance and every remaining installment become permanently read-only.

### Employee-deletion behavior

- No new advance may be created for a soft-deleted employee.
- When an employee is soft-deleted, the entire remaining advance balance moves into that employee's final unfinalized payroll.
- Accelerating the remaining balance may produce a negative final net salary.
- Existing advance and installment history remains preserved.

## 12. Reports and Exports — Locked

### Report scope and tabs

- Reports exist for employee/workforce tracking rather than authentication tracking.
- Each business area has its own report tab: Branches, Employees, Devices, Shifts, Weekly Day-Off, Attendance and Absence, Salaries, Bonuses, Deductions, and Advances.
- Login activity and admin-session activity are excluded.
- Denied and flagged attendance attempts are excluded from Reports and PDF exports; they remain operational admin data in Attendance.
- Reports are read-only and cannot mutate source records.

### Language and presentation

- On-screen reports and PDFs use Arabic and right-to-left layout.
- PDF generation embeds an Arabic-capable font rather than relying on a client device font.
- Each tab has a fixed complete field set; admins cannot select or omit columns.
- Each tab shows detailed rows plus totals and summaries relevant to that module.
- Employee reports exclude personal photo, ID-front image, ID-back image, PINs, credential data, and all secrets.
- Non-secret employee text data may be included where relevant.
- Salary reports include both open payroll previews and finalized payroll and label the status clearly.
- Soft-deleted employees appear when relevant to the selected period and are labeled as deleted.

### Filtering and selection

- Employee-related report tabs support relevant date or payroll-month ranges.
- Date/month ranges have no maximum length.
- The admin can filter by branch, search for employees, and select one employee, several employees, or all employees in the filtered result.
- `Select all` applies to the currently filtered result set.
- On-screen results and export content contain only the selected records and period.
- Non-employee tabs expose equivalent selectors appropriate to their records, such as selected branches or device assignment/type/status.

### Export format

- Supported output is on-screen view and PDF only.
- Excel and CSV export are excluded.
- Exporting multiple employees or records creates one combined PDF.
- Each PDF belongs to exactly one report tab.
- A PDF cannot combine multiple report tabs.
- A generated PDF is an immutable snapshot of source data at generation time.

### Background PDF jobs

- PDF exports run as background jobs to support unrestricted date ranges and large selections.
- Job states are queued, processing, completed, and failed.
- Completed PDF files are private and accessible only to the admin.
- Generated files are retained permanently unless the admin deletes them.
- The admin may manually delete a generated file without changing any source HR records.
- After file deletion, export-history metadata remains, including report tab, filters/selection, generation time, and deletion time.

## 13. Roles and Permissions — Locked

### Fixed roles

- The system has exactly two fixed roles: Admin and Employee.
- The single environment-configured admin is the only administrative actor.
- No additional admin accounts, custom roles, role editor, or configurable permission matrix exists.
- Authorization is enforced by the Express API and is not dependent only on hidden frontend controls.

### Admin access

- The admin can access all administrative modules and all company records.
- Admin access remains constrained by locked business rules; being admin does not allow reopening finalized payroll, editing immutable attendance, restoring deleted employees, or bypassing other prohibited state transitions.
- The admin may access protected employee images through authorized API endpoints.
- The admin cannot retrieve PINs, private device credentials, raw biometric images, or other stored secrets.

### Employee attendance identity

- Employee check-in and check-out use the event-specific verification flows defined in Login and Attendance.
- Successful attendance verification does not grant administrative access.
- The shared branch phone operates only as an attendance interface and does not create a reusable employee self-service session.

### Employee self-service access

- Starting self-service requires the employee's registered personal phone and an active attendance session.
- An already-active self-service session follows the locked exception for device removal and remains available until check-out.
- Access ends immediately on employee check-out, admin check-out, approved denied check-out, or automatic timeout.
- A PIN reset revokes sessions as defined in Login; device revocation follows the separately locked Devices behavior.
- A soft-deleted employee has no authentication or self-service access.

### Employee read scope

While self-service is active, an employee may view only their own:

- Non-secret profile text fields
- Assigned branch and current shift duration
- Current and historical attendance
- Absences and weekly days off
- Open salary previews and finalized payroll
- Bonuses
- Deductions
- Advances and installment schedules

- Employees cannot view another employee's data under any identifier or URL.
- Employee self-service displays no personal photo, ID-front image, or ID-back image.
- Employees cannot view PIN data, device credentials, audit history, or denied/flagged attempts.

### Employee mutation and export restrictions

- Employee self-service is entirely read-only.
- Employees cannot edit profile details, phone numbers, PIN, branch, shift, attendance, day-off, salary, bonus, deduction, advance, or device assignments.
- Reports screens and PDF generation/download are admin-only.
- Employees cannot print or export a self-service PDF.

## 14. Audit History — Locked

### Admin access and immutability

- The admin has a read-only Audit page.
- Audit entries are immutable and cannot be edited or deleted through the product.
- Audit history is retained permanently.
- The Audit page follows the global admin search and filter requirements.

### Audited events

- Audit captures all data-changing and security-sensitive events.
- This includes admin create/edit/delete actions, employee attendance events, manual attendance, denied-attempt approval, device pairing/replacement/revocation, login/logout, automatic absence, weekly day-off conversion/correction, automatic timeout, allowed attendance correction, payroll finalization, report-file deletion, and other system state transitions.
- Ordinary page views and report viewing are not audited.

### Audit metadata

Each entry stores available contextual metadata:

- Actor type and actor identifier
- Action and module
- Affected entity type and record identifier
- Before and after values where applicable
- `Africa/Cairo` timestamp
- IP address
- Device/browser information
- Related attendance, payroll, device, pairing, export, or request identifier when applicable

### Secret redaction

- Audit entries never store plaintext PINs or passwords.
- Password hashes, PIN hashes, private/public credential material, raw device tokens, session cookies, biometric templates, and other secrets are redacted or excluded.
- Raw attendance camera images do not exist and therefore cannot enter audit history.

## 15. Dashboard and Operational Visibility — Locked

### Visibility boundary

- The product has no notification center, push notifications, email notifications, SMS notifications, or WhatsApp notifications.
- Operational state is visible only on the admin dashboard and relevant module pages.

### Dashboard summaries

The admin dashboard shows live summaries for:

- Currently checked-in employees
- Previous-day sessions that remain open
- Employees not checked in yet on the current Cairo date
- Latest absences and weekly day-off conversions
- Denied and flagged attendance attempts
- System-generated 16-hour automatic check-outs
- Device pairing and replacement status
- Payroll finalization blockers
- PDF export job status

- Dashboard summaries link conceptually to the relevant module data, while exact visual interaction is deferred to the later UI-design phase.

## 16. Legacy Seed Compatibility — Locked

- Legacy data is loaded only through developer-run database seeds.
- The product has no admin CSV, Excel, or other import UI.
- Seeds are idempotent.
- Legacy employees are matched by immutable numeric employee code.
- Rerunning seeds never creates duplicate employees for an existing code.
- Seeds preserve existing/admin-edited production values.
- Reruns create missing records or fill genuinely missing required seed data without overwriting populated employee values.
- After seeding, new employee-code allocation continues after the highest stored employee code.

## 17. Background Worker and Jobs — Locked

### Worker architecture

- The modular monorepo includes `apps/worker` alongside `apps/api` and `apps/web`.
- The worker handles PDF generation, midnight absence generation, 16-hour automatic check-outs, and other durable scheduled/background work.
- MySQL stores queued and scheduled jobs; Redis is not required.
- API and worker remain parts of one modular-monolith codebase and may run as separate persistent Node.js processes on the Hostinger VPS.

### Job reliability

- A failed job automatically retries up to three times initially.
- Job records preserve state, failure reason, and attempt count.
- After three failures, a job becomes visibly failed on the dashboard.
- The admin may manually retry failed PDF-export jobs.
- Attendance and payroll system jobs continue reconciliation retries until the required business state succeeds because those records cannot be silently skipped.
- Job handlers must be idempotent so retries cannot create duplicate absences, check-outs, exports, or financial effects.

## 18. Facial Recognition and Biometrics — Locked

### Local ONNX processing

- Face recognition and liveness use locally hosted ONNX models.
- The worker performs model inference so recognition work does not block normal API request handling.
- No third-party biometric recognition service receives employee biometric data.
- Temporary camera frames exist only for processing and are discarded immediately afterward.

### Liveness

- Branch-phone verification uses a randomized active challenge, such as blink, turn left/right, or smile.
- The active challenge is combined with the local ONNX liveness model result.

### Templates and encryption

- Supervised enrollment produces a face template separate from profile and ID images.
- Face templates are encrypted at rest in MySQL.
- Encryption uses a server-only key supplied through environment configuration.
- The encryption key is never stored in MySQL or exposed to clients, logs, audit entries, or exports.
- Soft-deleting an employee permanently deletes their encrypted face template.
- Historical attempts retain only non-biometric scores, thresholds, outcomes, model version, and operational metadata.

### Re-enrollment and model compatibility

- The admin may initiate supervised face re-enrollment.
- The old template remains active until replacement enrollment succeeds.
- Successful replacement permanently deletes the old template.
- Every template and recognition attempt stores the ONNX model name/version.
- Templates produced by an incompatible embedding model cannot be silently compared using another model.
- An incompatible model upgrade requires supervised re-enrollment for affected employees.

### Admin thresholds

- The admin controls one company-wide face-match threshold.
- The admin controls one company-wide liveness threshold.
- Threshold changes are audited and apply only to future attempts.
- Each attempt stores the face/liveness scores and threshold snapshots used for its decision.

## 19. Session Persistence — Locked

- Secure admin and employee self-service session records are stored in MySQL.
- Session cookies contain only an opaque session identifier and use secure HTTP-only cookie protections.
- API restarts do not log users out merely because in-memory state was lost.
- MySQL-backed state supports immediate revocation for logout, PIN reset, check-out, and other locked revocation events.

## 20. Functional Scope Boundary — Locked

The target product keeps these functional modules:

- Auth/Login
- Branches
- Employees
- Devices
- Shifts
- Weekly Day-Off
- Attendance and Absence
- Salaries/Payroll
- Bonuses
- Deductions
- Advances
- Reports/Exports
- Audit
- Settings limited to company-wide recognition thresholds

Unused scaffold placeholders such as Benefits, Departments, Positions, Recruitment, Onboarding, Performance, Documents, Organization, and Notifications are outside scope and must not remain in the target architecture.

## 21. Verification and Testing — Locked

### Domain and calculation tests

- Unit tests cover salary proration, required-minute rates, overtime, attendance shortage, full absence deductions, weekly day-off spacing, creation/deletion-date eligibility, advance installments, rounding remainders, negative carry, and chronological payroll finalization.
- Shift-change tests prove each attendance date retains the correct required-duration snapshot.

### Database and integration tests

- Integration tests run against MySQL for transaction behavior, unique constraints, soft deletion, session revocation, payroll financial locks, job retries, and immutable records.
- Concurrency tests cover employee-code allocation, duplicate check-in submissions, one-session enforcement, background-job idempotency, and payroll finalization.
- Seed tests prove reruns preserve admin-edited data, fill only missing required data, and never duplicate employee codes.

### API and authorization tests

- REST contract tests cover every admin and employee endpoint.
- Authorization tests prove employees cannot access another employee, employee images, Reports, Audit, denied attempts, or admin mutation endpoints.
- Session tests cover logout, PIN-reset revocation, attendance check-out revocation, automatic-timeout revocation, and the separately locked device-removal behavior.

### Attendance and biometric tests

- Attendance workflows cover personal and branch devices, exact GPS-radius boundaries, denied and flagged attempts, admin approval, cross-midnight sessions, one-session rules, automatic timeout, and allowed correction.
- Biometric tests use synthetic or explicitly consented fixtures only.
- Production employee face images and templates never enter the test suite.
- Tests cover model-version compatibility, threshold snapshots, template encryption/deletion, active liveness challenges, and raw-frame disposal.

### Reports and end-to-end tests

- PDF tests verify Arabic/RTL rendering, embedded fonts, fixed columns, filters/selections, combined output, deleted-employee labels, and sensitive-data exclusion.
- Background-export tests cover queued, processing, completed, failed, retry, download, and file-deletion behavior.
- End-to-end tests cover critical admin, employee self-service, attendance, payroll, and report workflows.

## 22. Data Integrity and Error Handling — Locked

### Transactions and invariants

- Multi-record operations use MySQL transactions, including employee creation, device replacement, attendance-attempt approval, weekly day-off conversion, advance schedule generation, payroll finalization, and branch-wide finalization.
- A failed transaction commits no partial business state.
- Database constraints enforce critical uniqueness, ownership, state, and one-session invariants in addition to application validation.
- Exact decimal arithmetic is used for money; binary floating-point arithmetic is prohibited for payroll calculations.
- Date/time values are stored as UTC timestamps and displayed and interpreted using `Africa/Cairo` business boundaries.

### Idempotency and concurrency

- Attendance events, pairing completion, background-job execution, absence generation, automatic timeout, employee-code allocation, and payroll finalization are safe against retries and double submissions.
- Concurrent requests cannot create duplicate employee codes, duplicate daily attendance sessions, duplicate installments, duplicate background effects, or multiple finalizations.

### File compensation

- File and database operations use compensating cleanup where a single database transaction cannot cover filesystem writes.
- If employee creation fails after new files were stored, those new files are removed.
- If image replacement fails, the old image and database reference remain unchanged.
- Old images are removed only after the replacement file and database update succeed.

### REST error contract

- REST errors use one consistent response shape containing a stable error code, Arabic user-facing message, field errors when relevant, and request/correlation ID.
- Expected conflicts return specific Arabic errors, including duplicate phone, duplicate branch name, existing daily session, open session, finalized payroll, invalid day-off spacing, revoked device, invalid pairing request, and financial-lock violations.
- Unexpected errors return a safe generic Arabic message.
- Stack traces, SQL details, filesystem paths, hashes, credentials, biometric data, and other secrets remain server-side.

### Correlation and diagnostics

- Every API request receives a correlation/request ID.
- Related API logs, background jobs, audit entries, and error responses share that identifier where applicable.

## 23. Target Repository Structure — Locked

This is the intended functional structure after implementation. The later visual-design AI may refine files inside `apps/web` and `packages/ui` without changing the approved domain boundaries. Generated directories such as `node_modules`, `.turbo`, `.next`, build outputs, coverage, and `.git` are omitted.

Every API domain directory contains focused route, controller, service/use-case, repository, validation/schema, DTO, and test files as required by that domain. Every web feature directory contains its own API adapters, components, hooks, schemas, types, and utilities. These repeated internal files are summarized rather than expanded for every module.

```text
HR/
+-- apps/
|   +-- api/
|   |   +-- src/
|   |   |   +-- modules/
|   |   |   |   +-- auth/
|   |   |   |   +-- branches/
|   |   |   |   +-- employees/
|   |   |   |   +-- devices/
|   |   |   |   +-- shifts/
|   |   |   |   +-- weekly-day-off/
|   |   |   |   +-- attendance/
|   |   |   |   +-- payroll/
|   |   |   |   +-- bonuses/
|   |   |   |   +-- deductions/
|   |   |   |   +-- advances/
|   |   |   |   +-- reports/
|   |   |   |   +-- audit/
|   |   |   |   +-- settings/
|   |   |   |   \-- dashboard/
|   |   |   +-- shared/
|   |   |   |   +-- errors/
|   |   |   |   +-- http/
|   |   |   |   +-- middleware/
|   |   |   |   +-- security/
|   |   |   |   +-- storage/
|   |   |   |   +-- transactions/
|   |   |   |   \-- types/
|   |   |   +-- app.ts
|   |   |   \-- server.ts
|   |   +-- tests/
|   |   |   +-- contract/
|   |   |   +-- integration/
|   |   |   \-- helpers/
|   |   +-- uploads/
|   |   |   +-- employees/
|   |   |   \-- reports/
|   |   +-- eslint.config.mjs
|   |   +-- package.json
|   |   +-- tsconfig.build.json
|   |   +-- tsconfig.json
|   |   \-- vitest.config.ts
|   +-- web/
|   |   +-- src/
|   |   |   +-- app/
|   |   |   |   +-- (admin)/
|   |   |   |   |   +-- dashboard/
|   |   |   |   |   +-- branches/
|   |   |   |   |   +-- employees/
|   |   |   |   |   +-- devices/
|   |   |   |   |   +-- shifts/
|   |   |   |   |   +-- weekly-day-off/
|   |   |   |   |   +-- attendance/
|   |   |   |   |   +-- payroll/
|   |   |   |   |   +-- bonuses/
|   |   |   |   |   +-- deductions/
|   |   |   |   |   +-- advances/
|   |   |   |   |   +-- reports/
|   |   |   |   |   +-- audit/
|   |   |   |   |   \-- settings/
|   |   |   |   +-- (attendance)/
|   |   |   |   |   +-- personal-device/
|   |   |   |   |   \-- branch-kiosk/
|   |   |   |   +-- (employee)/
|   |   |   |   |   \-- self-service/
|   |   |   |   +-- login/
|   |   |   |   +-- layout.tsx
|   |   |   |   \-- page.tsx
|   |   |   +-- features/
|   |   |   |   +-- auth/
|   |   |   |   +-- dashboard/
|   |   |   |   +-- branches/
|   |   |   |   +-- employees/
|   |   |   |   +-- devices/
|   |   |   |   +-- shifts/
|   |   |   |   +-- weekly-day-off/
|   |   |   |   +-- attendance/
|   |   |   |   +-- payroll/
|   |   |   |   +-- bonuses/
|   |   |   |   +-- deductions/
|   |   |   |   +-- advances/
|   |   |   |   +-- reports/
|   |   |   |   +-- audit/
|   |   |   |   +-- settings/
|   |   |   |   \-- employee-self-service/
|   |   |   +-- components/
|   |   |   +-- hooks/
|   |   |   +-- lib/
|   |   |   |   +-- api/
|   |   |   |   +-- auth/
|   |   |   |   \-- utils/
|   |   |   +-- providers/
|   |   |   +-- styles/
|   |   |   \-- types/
|   |   +-- tests/
|   |   |   +-- component/
|   |   |   \-- e2e/
|   |   +-- eslint.config.mjs
|   |   +-- next.config.ts
|   |   +-- next-env.d.ts
|   |   +-- package.json
|   |   +-- tsconfig.json
|   |   \-- vitest.config.ts
|   \-- worker/
|       +-- src/
|       |   +-- jobs/
|       |   |   +-- absence-generation/
|       |   |   +-- attendance-timeout/
|       |   |   +-- biometric-processing/
|       |   |   +-- pdf-export/
|       |   |   \-- reconciliation/
|       |   +-- scheduler/
|       |   +-- worker.ts
|       |   \-- index.ts
|       +-- tests/
|       |   +-- integration/
|       |   \-- fixtures/
|       +-- eslint.config.mjs
|       +-- package.json
|       +-- tsconfig.build.json
|       +-- tsconfig.json
|       \-- vitest.config.ts
+-- packages/
|   +-- biometrics/
|   |   +-- models/
|   |   +-- src/
|   |   |   +-- encryption/
|   |   |   +-- enrollment/
|   |   |   +-- liveness/
|   |   |   +-- recognition/
|   |   |   +-- compatibility/
|   |   |   \-- index.ts
|   |   +-- tests/
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- config/
|   |   +-- src/
|   |   |   +-- client.ts
|   |   |   +-- server.ts
|   |   |   \-- worker.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- contracts/
|   |   +-- src/
|   |   |   +-- common/
|   |   |   +-- modules/
|   |   |   |   +-- auth/
|   |   |   |   +-- branches/
|   |   |   |   +-- employees/
|   |   |   |   +-- devices/
|   |   |   |   +-- shifts/
|   |   |   |   +-- weekly-day-off/
|   |   |   |   +-- attendance/
|   |   |   |   +-- payroll/
|   |   |   |   +-- bonuses/
|   |   |   |   +-- deductions/
|   |   |   |   +-- advances/
|   |   |   |   +-- reports/
|   |   |   |   +-- audit/
|   |   |   |   +-- settings/
|   |   |   |   \-- dashboard/
|   |   |   \-- index.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- database/
|   |   +-- migrations/
|   |   +-- src/
|   |   |   +-- schema/
|   |   |   |   +-- auth/
|   |   |   |   +-- branches/
|   |   |   |   +-- employees/
|   |   |   |   +-- devices/
|   |   |   |   +-- shifts/
|   |   |   |   +-- weekly-day-off/
|   |   |   |   +-- attendance/
|   |   |   |   +-- payroll/
|   |   |   |   +-- bonuses/
|   |   |   |   +-- deductions/
|   |   |   |   +-- advances/
|   |   |   |   +-- reports/
|   |   |   |   +-- audit/
|   |   |   |   +-- settings/
|   |   |   |   +-- jobs/
|   |   |   |   \-- index.ts
|   |   |   +-- seed/
|   |   |   |   +-- data/
|   |   |   |   +-- helpers/
|   |   |   |   \-- index.ts
|   |   |   +-- client.ts
|   |   |   \-- index.ts
|   |   +-- drizzle.config.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- jobs/
|   |   +-- src/
|   |   |   +-- queue/
|   |   |   +-- scheduler/
|   |   |   +-- types/
|   |   |   \-- index.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- reporting/
|   |   +-- assets/
|   |   |   \-- fonts/
|   |   +-- src/
|   |   |   +-- pdf/
|   |   |   +-- rtl/
|   |   |   +-- templates/
|   |   |   \-- index.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- shared/
|   |   +-- src/
|   |   |   +-- constants/
|   |   |   +-- enums/
|   |   |   +-- errors/
|   |   |   +-- money/
|   |   |   +-- schemas/
|   |   |   +-- time/
|   |   |   +-- types/
|   |   |   +-- utils/
|   |   |   \-- index.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- testing/
|   |   +-- src/
|   |   |   +-- builders/
|   |   |   +-- fixtures/
|   |   |   +-- helpers/
|   |   |   +-- mysql/
|   |   |   \-- setup.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- ui/
|   |   +-- src/
|   |   |   +-- components/
|   |   |   +-- hooks/
|   |   |   +-- styles/
|   |   |   +-- types/
|   |   |   \-- index.ts
|   |   +-- package.json
|   |   \-- tsconfig.json
|   +-- eslint-config/
|   |   +-- next.mjs
|   |   +-- node.mjs
|   |   \-- package.json
|   \-- typescript-config/
|       +-- base.json
|       +-- nextjs.json
|       +-- node.json
|       +-- package.json
|       \-- react-library.json
+-- docs/
|   +-- architecture.md
|   \-- hr-specs.md
+-- .env.example
+-- .gitignore
+-- package.json
+-- pnpm-lock.yaml
+-- pnpm-workspace.yaml
+-- README.md
\-- turbo.json
```

### Runtime and generated assets

- `apps/api/uploads/employees` and `apps/api/uploads/reports` are runtime storage directories excluded from Git; only keep-files or documentation remain in source control.
- ONNX model binaries may be provisioned as deployment assets rather than committed when licensing or file size requires it; model manifests and compatibility code remain in `packages/biometrics`.
- Database migrations are committed; generated databases, logs, caches, coverage, and build artifacts are not.
