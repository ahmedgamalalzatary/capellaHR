CREATE TABLE `employee_employment_periods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`active_from` timestamp(3) NOT NULL,
	`active_to` timestamp(3),
	`current_employee_id` int GENERATED ALWAYS AS (case when active_to is null then employee_id else null end) STORED,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_employment_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_employment_periods_current_employee_unique` UNIQUE(`current_employee_id`),
	CONSTRAINT `employee_employment_periods_period_valid` CHECK(`employee_employment_periods`.`active_to` is null or `employee_employment_periods`.`active_to` >= `employee_employment_periods`.`active_from`)
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `employment_status` enum('active','inactive') DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE `employees` SET `employment_status` = 'inactive' WHERE `deleted_at` IS NOT NULL;--> statement-breakpoint
INSERT INTO `employee_employment_periods` (`employee_id`, `active_from`, `active_to`, `created_at`)
SELECT `id`, `created_at`, `deleted_at`, `created_at` FROM `employees`;--> statement-breakpoint
ALTER TABLE `employee_employment_periods` ADD CONSTRAINT `employee_employment_periods_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employee_employment_periods_employee_period_idx` ON `employee_employment_periods` (`employee_id`,`active_from`,`active_to`);
