CREATE TABLE `attendance_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_type` enum('automatic_timeout','absence_generation') NOT NULL,
	`session_id` int,
	`attendance_date` date,
	`status` enum('scheduled','processing','completed','failed') NOT NULL DEFAULT 'scheduled',
	`run_at` timestamp(3) NOT NULL,
	`attempt_count` int NOT NULL DEFAULT 0,
	`last_error` varchar(1000),
	`started_at` timestamp(3),
	`completed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `attendance_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_jobs_session_unique` UNIQUE(`session_id`),
	CONSTRAINT `attendance_jobs_absence_date_unique` UNIQUE(`attendance_date`),
	CONSTRAINT `attendance_jobs_attempt_count_nonnegative` CHECK(`attendance_jobs`.`attempt_count` >= 0),
	CONSTRAINT `attendance_jobs_payload_state` CHECK((`attendance_jobs`.`job_type` = 'automatic_timeout' and `attendance_jobs`.`session_id` is not null and `attendance_jobs`.`attendance_date` is null) or (`attendance_jobs`.`job_type` = 'absence_generation' and `attendance_jobs`.`session_id` is null and `attendance_jobs`.`attendance_date` is not null)),
	CONSTRAINT `attendance_jobs_execution_state` CHECK((`attendance_jobs`.`status` = 'scheduled' and `attendance_jobs`.`started_at` is null and `attendance_jobs`.`completed_at` is null) or (`attendance_jobs`.`status` = 'processing' and `attendance_jobs`.`started_at` is not null and `attendance_jobs`.`completed_at` is null) or (`attendance_jobs`.`status` = 'completed' and `attendance_jobs`.`completed_at` is not null) or (`attendance_jobs`.`status` = 'failed' and `attendance_jobs`.`started_at` is not null and `attendance_jobs`.`completed_at` is null and `attendance_jobs`.`last_error` is not null))
);
--> statement-breakpoint
ALTER TABLE `attendance_jobs` ADD CONSTRAINT `attendance_jobs_session_id_attendance_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendance_jobs_claim_idx` ON `attendance_jobs` (`status`,`run_at`,`id`);