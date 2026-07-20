CREATE TABLE `attendance_denied_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_type` enum('check_in','check_out') NOT NULL,
	`claimed_employee_code` int NOT NULL,
	`employee_id` int,
	`source` enum('personal_device','branch_device') NOT NULL,
	`device_id` int,
	`occurred_at` timestamp(3) NOT NULL,
	`latitude` double,
	`longitude` double,
	`gps_accuracy_meters` double,
	`distance_meters` double,
	`branch_latitude` double,
	`branch_longitude` double,
	`branch_radius_meters` double,
	`failure_reason` varchar(64) NOT NULL,
	`suspicious` boolean NOT NULL DEFAULT false,
	`approved_at` timestamp(3),
	`approved_session_id` int,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `attendance_denied_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_denied_attempts_id_owner_type_unique` UNIQUE(`id`,`employee_id`,`event_type`),
	CONSTRAINT `attendance_denied_attempts_code_positive` CHECK(`attendance_denied_attempts`.`claimed_employee_code` > 0),
	CONSTRAINT `attendance_denied_attempts_approval_state` CHECK((`attendance_denied_attempts`.`approved_at` is null and `attendance_denied_attempts`.`approved_session_id` is null) or (`attendance_denied_attempts`.`approved_at` is not null and `attendance_denied_attempts`.`approved_session_id` is not null and `attendance_denied_attempts`.`employee_id` is not null))
);
--> statement-breakpoint
CREATE TABLE `attendance_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` int NOT NULL,
	`employee_id` int NOT NULL,
	`event_type` enum('check_in','check_out') NOT NULL,
	`source` enum('personal_device','branch_device','admin_manual','admin_approved_denied','automatic_timeout') NOT NULL,
	`device_id` int,
	`occurred_at` timestamp(3) NOT NULL,
	`latitude` double,
	`longitude` double,
	`gps_accuracy_meters` double,
	`distance_meters` double,
	`branch_latitude` double,
	`branch_longitude` double,
	`branch_radius_meters` double,
	`approved_denied_attempt_id` int,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `attendance_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_events_session_type_unique` UNIQUE(`session_id`,`event_type`),
	CONSTRAINT `attendance_events_approval_source_state` CHECK((`attendance_events`.`source` = 'admin_approved_denied' and `attendance_events`.`approved_denied_attempt_id` is not null) or (`attendance_events`.`source` <> 'admin_approved_denied' and `attendance_events`.`approved_denied_attempt_id` is null))
);
--> statement-breakpoint
CREATE TABLE `attendance_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`attendance_date` date NOT NULL,
	`required_minutes` int NOT NULL,
	`check_in_at` timestamp(3) NOT NULL,
	`check_out_at` timestamp(3),
	`open_employee_id` int GENERATED ALWAYS AS (case when check_out_at is null then employee_id else null end) STORED,
	`worked_minutes` int,
	`overtime_minutes` int,
	`shortage_minutes` int,
	`automatic_timeout_at` timestamp(3),
	`automatic_timeout_corrected_at` timestamp(3),
	`flagged` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `attendance_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_sessions_employee_date_unique` UNIQUE(`employee_id`,`attendance_date`),
	CONSTRAINT `attendance_sessions_id_employee_date_unique` UNIQUE(`id`,`employee_id`,`attendance_date`),
	CONSTRAINT `attendance_sessions_open_employee_unique` UNIQUE(`open_employee_id`),
	CONSTRAINT `attendance_sessions_required_minutes_range` CHECK(`attendance_sessions`.`required_minutes` between 1 and 720),
	CONSTRAINT `attendance_sessions_checkout_state` CHECK((`attendance_sessions`.`check_out_at` is null and `attendance_sessions`.`worked_minutes` is null and `attendance_sessions`.`overtime_minutes` is null and `attendance_sessions`.`shortage_minutes` is null) or (`attendance_sessions`.`check_out_at` is not null and `attendance_sessions`.`check_out_at` > `attendance_sessions`.`check_in_at` and `attendance_sessions`.`worked_minutes` >= 0 and `attendance_sessions`.`overtime_minutes` >= 0 and `attendance_sessions`.`shortage_minutes` >= 0))
);
--> statement-breakpoint
ALTER TABLE `attendance_daily_records` DROP CONSTRAINT `attendance_daily_records_conversion_state`;--> statement-breakpoint
ALTER TABLE `attendance_daily_records` MODIFY COLUMN `status` enum('absence','weekly_day_off','attendance_replaced') NOT NULL DEFAULT 'absence';--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD `replaced_by_session_id` int;--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD `replaced_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `attendance_denied_attempts` ADD CONSTRAINT `attendance_denied_attempts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_denied_attempts` ADD CONSTRAINT `attendance_denied_attempts_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_denied_attempts` ADD CONSTRAINT `attendance_denied_attempts_approved_owner_fk` FOREIGN KEY (`approved_session_id`,`employee_id`) REFERENCES `attendance_sessions`(`id`,`employee_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_approved_attempt_owner_fk` FOREIGN KEY (`approved_denied_attempt_id`,`employee_id`,`event_type`) REFERENCES `attendance_denied_attempts`(`id`,`employee_id`,`event_type`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_session_owner_fk` FOREIGN KEY (`session_id`,`employee_id`) REFERENCES `attendance_sessions`(`id`,`employee_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_denied_attempts_employee_date_idx` ON `attendance_denied_attempts` (`employee_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `attendance_denied_attempts_review_idx` ON `attendance_denied_attempts` (`approved_at`,`suspicious`);--> statement-breakpoint
CREATE INDEX `attendance_events_employee_occurred_idx` ON `attendance_events` (`employee_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD CONSTRAINT `attendance_daily_records_conversion_state` CHECK ((`attendance_daily_records`.`status` = 'absence' and `attendance_daily_records`.`day_off_converted_at` is null and `attendance_daily_records`.`replaced_by_session_id` is null and `attendance_daily_records`.`replaced_at` is null) or (`attendance_daily_records`.`status` = 'weekly_day_off' and `attendance_daily_records`.`day_off_converted_at` is not null and `attendance_daily_records`.`replaced_by_session_id` is null and `attendance_daily_records`.`replaced_at` is null) or (`attendance_daily_records`.`status` = 'attendance_replaced' and `attendance_daily_records`.`day_off_converted_at` is null and `attendance_daily_records`.`replaced_by_session_id` is not null and `attendance_daily_records`.`replaced_at` is not null));--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD CONSTRAINT `attendance_daily_records_replaced_owner_fk` FOREIGN KEY (`replaced_by_session_id`,`employee_id`,`attendance_date`) REFERENCES `attendance_sessions`(`id`,`employee_id`,`attendance_date`) ON DELETE no action ON UPDATE no action;