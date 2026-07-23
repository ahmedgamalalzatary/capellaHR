ALTER TABLE `employee_branch_assignments` ADD `active_employee_id` int GENERATED ALWAYS AS (case when effective_to is null then employee_id else null end) STORED;--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD `branch_id` int;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD `branch_id` int;--> statement-breakpoint
UPDATE `attendance_daily_records` `r` INNER JOIN `employees` `e` ON `e`.`id` = `r`.`employee_id` SET `r`.`branch_id` = `e`.`branch_id`;--> statement-breakpoint
UPDATE `attendance_sessions` `s` INNER JOIN `employees` `e` ON `e`.`id` = `s`.`employee_id` SET `s`.`branch_id` = `e`.`branch_id`;--> statement-breakpoint
ALTER TABLE `attendance_daily_records` MODIFY COLUMN `branch_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `attendance_sessions` MODIFY COLUMN `branch_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_branch_assignments` ADD CONSTRAINT `employee_branch_assignments_active_employee_unique` UNIQUE(`active_employee_id`);--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD CONSTRAINT `attendance_daily_records_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
