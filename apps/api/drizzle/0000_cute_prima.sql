CREATE TABLE `admins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`last_login_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admins_id` PRIMARY KEY(`id`),
	CONSTRAINT `admins_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `attendance_blocked_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`branch_id` int,
	`attempted_action` enum('check_in','check_out') NOT NULL,
	`failure_reasons` json NOT NULL,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`ip_address` varchar(64),
	`device_id` varchar(255),
	`branch_policy_snapshot` json NOT NULL,
	`occurred_at_utc` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `attendance_blocked_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendance_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`status` enum('open','completed') NOT NULL DEFAULT 'open',
	`check_in_at_utc` datetime NOT NULL,
	`check_out_at_utc` datetime,
	`check_in_latitude` decimal(10,7) NOT NULL,
	`check_in_longitude` decimal(10,7) NOT NULL,
	`check_in_ip_address` varchar(64) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`branch_policy_snapshot` json NOT NULL,
	`admin_reason` text,
	`created_by_admin_id` int,
	`updated_by_admin_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `attendance_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`admin_id` int NOT NULL,
	`action_type` varchar(100) NOT NULL,
	`entity_type` varchar(100) NOT NULL,
	`entity_id` varchar(100) NOT NULL,
	`entity_display_name` varchar(255),
	`reason` text,
	`before_json` json,
	`after_json` json,
	`occurred_at_utc` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_device_registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`device_token` varchar(255) NOT NULL,
	`device_label` varchar(255),
	`browser_fingerprint` varchar(255),
	`status` enum('pending','active','revoked','replaced') NOT NULL DEFAULT 'pending',
	`registered_at` datetime,
	`revoked_at` datetime,
	`replaced_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branch_device_registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_device_registrations_device_token_uq` UNIQUE(`device_token`)
);
--> statement-breakpoint
CREATE TABLE `branch_setup_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`token` varchar(255) NOT NULL,
	`device_label` varchar(255),
	`status` enum('active','used','revoked','expired') NOT NULL DEFAULT 'active',
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`revoked_at` datetime,
	`created_by_admin_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branch_setup_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_setup_links_token_uq` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` text NOT NULL,
	`gps_latitude` decimal(10,7) NOT NULL,
	`gps_longitude` decimal(10,7) NOT NULL,
	`gps_radius_meters` int NOT NULL,
	`allowed_ip_cidr` varchar(255) NOT NULL,
	`registered_device_token` varchar(255),
	`setup_status` enum('setup_pending','completed') NOT NULL DEFAULT 'setup_pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_branch_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`effective_from` datetime NOT NULL,
	`effective_to` datetime,
	`assigned_by_admin_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_branch_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_device_registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`device_token` varchar(255) NOT NULL,
	`device_label` varchar(255),
	`browser_fingerprint` varchar(255),
	`status` enum('pending','active','revoked','replaced') NOT NULL DEFAULT 'pending',
	`registered_at` datetime,
	`revoked_at` datetime,
	`expires_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_device_registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_device_registrations_device_token_uq` UNIQUE(`device_token`)
);
--> statement-breakpoint
CREATE TABLE `employee_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`file_type` enum('personal_photo','id_front','id_back') NOT NULL,
	`storage_path` varchar(512) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`file_size_bytes` int NOT NULL,
	`replaced_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`primary_phone` varchar(20) NOT NULL,
	`whatsapp_phone` varchar(20) NOT NULL,
	`email` varchar(255),
	`branch_id` int,
	`age` int NOT NULL,
	`address` text NOT NULL,
	`current_monthly_salary` decimal(12,2) NOT NULL,
	`soft_deleted_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	CONSTRAINT `employees_primary_phone_uq` UNIQUE(`primary_phone`),
	CONSTRAINT `employees_whatsapp_phone_uq` UNIQUE(`whatsapp_phone`),
	CONSTRAINT `employees_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `month_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`month_key` varchar(7) NOT NULL,
	`locked_at` datetime NOT NULL,
	`locked_by_admin_id` int NOT NULL,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `month_locks_id` PRIMARY KEY(`id`),
	CONSTRAINT `month_locks_month_key_uq` UNIQUE(`month_key`)
);
--> statement-breakpoint
CREATE TABLE `permission_absences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`absence_date` date NOT NULL,
	`permission_type` varchar(50) NOT NULL DEFAULT 'generic',
	`reason` text,
	`created_by_admin_id` int NOT NULL,
	`updated_by_admin_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `permission_absences_id` PRIMARY KEY(`id`),
	CONSTRAINT `permission_absences_employee_date_uq` UNIQUE(`employee_id`,`absence_date`)
);
--> statement-breakpoint
CREATE TABLE `salary_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`effective_at` datetime NOT NULL,
	`changed_by_admin_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `salary_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weekly_day_off_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`week_start_date` date NOT NULL,
	`day_off_date` date NOT NULL,
	`override_reason` text,
	`assigned_by_admin_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `weekly_day_off_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `attendance_blocked_attempts` ADD CONSTRAINT `attendance_blocked_attempts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_blocked_attempts` ADD CONSTRAINT `attendance_blocked_attempts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_created_by_admin_id_admins_id_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_updated_by_admin_id_admins_id_fk` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_id_admins_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_device_registrations` ADD CONSTRAINT `branch_device_registrations_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_setup_links` ADD CONSTRAINT `branch_setup_links_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_setup_links` ADD CONSTRAINT `branch_setup_links_created_by_admin_id_admins_id_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_branch_assignments` ADD CONSTRAINT `employee_branch_assignments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_branch_assignments` ADD CONSTRAINT `employee_branch_assignments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_branch_assignments` ADD CONSTRAINT `employee_branch_assignments_assigned_by_admin_id_admins_id_fk` FOREIGN KEY (`assigned_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_device_registrations` ADD CONSTRAINT `employee_device_registrations_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_files` ADD CONSTRAINT `employee_files_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `month_locks` ADD CONSTRAINT `month_locks_locked_by_admin_id_admins_id_fk` FOREIGN KEY (`locked_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_absences` ADD CONSTRAINT `permission_absences_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_absences` ADD CONSTRAINT `permission_absences_created_by_admin_id_admins_id_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_absences` ADD CONSTRAINT `permission_absences_updated_by_admin_id_admins_id_fk` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salary_history` ADD CONSTRAINT `salary_history_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `salary_history` ADD CONSTRAINT `salary_history_changed_by_admin_id_admins_id_fk` FOREIGN KEY (`changed_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weekly_day_off_assignments` ADD CONSTRAINT `weekly_day_off_assignments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weekly_day_off_assignments` ADD CONSTRAINT `weekly_day_off_assignments_assigned_by_admin_id_admins_id_fk` FOREIGN KEY (`assigned_by_admin_id`) REFERENCES `admins`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_blocked_attempts_employee_id_idx` ON `attendance_blocked_attempts` (`employee_id`);--> statement-breakpoint
CREATE INDEX `attendance_blocked_attempts_occurred_at_utc_idx` ON `attendance_blocked_attempts` (`occurred_at_utc`);--> statement-breakpoint
CREATE INDEX `attendance_sessions_employee_id_idx` ON `attendance_sessions` (`employee_id`);--> statement-breakpoint
CREATE INDEX `attendance_sessions_branch_id_idx` ON `attendance_sessions` (`branch_id`);--> statement-breakpoint
CREATE INDEX `attendance_sessions_check_in_at_utc_idx` ON `attendance_sessions` (`check_in_at_utc`);--> statement-breakpoint
CREATE INDEX `audit_logs_admin_id_idx` ON `audit_logs` (`admin_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_type_idx` ON `audit_logs` (`entity_type`);--> statement-breakpoint
CREATE INDEX `audit_logs_occurred_at_utc_idx` ON `audit_logs` (`occurred_at_utc`);--> statement-breakpoint
CREATE INDEX `branch_device_registrations_branch_id_idx` ON `branch_device_registrations` (`branch_id`);--> statement-breakpoint
CREATE INDEX `branch_setup_links_branch_id_idx` ON `branch_setup_links` (`branch_id`);--> statement-breakpoint
CREATE INDEX `branches_name_idx` ON `branches` (`name`);--> statement-breakpoint
CREATE INDEX `employee_branch_assignments_employee_id_idx` ON `employee_branch_assignments` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employee_branch_assignments_branch_id_idx` ON `employee_branch_assignments` (`branch_id`);--> statement-breakpoint
CREATE INDEX `employee_device_registrations_employee_id_idx` ON `employee_device_registrations` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employee_files_employee_id_idx` ON `employee_files` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employees_full_name_idx` ON `employees` (`full_name`);--> statement-breakpoint
CREATE INDEX `employees_branch_id_idx` ON `employees` (`branch_id`);--> statement-breakpoint
CREATE INDEX `permission_absences_employee_id_idx` ON `permission_absences` (`employee_id`);--> statement-breakpoint
CREATE INDEX `salary_history_employee_id_idx` ON `salary_history` (`employee_id`);--> statement-breakpoint
CREATE INDEX `weekly_day_off_assignments_employee_id_idx` ON `weekly_day_off_assignments` (`employee_id`);--> statement-breakpoint
CREATE INDEX `weekly_day_off_assignments_week_start_date_idx` ON `weekly_day_off_assignments` (`week_start_date`);
