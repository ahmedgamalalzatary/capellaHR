CREATE TABLE `erp_branch_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sender_branch_id` int NOT NULL,
	`receiver_branch_id` int NOT NULL,
	`state` enum('pending','active') NOT NULL DEFAULT 'pending',
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_branch_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_branch_links_pair_unique` UNIQUE(`sender_branch_id`,`receiver_branch_id`),
	CONSTRAINT `erp_branch_links_distinct` CHECK(`erp_branch_links`.`sender_branch_id` <> `erp_branch_links`.`receiver_branch_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_product_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sender_branch_id` int NOT NULL,
	`receiver_branch_id` int NOT NULL,
	`sender_product_id` int NOT NULL,
	`receiver_product_id` int,
	`state` enum('linked','excluded') NOT NULL,
	`not_same_as_product_id` int,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_product_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_product_links_sender_unique` UNIQUE(`sender_branch_id`,`receiver_branch_id`,`sender_product_id`),
	CONSTRAINT `erp_product_links_receiver_unique` UNIQUE(`sender_branch_id`,`receiver_branch_id`,`receiver_product_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_branch_links` ADD CONSTRAINT `erp_branch_links_sender_fk` FOREIGN KEY (`sender_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_branch_links` ADD CONSTRAINT `erp_branch_links_receiver_fk` FOREIGN KEY (`receiver_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_links` ADD CONSTRAINT `erp_product_links_sender_product_fk` FOREIGN KEY (`sender_product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_links` ADD CONSTRAINT `erp_product_links_receiver_product_fk` FOREIGN KEY (`receiver_product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_product_links` ADD CONSTRAINT `erp_product_links_not_same_product_fk` FOREIGN KEY (`not_same_as_product_id`) REFERENCES `erp_products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_product_links_sender_product_idx` ON `erp_product_links` (`sender_product_id`);--> statement-breakpoint
CREATE INDEX `erp_product_links_receiver_product_idx` ON `erp_product_links` (`receiver_product_id`);