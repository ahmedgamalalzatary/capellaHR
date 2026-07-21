CREATE INDEX `attendance_daily_records_date_employee_idx` ON `attendance_daily_records` (`attendance_date`,`employee_id`);--> statement-breakpoint
CREATE INDEX `attendance_sessions_date_employee_idx` ON `attendance_sessions` (`attendance_date`,`employee_id`);--> statement-breakpoint
CREATE INDEX `advance_installments_month_employee_idx` ON `advance_installments` (`payroll_month`,`employee_id`);--> statement-breakpoint
CREATE INDEX `bonuses_month_employee_idx` ON `bonuses` (`payroll_month`,`employee_id`);--> statement-breakpoint
CREATE INDEX `deductions_month_employee_idx` ON `deductions` (`payroll_month`,`employee_id`);