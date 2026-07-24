CREATE TABLE `employee_deactivation_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`payroll_month` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_deactivation_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_deactivation_payments_employee_month_unique` UNIQUE(`employee_id`,`payroll_month`),
	CONSTRAINT `employee_deactivation_payments_amount_positive` CHECK(`employee_deactivation_payments`.`amount` > 0),
	CONSTRAINT `employee_deactivation_payments_month_first_day` CHECK(dayofmonth(`employee_deactivation_payments`.`payroll_month`) = 1)
);
--> statement-breakpoint
ALTER TABLE `payroll_months` ADD `deactivation_payment_amount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_deactivation_payments` ADD CONSTRAINT `employee_deactivation_payments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;