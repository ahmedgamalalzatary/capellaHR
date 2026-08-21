CREATE TABLE `erp_fixed_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`quantity` int,
	`unit_price` decimal(12,2),
	`location` varchar(255) NOT NULL DEFAULT '',
	`note` varchar(1000) NOT NULL DEFAULT '',
	`purchased_on` date,
	`condition` enum('good','needs_repair','broken'),
	`acting_account_id` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_fixed_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_fixed_assets_name_present` CHECK(CHAR_LENGTH(TRIM(`erp_fixed_assets`.`name`)) > 0),
	CONSTRAINT `erp_fixed_assets_quantity_positive` CHECK(`erp_fixed_assets`.`quantity` is null or `erp_fixed_assets`.`quantity` > 0),
	CONSTRAINT `erp_fixed_assets_unit_price_nonnegative` CHECK(`erp_fixed_assets`.`unit_price` is null or `erp_fixed_assets`.`unit_price` >= 0)
);
--> statement-breakpoint
ALTER TABLE `erp_fixed_assets` ADD CONSTRAINT `erp_fixed_assets_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_fixed_assets` ADD CONSTRAINT `erp_fixed_assets_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_fixed_assets_branch_idx` ON `erp_fixed_assets` (`branch_id`,`id`);