CREATE TABLE `employee_branch_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`effective_from` timestamp(3) NOT NULL,
	`effective_to` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_branch_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_branch_assignments_period_valid` CHECK(`employee_branch_assignments`.`effective_to` is null or `employee_branch_assignments`.`effective_to` >= `employee_branch_assignments`.`effective_from`)
);
--> statement-breakpoint
ALTER TABLE `employee_branch_assignments` ADD CONSTRAINT `employee_branch_assignments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_branch_assignments` ADD CONSTRAINT `employee_branch_assignments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employee_branch_assignments_employee_period_idx` ON `employee_branch_assignments` (`employee_id`,`effective_from`,`effective_to`);--> statement-breakpoint
CREATE INDEX `employee_branch_assignments_branch_period_idx` ON `employee_branch_assignments` (`branch_id`,`effective_from`,`effective_to`);--> statement-breakpoint
INSERT INTO `employee_branch_assignments` (`employee_id`, `branch_id`, `effective_from`, `effective_to`, `created_at`)
SELECT `id`, `branch_id`, `created_at`, NULL, `created_at` FROM `employees`;
