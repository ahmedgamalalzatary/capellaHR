CREATE TABLE `auth_attempts` (
	`id` varchar(36) NOT NULL,
	`actor_type` enum('admin','employee') NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`succeeded` boolean NOT NULL,
	`flagged` boolean NOT NULL,
	`reason` varchar(64),
	`ip_address` varchar(45),
	`user_agent` varchar(1024),
	`request_id` varchar(64),
	`metadata` json,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `auth_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`actor_type` enum('admin','employee') NOT NULL,
	`employee_id` int,
	`created_at` timestamp(3) NOT NULL,
	`revoked_at` timestamp(3),
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_identifier_created_idx` ON `auth_attempts` (`identifier`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_attempts_flagged_created_idx` ON `auth_attempts` (`flagged`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_employee_active_idx` ON `auth_sessions` (`employee_id`,`revoked_at`);