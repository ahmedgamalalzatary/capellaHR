CREATE TABLE `erp_service_consumption_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_queue_entry_id` int NOT NULL,
	`revision` int NOT NULL,
	`replaces_report_id` int,
	`is_current` boolean NOT NULL DEFAULT true,
	`completion_kind` enum('consumables','none') NOT NULL,
	`reason` varchar(1000),
	`acting_account_id` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_service_consumption_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_service_consumption_reports_queue_revision_unique` UNIQUE(`service_queue_entry_id`,`revision`),
	CONSTRAINT `erp_service_consumption_reports_revision_positive` CHECK(`erp_service_consumption_reports`.`revision` > 0),
	CONSTRAINT `erp_service_consumption_reports_revision_consistent` CHECK((`erp_service_consumption_reports`.`revision` = 1 and `erp_service_consumption_reports`.`replaces_report_id` is null and `erp_service_consumption_reports`.`reason` is null) or (`erp_service_consumption_reports`.`revision` > 1 and `erp_service_consumption_reports`.`replaces_report_id` is not null and char_length(trim(`erp_service_consumption_reports`.`reason`)) > 0))
);
--> statement-breakpoint
CREATE TABLE `erp_service_consumption_usages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`report_id` int NOT NULL,
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`quantity` decimal(16,3) NOT NULL,
	`unit_cost_snapshot` decimal(16,6) NOT NULL,
	`total_cost` decimal(16,2) NOT NULL,
	`ledger_entry_id` int NOT NULL,
	CONSTRAINT `erp_service_consumption_usages_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_service_consumption_usages_report_product_unique` UNIQUE(`report_id`,`product_id`),
	CONSTRAINT `erp_service_consumption_usages_ledger_unique` UNIQUE(`ledger_entry_id`),
	CONSTRAINT `erp_service_consumption_usages_quantity_positive` CHECK(`erp_service_consumption_usages`.`quantity` > 0),
	CONSTRAINT `erp_service_consumption_usages_cost_nonnegative` CHECK(`erp_service_consumption_usages`.`unit_cost_snapshot` >= 0 and `erp_service_consumption_usages`.`total_cost` >= 0)
);
--> statement-breakpoint
CREATE TABLE `erp_consumable_balances` (
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`quantity` decimal(16,3) NOT NULL DEFAULT '0.000',
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_consumable_balances_product_branch_unique` UNIQUE(`product_id`,`branch_id`),
	CONSTRAINT `erp_consumable_balances_quantity_nonnegative` CHECK(`erp_consumable_balances`.`quantity` >= 0)
);
--> statement-breakpoint
CREATE TABLE `erp_consumable_configurations` (
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`unit` enum('ml','gm') NOT NULL,
	`package_size` decimal(14,3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_consumable_configurations_product_branch_unique` UNIQUE(`product_id`,`branch_id`),
	CONSTRAINT `erp_consumable_configurations_package_size_positive` CHECK(`erp_consumable_configurations`.`package_size` > 0)
);
--> statement-breakpoint
CREATE TABLE `erp_consumable_ledger_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`entry_type` enum('reserve','return','consume','correction_restore','correction_consume') NOT NULL,
	`quantity_delta` decimal(16,3) NOT NULL,
	`balance_after` decimal(16,3) NOT NULL,
	`unit_cost_snapshot` decimal(16,6) NOT NULL,
	`total_cost` decimal(16,2) NOT NULL,
	`source_type` enum('transfer','service_report') NOT NULL,
	`source_id` int,
	`acting_account_id` int NOT NULL,
	`note` varchar(500),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_consumable_ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_consumable_ledger_delta_nonzero` CHECK(`erp_consumable_ledger_entries`.`quantity_delta` <> 0),
	CONSTRAINT `erp_consumable_ledger_balance_nonnegative` CHECK(`erp_consumable_ledger_entries`.`balance_after` >= 0),
	CONSTRAINT `erp_consumable_ledger_cost_consistent` CHECK(`erp_consumable_ledger_entries`.`unit_cost_snapshot` >= 0 and `erp_consumable_ledger_entries`.`total_cost` >= 0),
	CONSTRAINT `erp_consumable_ledger_direction_consistent` CHECK((`erp_consumable_ledger_entries`.`entry_type` in ('reserve', 'correction_restore') and `erp_consumable_ledger_entries`.`quantity_delta` > 0) or (`erp_consumable_ledger_entries`.`entry_type` in ('return', 'consume', 'correction_consume') and `erp_consumable_ledger_entries`.`quantity_delta` < 0))
);
--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD `status` enum('pending','completed','overdue') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD `completed_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD `completed_by_account_id` int;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_reports` ADD CONSTRAINT `erp_service_reports_queue_fk` FOREIGN KEY (`service_queue_entry_id`) REFERENCES `erp_service_queue_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_reports` ADD CONSTRAINT `erp_service_reports_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_reports` ADD CONSTRAINT `erp_service_consumption_reports_replaces_fk` FOREIGN KEY (`replaces_report_id`) REFERENCES `erp_service_consumption_reports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_usages` ADD CONSTRAINT `erp_service_usages_report_fk` FOREIGN KEY (`report_id`) REFERENCES `erp_service_consumption_reports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_usages` ADD CONSTRAINT `erp_service_usages_ledger_fk` FOREIGN KEY (`ledger_entry_id`) REFERENCES `erp_consumable_ledger_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_usages` ADD CONSTRAINT `erp_service_consumption_usages_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_consumable_balances` ADD CONSTRAINT `erp_consumable_balances_configuration_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_consumable_configurations`(`product_id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_consumable_configurations` ADD CONSTRAINT `erp_consumable_configurations_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_consumable_ledger_entries` ADD CONSTRAINT `erp_consumable_ledger_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_consumable_configurations`(`product_id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_consumable_ledger_entries` ADD CONSTRAINT `erp_consumable_ledger_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_service_consumption_reports_queue_current_idx` ON `erp_service_consumption_reports` (`service_queue_entry_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `erp_consumable_balances_branch_quantity_idx` ON `erp_consumable_balances` (`branch_id`,`quantity`);--> statement-breakpoint
CREATE INDEX `erp_consumable_ledger_product_created_idx` ON `erp_consumable_ledger_entries` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `erp_consumable_ledger_branch_created_idx` ON `erp_consumable_ledger_entries` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `erp_consumable_ledger_source_idx` ON `erp_consumable_ledger_entries` (`source_type`,`source_id`);--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_completion_consistent` CHECK ((`erp_service_queue_entries`.`status` in ('pending', 'overdue') and `erp_service_queue_entries`.`completed_at` is null and `erp_service_queue_entries`.`completed_by_account_id` is null) or (`erp_service_queue_entries`.`status` = 'completed' and `erp_service_queue_entries`.`completed_at` is not null and `erp_service_queue_entries`.`completed_by_account_id` is not null));--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_entries_completed_by_account_id_accounts_id_fk` FOREIGN KEY (`completed_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;
