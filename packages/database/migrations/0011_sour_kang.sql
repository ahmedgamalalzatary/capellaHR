CREATE TABLE `attendance_daily_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`attendance_date` date NOT NULL,
	`status` enum('absence','weekly_day_off') NOT NULL DEFAULT 'absence',
	`absence_required_minutes` int NOT NULL,
	`day_off_converted_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `attendance_daily_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_daily_records_employee_date_unique` UNIQUE(`employee_id`,`attendance_date`),
	CONSTRAINT `attendance_daily_records_required_minutes_range` CHECK(`attendance_daily_records`.`absence_required_minutes` between 1 and 720),
	CONSTRAINT `attendance_daily_records_conversion_state` CHECK((`attendance_daily_records`.`status` = 'absence' and `attendance_daily_records`.`day_off_converted_at` is null) or (`attendance_daily_records`.`status` = 'weekly_day_off' and `attendance_daily_records`.`day_off_converted_at` is not null))
);
--> statement-breakpoint
ALTER TABLE `attendance_daily_records` ADD CONSTRAINT `attendance_daily_records_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_daily_records_status_date_idx` ON `attendance_daily_records` (`status`,`attendance_date`);