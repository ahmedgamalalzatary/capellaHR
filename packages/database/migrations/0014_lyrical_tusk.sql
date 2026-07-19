CREATE TABLE `report_exports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`report_type` enum('branches','employees','devices','shifts','weekly-day-off','attendance','payroll','bonuses','deductions','advances') NOT NULL,
	`status` enum('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
	`filters` json NOT NULL,
	`selection` json NOT NULL,
	`file_path` varchar(500),
	`file_sha256` varchar(64),
	`file_size_bytes` bigint unsigned,
	`row_count` int,
	`attempt_count` int NOT NULL DEFAULT 0,
	`failure_reason` text,
	`queued_at` timestamp(3) NOT NULL,
	`started_at` timestamp(3),
	`completed_at` timestamp(3),
	`failed_at` timestamp(3),
	`file_deleted_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `report_exports_id` PRIMARY KEY(`id`),
	CONSTRAINT `report_exports_attempt_count_nonnegative` CHECK(`report_exports`.`attempt_count` >= 0),
	CONSTRAINT `report_exports_row_count_nonnegative` CHECK(`report_exports`.`row_count` is null or `report_exports`.`row_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `report_exports_status_queue_idx` ON `report_exports` (`status`,`queued_at`,`id`);--> statement-breakpoint
CREATE INDEX `report_exports_type_created_idx` ON `report_exports` (`report_type`,`created_at`);