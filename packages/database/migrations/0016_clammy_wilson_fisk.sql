CREATE TABLE `audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_type` enum('admin','employee','system') NOT NULL,
	`actor_identifier` varchar(128) NOT NULL,
	`action` varchar(64) NOT NULL,
	`module` varchar(64) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(128) NOT NULL,
	`before_state` json,
	`after_state` json,
	`related_ids` json,
	`request_id` varchar(64),
	`ip_address` varchar(45),
	`user_agent` varchar(1024),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_events_module_action_idx` ON `audit_events` (`module`,`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_type`,`actor_identifier`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_request_idx` ON `audit_events` (`request_id`);