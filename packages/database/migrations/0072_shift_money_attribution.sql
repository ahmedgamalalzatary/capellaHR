ALTER TABLE `erp_invoice_payments` ADD `cashier_session_id` int;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `acting_account_id` int;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `paid_at` timestamp(3) NULL;--> statement-breakpoint
UPDATE `erp_invoice_payments` `p`
  JOIN `erp_invoices` `i` ON `i`.`id` = `p`.`invoice_id`
  SET `p`.`cashier_session_id` = `i`.`cashier_session_id`,
      `p`.`acting_account_id` = `i`.`acting_account_id`,
      `p`.`paid_at` = `p`.`created_at`
  WHERE `p`.`cashier_session_id` IS NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `cashier_session_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `acting_account_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `paid_at` timestamp(3) NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD `cashier_session_id` int;--> statement-breakpoint
UPDATE `erp_invoice_reversals` `r`
  JOIN `erp_invoices` `i` ON `i`.`id` = `r`.`invoice_id`
  SET `r`.`cashier_session_id` = `i`.`cashier_session_id`
  WHERE `r`.`cashier_session_id` IS NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_session_fk` FOREIGN KEY (`cashier_session_id`) REFERENCES `erp_cashier_sessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_session_fk` FOREIGN KEY (`cashier_session_id`) REFERENCES `erp_cashier_sessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_invoice_payments_session_paid_idx` ON `erp_invoice_payments` (`cashier_session_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `erp_invoice_reversals_session_created_idx` ON `erp_invoice_reversals` (`cashier_session_id`,`created_at`);
