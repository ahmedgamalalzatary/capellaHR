CREATE TABLE `erp_product_stocks` (
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_product_stocks_product_branch_unique` UNIQUE(`product_id`,`branch_id`),
	CONSTRAINT `erp_product_stocks_quantity_nonnegative` CHECK(`erp_product_stocks`.`quantity` >= 0)
);
--> statement-breakpoint
CREATE TABLE `erp_stock_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`reason` enum('opening_stock','count_correction','wastage','damage','sale','purchase','refund','void') NOT NULL,
	`source_type` enum('adjustment','sale','purchase','refund','void') NOT NULL,
	`source_id` int,
	`quantity_delta` int NOT NULL,
	`balance_after` int NOT NULL,
	`acting_account_id` int NOT NULL,
	`note` varchar(500),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_stock_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_stock_movements_delta_nonzero` CHECK(`erp_stock_movements`.`quantity_delta` <> 0),
	CONSTRAINT `erp_stock_movements_balance_nonnegative` CHECK(`erp_stock_movements`.`balance_after` >= 0),
	CONSTRAINT `erp_stock_movements_source_consistent` CHECK((`erp_stock_movements`.`source_type` = 'adjustment' and `erp_stock_movements`.`source_id` is null) or (`erp_stock_movements`.`source_type` <> 'adjustment' and `erp_stock_movements`.`source_id` is not null)),
	CONSTRAINT `erp_stock_movements_reason_source_consistent` CHECK((`erp_stock_movements`.`reason` in ('opening_stock', 'count_correction', 'wastage', 'damage') and `erp_stock_movements`.`source_type` = 'adjustment') or (`erp_stock_movements`.`reason` in ('sale', 'purchase', 'refund', 'void') and `erp_stock_movements`.`reason` = `erp_stock_movements`.`source_type`)),
	CONSTRAINT `erp_stock_movements_direction_consistent` CHECK(`erp_stock_movements`.`reason` = 'count_correction' or (`erp_stock_movements`.`reason` in ('wastage', 'damage', 'sale') and `erp_stock_movements`.`quantity_delta` < 0) or (`erp_stock_movements`.`reason` in ('opening_stock', 'purchase', 'refund', 'void') and `erp_stock_movements`.`quantity_delta` > 0))
);
--> statement-breakpoint
ALTER TABLE `erp_product_stocks` ADD CONSTRAINT `erp_product_stocks_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO `erp_product_stocks` (`product_id`, `branch_id`, `quantity`, `updated_at`)
SELECT `id`, `branch_id`, 0, UTC_TIMESTAMP(3) FROM `erp_products`;
--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `erp_stock_movements_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `erp_stock_movements_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_product_stocks_branch_quantity_idx` ON `erp_product_stocks` (`branch_id`,`quantity`);--> statement-breakpoint
CREATE INDEX `erp_stock_movements_product_created_idx` ON `erp_stock_movements` (`product_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `erp_stock_movements_branch_created_idx` ON `erp_stock_movements` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `erp_stock_movements_source_idx` ON `erp_stock_movements` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE TRIGGER `erp_stock_movements_reject_update`
BEFORE UPDATE ON `erp_stock_movements`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stock movements are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_stock_movements_reject_delete`
BEFORE DELETE ON `erp_stock_movements`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stock movements are immutable';
