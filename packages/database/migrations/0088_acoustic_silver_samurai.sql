CREATE TABLE `erp_consumable_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`direction` enum('reserve','return') NOT NULL,
	`packages` int NOT NULL,
	`acting_account_id` int NOT NULL,
	`note` varchar(500),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_consumable_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_consumable_transfers_packages_positive` CHECK(`erp_consumable_transfers`.`packages` > 0)
);
--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` DROP CONSTRAINT `erp_service_queue_completion_consistent`;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_usages` DROP FOREIGN KEY `erp_service_usages_ledger_fk`;
--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` DROP FOREIGN KEY `erp_service_queue_line_invoice_branch_fk`;
--> statement-breakpoint
DROP INDEX `erp_service_queue_line_invoice_branch_fk` ON `erp_service_queue_entries`;--> statement-breakpoint
DROP INDEX `erp_service_consumption_reports_queue_current_idx` ON `erp_service_consumption_reports`;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` MODIFY COLUMN `status` enum('pending','completed','overdue','canceled') NOT NULL DEFAULT 'pending';--> statement-breakpoint
UPDATE `erp_service_queue_entries` SET `status` = 'canceled' WHERE `status` = 'pending';--> statement-breakpoint
ALTER TABLE `erp_consumable_ledger_entries` MODIFY COLUMN `source_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_reports` ADD `current_queue_entry_id` int GENERATED ALWAYS AS (case when is_current then service_queue_entry_id else null end) STORED;--> statement-breakpoint
ALTER TABLE `erp_service_consumption_usages` ADD `unit` enum('ml','gm') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_id_service_invoice_branch_unique` UNIQUE(`id`,`service_id`,`invoice_id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_service_consumption_reports` ADD CONSTRAINT `erp_service_consumption_reports_queue_current_unique` UNIQUE(`current_queue_entry_id`);--> statement-breakpoint
ALTER TABLE `erp_consumable_ledger_entries` ADD CONSTRAINT `erp_consumable_ledger_id_product_branch_unique` UNIQUE(`id`,`product_id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_consumable_transfers` ADD CONSTRAINT `erp_consumable_transfers_configuration_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_consumable_configurations`(`product_id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_consumable_transfers` ADD CONSTRAINT `erp_consumable_transfers_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_consumable_transfers_product_created_idx` ON `erp_consumable_transfers` (`product_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_completion_consistent` CHECK ((`erp_service_queue_entries`.`status` in ('pending', 'overdue', 'canceled') and `erp_service_queue_entries`.`completed_at` is null and `erp_service_queue_entries`.`completed_by_account_id` is null) or (`erp_service_queue_entries`.`status` = 'completed' and `erp_service_queue_entries`.`completed_at` is not null and `erp_service_queue_entries`.`completed_by_account_id` is not null));--> statement-breakpoint
ALTER TABLE `erp_consumable_ledger_entries` ADD CONSTRAINT `erp_consumable_ledger_source_consistent` CHECK ((`erp_consumable_ledger_entries`.`entry_type` in ('reserve', 'return') and `erp_consumable_ledger_entries`.`source_type` = 'transfer') or (`erp_consumable_ledger_entries`.`entry_type` in ('consume', 'correction_restore', 'correction_consume') and `erp_consumable_ledger_entries`.`source_type` = 'service_report'));--> statement-breakpoint
ALTER TABLE `erp_service_consumption_usages` ADD CONSTRAINT `erp_service_usages_ledger_fk` FOREIGN KEY (`ledger_entry_id`,`product_id`,`branch_id`) REFERENCES `erp_consumable_ledger_entries`(`id`,`product_id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_line_invoice_branch_fk` FOREIGN KEY (`invoice_line_id`,`service_id`,`invoice_id`,`branch_id`) REFERENCES `erp_invoice_lines`(`id`,`service_id`,`invoice_id`,`branch_id`) ON DELETE no action ON UPDATE no action;
