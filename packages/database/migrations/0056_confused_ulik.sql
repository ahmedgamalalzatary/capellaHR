CREATE TABLE `erp_commission_payroll_inputs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`reference` varchar(191) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_commission_payroll_inputs_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_commission_payroll_inputs_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `erp_commission_payroll_inputs_employee_month_unique` UNIQUE(`employee_id`,`payroll_month`),
	CONSTRAINT `erp_commission_payroll_inputs_amount_nonnegative` CHECK(`erp_commission_payroll_inputs`.`amount` >= 0),
	CONSTRAINT `erp_commission_payroll_inputs_month_first_day` CHECK(dayofmonth(`erp_commission_payroll_inputs`.`payroll_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `erp_post_payroll_deductions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`reference` varchar(191) NOT NULL,
	`occurred_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_post_payroll_deductions_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_post_payroll_deductions_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `erp_post_payroll_deductions_amount_positive` CHECK(`erp_post_payroll_deductions`.`amount` > 0),
	CONSTRAINT `erp_post_payroll_deductions_month_first_day` CHECK(dayofmonth(`erp_post_payroll_deductions`.`payroll_month`) = 1)
);
--> statement-breakpoint
ALTER TABLE `payroll_months` ADD `commission_amount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payroll_months` ADD `commission_deduction_amount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_commission_payroll_inputs` ADD CONSTRAINT `erp_commission_payroll_inputs_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_post_payroll_deductions` ADD CONSTRAINT `erp_post_payroll_deductions_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_post_payroll_deductions_employee_month_idx` ON `erp_post_payroll_deductions` (`employee_id`,`payroll_month`);
--> statement-breakpoint
INSERT INTO `erp_commission_payroll_inputs` (
	`employee_id`, `payroll_month`, `amount`, `reference`, `created_at`, `updated_at`
)
SELECT
	ledger.`employee_id`,
	STR_TO_DATE(CONCAT(MIN(SUBSTRING(invoice.`invoice_number`, 5, 7)), '.01'), '%Y.%m.%d') AS `payroll_month`,
	SUM(ledger.`amount`) AS `amount`,
	CONCAT('erp-commission:', REPLACE(MIN(SUBSTRING(invoice.`invoice_number`, 5, 7)), '.', '-'), ':', ledger.`employee_id`) AS `reference`,
	CURRENT_TIMESTAMP(3),
	CURRENT_TIMESTAMP(3)
FROM `erp_commission_ledger_entries` ledger
INNER JOIN `erp_invoices` invoice ON invoice.`id` = ledger.`invoice_id`
LEFT JOIN `payroll_months` payroll ON payroll.`employee_id` = ledger.`employee_id`
	AND payroll.`payroll_month` = STR_TO_DATE(CONCAT(SUBSTRING(invoice.`invoice_number`, 5, 7), '.01'), '%Y.%m.%d')
WHERE payroll.`id` IS NULL
GROUP BY ledger.`employee_id`, SUBSTRING(invoice.`invoice_number`, 5, 7);
