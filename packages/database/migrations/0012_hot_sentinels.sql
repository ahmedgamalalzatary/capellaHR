CREATE TABLE `advance_installments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`advance_id` int NOT NULL,
	`employee_id` int NOT NULL,
	`ordinal` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `advance_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `advance_installments_advance_ordinal_unique` UNIQUE(`advance_id`,`ordinal`),
	CONSTRAINT `advance_installments_advance_month_unique` UNIQUE(`advance_id`,`payroll_month`),
	CONSTRAINT `advance_installments_amount_positive` CHECK(`advance_installments`.`amount` > 0),
	CONSTRAINT `advance_installments_ordinal_range` CHECK(`advance_installments`.`ordinal` between 1 and 4),
	CONSTRAINT `advance_installments_month_first_day` CHECK(dayofmonth(`advance_installments`.`payroll_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `advances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`installment_count` int NOT NULL,
	`start_month` date NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `advances_id` PRIMARY KEY(`id`),
	CONSTRAINT `advances_amount_positive` CHECK(`advances`.`amount` > 0),
	CONSTRAINT `advances_installment_count_range` CHECK(`advances`.`installment_count` between 1 and 4),
	CONSTRAINT `advances_month_first_day` CHECK(dayofmonth(`advances`.`start_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `bonuses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `bonuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `bonuses_amount_positive` CHECK(`bonuses`.`amount` > 0),
	CONSTRAINT `bonuses_month_first_day` CHECK(dayofmonth(`bonuses`.`payroll_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `deductions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `deductions_id` PRIMARY KEY(`id`),
	CONSTRAINT `deductions_amount_positive` CHECK(`deductions`.`amount` > 0),
	CONSTRAINT `deductions_month_first_day` CHECK(dayofmonth(`deductions`.`payroll_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `employee_salary_periods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`effective_month` date NOT NULL,
	`base_salary` decimal(12,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_salary_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_salary_periods_employee_month_unique` UNIQUE(`employee_id`,`effective_month`),
	CONSTRAINT `employee_salary_periods_amount_positive` CHECK(`employee_salary_periods`.`base_salary` > 0),
	CONSTRAINT `employee_salary_periods_month_first_day` CHECK(dayofmonth(`employee_salary_periods`.`effective_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `financial_audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entity_type` enum('salary','payroll','bonus','deduction','advance') NOT NULL,
	`entity_id` int NOT NULL,
	`action` enum('create','update','delete','finalize','accelerate') NOT NULL,
	`before_state` json,
	`after_state` json,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `financial_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payroll_months` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`status` enum('finalized') NOT NULL DEFAULT 'finalized',
	`base_salary` decimal(12,2) NOT NULL,
	`prorated_base` decimal(14,2) NOT NULL,
	`overtime_amount` decimal(14,2) NOT NULL,
	`bonus_amount` decimal(14,2) NOT NULL,
	`attendance_deduction_amount` decimal(14,2) NOT NULL,
	`manual_deduction_amount` decimal(14,2) NOT NULL,
	`advance_amount` decimal(14,2) NOT NULL,
	`prior_negative_carry` decimal(14,2) NOT NULL,
	`net_salary` decimal(14,2) NOT NULL,
	`eligible_workdays` int NOT NULL,
	`full_month_workdays` int NOT NULL,
	`required_minutes` int NOT NULL,
	`overtime_minutes` int NOT NULL,
	`shortage_minutes` int NOT NULL,
	`finalized_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `payroll_months_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_months_employee_month_unique` UNIQUE(`employee_id`,`payroll_month`),
	CONSTRAINT `payroll_months_month_first_day` CHECK(dayofmonth(`payroll_months`.`payroll_month`) = 1),
	CONSTRAINT `payroll_months_counts_nonnegative` CHECK(`payroll_months`.`eligible_workdays` >= 0 and `payroll_months`.`full_month_workdays` >= 0 and `payroll_months`.`required_minutes` >= 0 and `payroll_months`.`overtime_minutes` >= 0 and `payroll_months`.`shortage_minutes` >= 0)
);
--> statement-breakpoint
ALTER TABLE `advance_installments` ADD CONSTRAINT `advance_installments_advance_id_advances_id_fk` FOREIGN KEY (`advance_id`) REFERENCES `advances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advance_installments` ADD CONSTRAINT `advance_installments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `advances` ADD CONSTRAINT `advances_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bonuses` ADD CONSTRAINT `bonuses_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deductions` ADD CONSTRAINT `deductions_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_salary_periods` ADD CONSTRAINT `employee_salary_periods_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_months` ADD CONSTRAINT `payroll_months_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `advance_installments_employee_month_idx` ON `advance_installments` (`employee_id`,`payroll_month`);--> statement-breakpoint
CREATE INDEX `advances_employee_idx` ON `advances` (`employee_id`);--> statement-breakpoint
CREATE INDEX `bonuses_employee_month_idx` ON `bonuses` (`employee_id`,`payroll_month`);--> statement-breakpoint
CREATE INDEX `deductions_employee_month_idx` ON `deductions` (`employee_id`,`payroll_month`);--> statement-breakpoint
CREATE INDEX `financial_audit_events_entity_idx` ON `financial_audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `payroll_months_month_status_idx` ON `payroll_months` (`payroll_month`,`status`);