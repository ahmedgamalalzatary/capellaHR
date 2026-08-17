CREATE TABLE `erp_stock_transfer_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`transfer_id` int NOT NULL,
	`source_branch_id` int NOT NULL,
	`destination_branch_id` int NOT NULL,
	`source_product_id` int NOT NULL,
	`destination_product_id` int NOT NULL,
	`product_name_snapshot` varchar(255) NOT NULL,
	`quantity` int NOT NULL,
	`unit_cost` decimal(12,2) NOT NULL,
	`previous_destination_cost` decimal(12,2) NOT NULL,
	`line_total` decimal(14,2) NOT NULL,
	CONSTRAINT `erp_stock_transfer_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_stock_transfer_lines_transfer_product_unique` UNIQUE(`transfer_id`,`source_product_id`),
	CONSTRAINT `erp_stock_transfer_lines_quantity_positive` CHECK(`erp_stock_transfer_lines`.`quantity` > 0),
	CONSTRAINT `erp_stock_transfer_lines_cost_nonnegative` CHECK(`erp_stock_transfer_lines`.`unit_cost` >= 0 and `erp_stock_transfer_lines`.`previous_destination_cost` >= 0),
	CONSTRAINT `erp_stock_transfer_lines_total_exact` CHECK(`erp_stock_transfer_lines`.`line_total` = `erp_stock_transfer_lines`.`unit_cost` * `erp_stock_transfer_lines`.`quantity`)
);
--> statement-breakpoint
CREATE TABLE `erp_stock_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_branch_id` int NOT NULL,
	`destination_branch_id` int NOT NULL,
	`invoice_id` int,
	`idempotency_key` varchar(36) NOT NULL,
	`status` enum('posting','posted') NOT NULL DEFAULT 'posting',
	`transfer_date` date NOT NULL,
	`total_cost` decimal(14,2) NOT NULL,
	`acting_account_id` int NOT NULL,
	`note` varchar(500),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_stock_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_stock_transfers_idempotency_unique` UNIQUE(`idempotency_key`),
	CONSTRAINT `erp_stock_transfers_id_source_unique` UNIQUE(`id`,`source_branch_id`),
	CONSTRAINT `erp_stock_transfers_id_destination_unique` UNIQUE(`id`,`destination_branch_id`),
	CONSTRAINT `erp_stock_transfers_branches_differ` CHECK(`erp_stock_transfers`.`source_branch_id` <> `erp_stock_transfers`.`destination_branch_id`),
	CONSTRAINT `erp_stock_transfers_total_nonnegative` CHECK(`erp_stock_transfers`.`total_cost` >= 0),
	CONSTRAINT `erp_stock_transfers_posted_has_invoice` CHECK(`erp_stock_transfers`.`status` = 'posting' or `erp_stock_transfers`.`invoice_id` is not null)
);
--> statement-breakpoint
ALTER TABLE `erp_stock_movements` DROP CONSTRAINT `erp_stock_movements_reason_source_consistent`;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` DROP CONSTRAINT `erp_stock_movements_direction_consistent`;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` MODIFY COLUMN `reason` enum('opening_stock','count_correction','wastage','damage','sale','purchase','purchase_cancellation','refund','void','transfer_in') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` MODIFY COLUMN `source_type` enum('adjustment','sale','purchase','purchase_cancellation','refund','void','transfer_in') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_stock_transfer_lines` ADD CONSTRAINT `erp_stock_transfer_lines_transfer_fk` FOREIGN KEY (`transfer_id`,`source_branch_id`) REFERENCES `erp_stock_transfers`(`id`,`source_branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_transfer_lines` ADD CONSTRAINT `erp_stock_transfer_lines_source_product_fk` FOREIGN KEY (`source_product_id`,`source_branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_transfer_lines` ADD CONSTRAINT `erp_stock_transfer_lines_destination_product_fk` FOREIGN KEY (`destination_product_id`,`destination_branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_transfers` ADD CONSTRAINT `erp_stock_transfers_source_branch_id_branches_id_fk` FOREIGN KEY (`source_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_transfers` ADD CONSTRAINT `erp_stock_transfers_destination_branch_id_branches_id_fk` FOREIGN KEY (`destination_branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_transfers` ADD CONSTRAINT `erp_stock_transfers_acting_account_id_accounts_id_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_transfers` ADD CONSTRAINT `erp_stock_transfers_invoice_branch_fk` FOREIGN KEY (`invoice_id`,`source_branch_id`) REFERENCES `erp_invoices`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_stock_transfer_lines_destination_product_idx` ON `erp_stock_transfer_lines` (`destination_product_id`,`transfer_id`);--> statement-breakpoint
CREATE INDEX `erp_stock_transfers_source_date_idx` ON `erp_stock_transfers` (`source_branch_id`,`transfer_date`);--> statement-breakpoint
CREATE INDEX `erp_stock_transfers_destination_date_idx` ON `erp_stock_transfers` (`destination_branch_id`,`transfer_date`);--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `erp_stock_movements_reason_source_consistent` CHECK ((`erp_stock_movements`.`reason` in ('opening_stock', 'count_correction', 'wastage', 'damage') and `erp_stock_movements`.`source_type` = 'adjustment') or (`erp_stock_movements`.`reason` in ('sale', 'purchase', 'purchase_cancellation', 'refund', 'void', 'transfer_in') and `erp_stock_movements`.`reason` = `erp_stock_movements`.`source_type`));--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD CONSTRAINT `erp_stock_movements_direction_consistent` CHECK (`erp_stock_movements`.`reason` = 'count_correction' or (`erp_stock_movements`.`reason` in ('wastage', 'damage', 'sale', 'purchase_cancellation') and `erp_stock_movements`.`quantity_delta` < 0) or (`erp_stock_movements`.`reason` in ('opening_stock', 'purchase', 'refund', 'void', 'transfer_in') and `erp_stock_movements`.`quantity_delta` > 0));--> statement-breakpoint
CREATE TRIGGER `erp_stock_transfer_lines_restrict_insert`
BEFORE INSERT ON `erp_stock_transfer_lines`
FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `erp_stock_transfers` WHERE `id` = NEW.transfer_id AND `source_branch_id` = NEW.source_branch_id) <> 'posting' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer lines may only be inserted while posting';
  END IF;
  IF (SELECT `destination_branch_id` FROM `erp_stock_transfers` WHERE `id` = NEW.transfer_id AND `source_branch_id` = NEW.source_branch_id) <> NEW.destination_branch_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer lines must move to the transfer destination branch';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_stock_transfers_restrict_update`
BEFORE UPDATE ON `erp_stock_transfers`
FOR EACH ROW
BEGIN
  IF NOT (OLD.id <=> NEW.id) OR NOT (OLD.source_branch_id <=> NEW.source_branch_id)
    OR NOT (OLD.destination_branch_id <=> NEW.destination_branch_id)
    OR NOT (OLD.invoice_id <=> NEW.invoice_id)
    OR NOT (OLD.idempotency_key <=> NEW.idempotency_key)
    OR NOT (OLD.transfer_date <=> NEW.transfer_date) OR NOT (OLD.total_cost <=> NEW.total_cost)
    OR NOT (OLD.acting_account_id <=> NEW.acting_account_id) OR NOT (OLD.note <=> NEW.note)
    OR NOT (OLD.created_at <=> NEW.created_at)
    OR NOT (OLD.status = 'posting' AND NEW.status = 'posted'
        AND NEW.invoice_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM `erp_stock_transfer_lines` WHERE `transfer_id` = OLD.id AND `source_branch_id` = OLD.source_branch_id)
        AND NEW.total_cost = (SELECT SUM(`line_total`) FROM `erp_stock_transfer_lines` WHERE `transfer_id` = OLD.id AND `source_branch_id` = OLD.source_branch_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfers are immutable except valid posting completion';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_stock_transfers_reject_delete`
BEFORE DELETE ON `erp_stock_transfers`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfers are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_stock_transfer_lines_reject_update`
BEFORE UPDATE ON `erp_stock_transfer_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer lines are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_stock_transfer_lines_reject_delete`
BEFORE DELETE ON `erp_stock_transfer_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer lines are immutable';
