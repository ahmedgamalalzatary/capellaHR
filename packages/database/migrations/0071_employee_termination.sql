CREATE TABLE `employee_terminations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`last_working_day` date NOT NULL,
	`terminated_by_type` enum('admin','employee','account','system') NOT NULL,
	`terminated_by_identifier` varchar(128) NOT NULL,
	`net_salary_before_settlement` decimal(14,2) NOT NULL,
	`advances_recovered` decimal(14,2) NOT NULL,
	`write_off_amount` decimal(14,2) NOT NULL,
	`forfeited_salary_amount` decimal(14,2) NOT NULL,
	`cash_collected_amount` decimal(14,2) NOT NULL,
	`debt_recorded_amount` decimal(14,2) NOT NULL,
	`final_net_salary` decimal(14,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_terminations_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_terminations_write_off_nonnegative` CHECK(`employee_terminations`.`write_off_amount` >= 0),
	CONSTRAINT `employee_terminations_advances_nonnegative` CHECK(`employee_terminations`.`advances_recovered` >= 0),
	CONSTRAINT `employee_terminations_forfeited_nonnegative` CHECK(`employee_terminations`.`forfeited_salary_amount` >= 0),
	CONSTRAINT `employee_terminations_cash_nonnegative` CHECK(`employee_terminations`.`cash_collected_amount` >= 0),
	CONSTRAINT `employee_terminations_debt_nonnegative` CHECK(`employee_terminations`.`debt_recorded_amount` >= 0)
);
--> statement-breakpoint
ALTER TABLE `employee_pending_deactivations` ADD `reason` varchar(500);--> statement-breakpoint
ALTER TABLE `employee_pending_deactivations` ADD `last_working_day` date;--> statement-breakpoint
UPDATE `employee_pending_deactivations`
  SET `reason` = 'تعطيل مطلوب قبل تسجيل سبب ترك العمل',
      `last_working_day` = date(`requested_at`)
  WHERE `reason` IS NULL;--> statement-breakpoint
ALTER TABLE `employee_pending_deactivations` MODIFY COLUMN `reason` varchar(500) NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_pending_deactivations` MODIFY COLUMN `last_working_day` date NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_terminations` ADD CONSTRAINT `employee_terminations_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employee_terminations_employee_idx` ON `employee_terminations` (`employee_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `employee_outstanding_debts_settled_idx` ON `employee_outstanding_debts` (`employee_id`,`settled_at`);