CREATE TABLE `employee_deactivation_adjustments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`reason` enum('cash_payment','write_off','forfeited_salary') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_deactivation_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_deactivation_adjustments_employee_month_reason_unique` UNIQUE(`employee_id`,`payroll_month`,`reason`),
	CONSTRAINT `employee_deactivation_adjustments_amount_nonzero` CHECK(`employee_deactivation_adjustments`.`amount` <> 0),
	CONSTRAINT `employee_deactivation_adjustments_month_first_day` CHECK(dayofmonth(`employee_deactivation_adjustments`.`payroll_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `employee_outstanding_debts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`settled_at` timestamp(3),
	CONSTRAINT `employee_outstanding_debts_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_outstanding_debts_employee_month_unique` UNIQUE(`employee_id`,`payroll_month`),
	CONSTRAINT `employee_outstanding_debts_amount_positive` CHECK(`employee_outstanding_debts`.`amount` > 0),
	CONSTRAINT `employee_outstanding_debts_month_first_day` CHECK(dayofmonth(`employee_outstanding_debts`.`payroll_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `employee_pending_deactivations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`advance_decision` enum('sum_all','zero_salary','ignore_debt') NOT NULL,
	`negative_balance_decision` enum('collect_cash','record_debt'),
	`requested_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_pending_deactivations_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_pending_deactivations_employee_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
ALTER TABLE `payroll_months` ADD `deactivation_adjustment_amount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_deactivation_adjustments` ADD CONSTRAINT `employee_deactivation_adjustments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_outstanding_debts` ADD CONSTRAINT `employee_outstanding_debts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pending_deactivations` ADD CONSTRAINT `employee_pending_deactivations_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Carry existing deactivation cash payments into the signed adjustment ledger. The old table
-- only ever held money the employee handed over, so every row maps to `cash_payment`.
INSERT INTO `employee_deactivation_adjustments` (`employee_id`, `payroll_month`, `reason`, `amount`, `created_at`)
SELECT `employee_id`, `payroll_month`, 'cash_payment', `amount`, `created_at`
FROM `employee_deactivation_payments`;--> statement-breakpoint
UPDATE `payroll_months` SET `deactivation_adjustment_amount` = `deactivation_payment_amount`;
