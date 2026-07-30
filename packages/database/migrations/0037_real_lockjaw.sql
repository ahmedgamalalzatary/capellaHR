CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin','cashier') NOT NULL,
	`employee_id` int,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_username_unique` UNIQUE(`username`),
	CONSTRAINT `accounts_employee_unique` UNIQUE(`employee_id`),
	CONSTRAINT `accounts_role_scope_consistency` CHECK((`accounts`.`role` = 'admin' and `accounts`.`employee_id` is null) or (`accounts`.`role` = 'cashier' and `accounts`.`employee_id` is not null))
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;