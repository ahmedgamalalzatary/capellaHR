ALTER TABLE `employees` ADD CONSTRAINT `employees_age_positive` CHECK (`employees`.`age` > 0);--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_shift_duration_range` CHECK (`employees`.`shift_duration_minutes` between 1 and 720);--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_salary_positive` CHECK (`employees`.`monthly_base_salary` > 0);