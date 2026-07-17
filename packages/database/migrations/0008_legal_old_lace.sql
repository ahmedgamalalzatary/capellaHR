CREATE TABLE `device_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`device_id` int NOT NULL,
	`event` enum('paired','verified','revoked') NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `device_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `device_pairing_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assignment_type` enum('employee','branch') NOT NULL,
	`employee_id` int,
	`branch_id` int,
	`token_hash` varchar(64) NOT NULL,
	`status` enum('pending','used','cancelled') NOT NULL DEFAULT 'pending',
	`created_at` timestamp(3) NOT NULL,
	`consumed_at` timestamp(3),
	`cancelled_at` timestamp(3),
	CONSTRAINT `device_pairing_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `device_pairing_token_hash_unique` UNIQUE(`token_hash`),
	CONSTRAINT `device_pairings_exact_assignment` CHECK((`device_pairing_requests`.`assignment_type` = 'employee' and `device_pairing_requests`.`employee_id` is not null and `device_pairing_requests`.`branch_id` is null) or (`device_pairing_requests`.`assignment_type` = 'branch' and `device_pairing_requests`.`branch_id` is not null and `device_pairing_requests`.`employee_id` is null))
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assignment_type` enum('employee','branch') NOT NULL,
	`employee_id` int,
	`branch_id` int,
	`credential_id_hash` varchar(64) NOT NULL,
	`public_key` text NOT NULL,
	`installation_marker_hash` varchar(64) NOT NULL,
	`browser` varchar(255) NOT NULL,
	`platform` varchar(255) NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`paired_at` timestamp(3) NOT NULL,
	`last_used_at` timestamp(3),
	`revoked_at` timestamp(3),
	CONSTRAINT `devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `devices_credential_hash_unique` UNIQUE(`credential_id_hash`),
	CONSTRAINT `devices_installation_marker_hash_unique` UNIQUE(`installation_marker_hash`),
	CONSTRAINT `devices_exact_assignment` CHECK((`devices`.`assignment_type` = 'employee' and `devices`.`employee_id` is not null and `devices`.`branch_id` is null) or (`devices`.`assignment_type` = 'branch' and `devices`.`branch_id` is not null and `devices`.`employee_id` is null))
);
--> statement-breakpoint
ALTER TABLE `device_history` ADD CONSTRAINT `device_history_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `device_pairing_requests` ADD CONSTRAINT `device_pairing_requests_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `device_pairing_requests` ADD CONSTRAINT `device_pairing_requests_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `devices` ADD CONSTRAINT `devices_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;