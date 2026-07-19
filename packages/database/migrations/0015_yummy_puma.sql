ALTER TABLE `report_exports` ADD `cycle_attempt_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `report_exports` ADD `retry_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `report_exports` SET `cycle_attempt_count` = LEAST(`attempt_count`, 3);--> statement-breakpoint
ALTER TABLE `report_exports` ADD CONSTRAINT `report_exports_cycle_attempt_count_bounded` CHECK (`report_exports`.`cycle_attempt_count` >= 0 and `report_exports`.`cycle_attempt_count` <= 3);--> statement-breakpoint
ALTER TABLE `report_exports` ADD CONSTRAINT `report_exports_retry_count_nonnegative` CHECK (`report_exports`.`retry_count` >= 0);
