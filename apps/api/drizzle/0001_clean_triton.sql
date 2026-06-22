CREATE TABLE `admin_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admin_id` int NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`revoked_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `employee_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`revoked_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_sessions_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_sessions` ADD CONSTRAINT `employee_sessions_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_sessions_admin_id_idx` ON `admin_sessions` (`admin_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_at_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `employee_sessions_employee_id_idx` ON `employee_sessions` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employee_sessions_expires_at_idx` ON `employee_sessions` (`expires_at`);