CREATE TABLE `erp_purchase_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`purchase_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`product_id` int NOT NULL,
	`product_name_snapshot` varchar(255) NOT NULL,
	`quantity` int NOT NULL,
	`unit_cost` decimal(12,2) NOT NULL,
	`previous_unit_cost` decimal(12,2) NOT NULL,
	`line_total` decimal(12,2) NOT NULL,
	CONSTRAINT `erp_purchase_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_purchase_lines_purchase_product_unique` UNIQUE(`purchase_id`,`product_id`),
	CONSTRAINT `erp_purchase_lines_quantity_positive` CHECK(`erp_purchase_lines`.`quantity` > 0),
	CONSTRAINT `erp_purchase_lines_unit_cost_positive` CHECK(`erp_purchase_lines`.`unit_cost` > 0),
	CONSTRAINT `erp_purchase_lines_previous_cost_nonnegative` CHECK(`erp_purchase_lines`.`previous_unit_cost` >= 0),
	CONSTRAINT `erp_purchase_lines_total_positive` CHECK(`erp_purchase_lines`.`line_total` > 0),
	CONSTRAINT `erp_purchase_lines_total_exact` CHECK(`erp_purchase_lines`.`line_total` = `erp_purchase_lines`.`unit_cost` * `erp_purchase_lines`.`quantity`)
);
--> statement-breakpoint
CREATE TABLE `erp_purchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`supplier_id` int NOT NULL,
	`supplier_name_snapshot` varchar(255) NOT NULL,
	`idempotency_key` varchar(36) NOT NULL,
	`idempotency_fingerprint` varchar(64) NOT NULL,
	`status` enum('posting','posted','cancelled') NOT NULL DEFAULT 'posting',
	`purchase_date` date NOT NULL,
	`total` decimal(12,2) NOT NULL,
	`acting_account_id` int NOT NULL,
	`cancelled_at` timestamp(3),
	`cancelled_by_account_id` int,
	`cancellation_reason` varchar(500),
	`corrects_purchase_id` int,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_purchases_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_purchases_id_branch_unique` UNIQUE(`id`,`branch_id`),
	CONSTRAINT `erp_purchases_idempotency_unique` UNIQUE(`idempotency_key`),
	CONSTRAINT `erp_purchases_correction_unique` UNIQUE(`corrects_purchase_id`),
	CONSTRAINT `erp_purchases_total_positive` CHECK(`erp_purchases`.`total` > 0),
	CONSTRAINT `erp_purchases_cancellation_consistent` CHECK((`erp_purchases`.`status` in ('posting', 'posted') and `erp_purchases`.`cancelled_at` is null and `erp_purchases`.`cancelled_by_account_id` is null and `erp_purchases`.`cancellation_reason` is null) or (`erp_purchases`.`status` = 'cancelled' and `erp_purchases`.`cancelled_at` is not null and `erp_purchases`.`cancelled_by_account_id` is not null and `erp_purchases`.`cancellation_reason` is not null))
);
--> statement-breakpoint
CREATE TABLE `erp_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_normalized` varchar(64) NOT NULL,
	`phone` varchar(50),
	`notes` varchar(1000),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_suppliers_id_branch_unique` UNIQUE(`id`,`branch_id`),
	CONSTRAINT `erp_suppliers_branch_name_unique` UNIQUE(`branch_id`,`name_normalized`)
);
--> statement-breakpoint
ALTER TABLE `erp_stock_movements` DROP CONSTRAINT `erp_stock_movements_reason_source_consistent`;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` DROP CONSTRAINT `erp_stock_movements_direction_consistent`;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` MODIFY COLUMN `reason` enum('opening_stock','count_correction','wastage','damage','sale','purchase','purchase_cancellation','refund','void') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` MODIFY COLUMN `source_type` enum('adjustment','sale','purchase','purchase_cancellation','refund','void') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_purchase_lines` ADD CONSTRAINT `erp_purchase_lines_purchase_branch_fk` FOREIGN KEY (`purchase_id`,`branch_id`) REFERENCES `erp_purchases`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchase_lines` ADD CONSTRAINT `erp_purchase_lines_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchases` ADD CONSTRAINT `erp_purchases_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchases` ADD CONSTRAINT `erp_purchases_acting_account_id_accounts_id_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchases` ADD CONSTRAINT `erp_purchases_cancelled_by_account_id_accounts_id_fk` FOREIGN KEY (`cancelled_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchases` ADD CONSTRAINT `erp_purchases_supplier_branch_fk` FOREIGN KEY (`supplier_id`,`branch_id`) REFERENCES `erp_suppliers`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_purchases` ADD CONSTRAINT `erp_purchases_correction_fk` FOREIGN KEY (`corrects_purchase_id`,`branch_id`) REFERENCES `erp_purchases`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_suppliers` ADD CONSTRAINT `erp_suppliers_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_purchase_lines_product_idx` ON `erp_purchase_lines` (`product_id`,`purchase_id`);--> statement-breakpoint
CREATE INDEX `erp_purchases_branch_date_idx` ON `erp_purchases` (`branch_id`,`purchase_date`);--> statement-breakpoint
CREATE INDEX `erp_purchases_supplier_date_idx` ON `erp_purchases` (`supplier_id`,`purchase_date`);--> statement-breakpoint
CREATE INDEX `erp_suppliers_branch_active_idx` ON `erp_suppliers` (`branch_id`,`is_active`);--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `erp_stock_movements_reason_source_consistent` CHECK ((`erp_stock_movements`.`reason` in ('opening_stock', 'count_correction', 'wastage', 'damage') and `erp_stock_movements`.`source_type` = 'adjustment') or (`erp_stock_movements`.`reason` in ('sale', 'purchase', 'purchase_cancellation', 'refund', 'void') and `erp_stock_movements`.`reason` = `erp_stock_movements`.`source_type`));--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `erp_stock_movements_direction_consistent` CHECK (`erp_stock_movements`.`reason` = 'count_correction' or (`erp_stock_movements`.`reason` in ('wastage', 'damage', 'sale', 'purchase_cancellation') and `erp_stock_movements`.`quantity_delta` < 0) or (`erp_stock_movements`.`reason` in ('opening_stock', 'purchase', 'refund', 'void') and `erp_stock_movements`.`quantity_delta` > 0));
--> statement-breakpoint
CREATE TRIGGER `erp_purchases_validate_correction_insert`
BEFORE INSERT ON `erp_purchases`
FOR EACH ROW
BEGIN
  IF NEW.corrects_purchase_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `erp_purchases` WHERE `id` = NEW.corrects_purchase_id AND `branch_id` = NEW.branch_id AND `status` = 'cancelled'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase corrections require a cancelled purchase';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_purchase_lines_restrict_insert`
BEFORE INSERT ON `erp_purchase_lines`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `erp_purchases` WHERE `id` = NEW.purchase_id AND `branch_id` = NEW.branch_id) <> 'posting' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase lines may only be inserted while posting';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_purchases_restrict_update`
BEFORE UPDATE ON `erp_purchases`
FOR EACH ROW
BEGIN
  IF NOT (OLD.id <=> NEW.id) OR NOT (OLD.branch_id <=> NEW.branch_id)
    OR NOT (OLD.supplier_id <=> NEW.supplier_id) OR NOT (OLD.supplier_name_snapshot <=> NEW.supplier_name_snapshot)
    OR NOT (OLD.idempotency_key <=> NEW.idempotency_key) OR NOT (OLD.idempotency_fingerprint <=> NEW.idempotency_fingerprint)
    OR NOT (OLD.purchase_date <=> NEW.purchase_date) OR NOT (OLD.total <=> NEW.total)
    OR NOT (OLD.acting_account_id <=> NEW.acting_account_id) OR NOT (OLD.corrects_purchase_id <=> NEW.corrects_purchase_id)
    OR NOT (OLD.created_at <=> NEW.created_at)
    OR NOT ((OLD.status = 'posting' AND NEW.status = 'posted'
        AND NEW.cancelled_at IS NULL AND NEW.cancelled_by_account_id IS NULL AND NEW.cancellation_reason IS NULL
        AND EXISTS (SELECT 1 FROM `erp_purchase_lines` WHERE `purchase_id` = OLD.id AND `branch_id` = OLD.branch_id)
        AND NEW.total = (SELECT SUM(`line_total`) FROM `erp_purchase_lines` WHERE `purchase_id` = OLD.id AND `branch_id` = OLD.branch_id))
      OR (OLD.status = 'posted' AND NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by_account_id IS NOT NULL AND NEW.cancellation_reason IS NOT NULL)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchases are immutable except valid posting completion and one cancellation';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_purchases_reject_delete`
BEFORE DELETE ON `erp_purchases`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchases are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_purchase_lines_reject_update`
BEFORE UPDATE ON `erp_purchase_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase lines are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_purchase_lines_reject_delete`
BEFORE DELETE ON `erp_purchase_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase lines are immutable';
