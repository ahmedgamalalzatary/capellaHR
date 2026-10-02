CREATE TABLE `erp_stock_batch_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`product_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`consumable_quantity` decimal(16,3) NOT NULL DEFAULT '0.000',
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_stock_batch_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_stock_batch_balances_lot_product_unique` UNIQUE(`batch_id`,`product_id`,`branch_id`),
	CONSTRAINT `erp_stock_batch_balances_nonnegative` CHECK(`erp_stock_batch_balances`.`quantity` >= 0 and `erp_stock_batch_balances`.`consumable_quantity` >= 0)
);
--> statement-breakpoint
CREATE TABLE `erp_stock_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`origin_product_id` int NOT NULL,
	`origin_branch_id` int NOT NULL,
	`expiry_date` date,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_stock_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `erp_purchase_lines` DROP INDEX `erp_purchase_lines_purchase_product_unique`;--> statement-breakpoint
ALTER TABLE `report_exports` MODIFY COLUMN `report_type` enum('branches','employees','devices','shifts','weekly-day-off','attendance','payroll','bonuses','deductions','advances','erp-sales','erp-payment-methods','erp-services','erp-products','erp-employees','erp-commissions','erp-discounts','erp-refunds','erp-voids','erp-expenses','erp-purchases','erp-transfers','erp-stock','erp-profit','erp-client-history','erp-receivables','erp-service-queue','erp-service-completions','erp-consumable-usage','erp-consumable-ledger','erp-service-exceptions','erp-invoice','erp-expiry-data') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD `batches` json;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_lines` ADD `batches` json;--> statement-breakpoint
ALTER TABLE `erp_consumable_ledger_entries` ADD `batches` json;--> statement-breakpoint
ALTER TABLE `erp_stock_movements` ADD `batches` json;--> statement-breakpoint
ALTER TABLE `erp_purchase_lines` ADD `batch_id` int;--> statement-breakpoint
ALTER TABLE `erp_purchase_lines` ADD `expiry_date` date;--> statement-breakpoint
ALTER TABLE `erp_stock_transfer_lines` ADD `batches` json;--> statement-breakpoint
ALTER TABLE `erp_stock_batch_balances` ADD CONSTRAINT `erp_stock_batch_balances_batch_id_erp_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `erp_stock_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_batch_balances` ADD CONSTRAINT `erp_stock_batch_balances_product_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_stock_batches` ADD CONSTRAINT `erp_stock_batches_origin_fk` FOREIGN KEY (`origin_product_id`,`origin_branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_stock_batch_balances_branch_product_idx` ON `erp_stock_batch_balances` (`branch_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `erp_stock_batches_expiry_idx` ON `erp_stock_batches` (`expiry_date`);--> statement-breakpoint
ALTER TABLE `erp_purchase_lines` ADD CONSTRAINT `erp_purchase_lines_batch_id_erp_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `erp_stock_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_purchase_lines_purchase_product_idx` ON `erp_purchase_lines` (`purchase_id`,`product_id`);
--> statement-breakpoint
-- Existing balances receive an unknown-expiry batch; historical documents stay unchanged.
INSERT INTO erp_stock_batches (id, origin_product_id, origin_branch_id, expiry_date, created_at, updated_at)
SELECT id, id, branch_id, NULL, created_at, updated_at FROM erp_products;
--> statement-breakpoint
INSERT INTO erp_stock_batch_balances (batch_id, product_id, branch_id, quantity, consumable_quantity, updated_at)
SELECT product.id, product.id, product.branch_id, COALESCE(stock.quantity, 0), COALESCE(consumable.quantity, 0), product.updated_at
FROM erp_products product
LEFT JOIN erp_product_stocks stock ON stock.product_id = product.id AND stock.branch_id = product.branch_id
LEFT JOIN erp_consumable_balances consumable ON consumable.product_id = product.id AND consumable.branch_id = product.branch_id;
--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD `requested_batches` json;
--> statement-breakpoint
CREATE TRIGGER erp_invoice_lines_guard_batch_snapshot
BEFORE UPDATE ON erp_invoice_lines FOR EACH ROW
BEGIN
  IF NOT (CAST(OLD.batches AS CHAR) <=> CAST(NEW.batches AS CHAR))
    OR NOT (CAST(OLD.requested_batches AS CHAR) <=> CAST(NEW.requested_batches AS CHAR)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice batch snapshots are immutable';
  END IF;
END;
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_lines` ADD `requested_batches` json;
--> statement-breakpoint
ALTER TABLE `erp_stock_batches` ADD `is_legacy` boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE erp_stock_batches SET is_legacy = true WHERE expiry_date IS NULL;
