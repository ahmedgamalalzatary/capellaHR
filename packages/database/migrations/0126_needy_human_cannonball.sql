CREATE TABLE `erp_product_sync_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sender_branch_id` int NOT NULL,
	`receiver_branch_id` int NOT NULL,
	`sender_product_id` int NOT NULL,
	`reason` enum('name_clash','copy_failed') NOT NULL,
	`settled_by_account_id` int,
	`settled_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_product_sync_issues_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_product_sync_issues_unique` UNIQUE(`sender_branch_id`,`receiver_branch_id`,`sender_product_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_product_sync_issues` ADD CONSTRAINT `erp_product_sync_issues_sender_fk` FOREIGN KEY (`sender_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_sync_issues` ADD CONSTRAINT `erp_product_sync_issues_receiver_fk` FOREIGN KEY (`receiver_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_sync_issues` ADD CONSTRAINT `erp_product_sync_issues_product_fk` FOREIGN KEY (`sender_product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_sync_issues` ADD CONSTRAINT `erp_product_sync_issues_settled_by_fk` FOREIGN KEY (`settled_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_product_sync_issues_settled_idx` ON `erp_product_sync_issues` (`settled_at`);