ALTER TABLE `bonuses` ADD `days` int;--> statement-breakpoint
ALTER TABLE `bonuses` ADD `base_salary_snapshot` decimal(14,2);--> statement-breakpoint
ALTER TABLE `deductions` ADD `days` int;--> statement-breakpoint
ALTER TABLE `deductions` ADD `base_salary_snapshot` decimal(14,2);--> statement-breakpoint
ALTER TABLE `bonuses` ADD CONSTRAINT `bonuses_days_positive` CHECK (`bonuses`.`days` > 0);--> statement-breakpoint
ALTER TABLE `deductions` ADD CONSTRAINT `deductions_days_positive` CHECK (`deductions`.`days` > 0);