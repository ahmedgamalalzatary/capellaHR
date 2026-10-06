CREATE TABLE `erp_booking_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`kind` enum('payment','refund') NOT NULL,
	`method` enum('cash','visa','instapay','vodafone_cash') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`refund_cause` enum('service_cancelled','booking_cancelled','no_show','checkout_excess'),
	`cashier_session_id` int NOT NULL,
	`acting_account_id` int NOT NULL,
	`operation_reference` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_booking_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_booking_payments_booking_reference_unique` UNIQUE(`booking_id`,`operation_reference`),
	CONSTRAINT `erp_booking_payments_amount_positive` CHECK(`erp_booking_payments`.`amount` > 0),
	CONSTRAINT `erp_booking_payments_refund_cause` CHECK((`erp_booking_payments`.`kind` = 'refund') = (`erp_booking_payments`.`refund_cause` is not null))
);
--> statement-breakpoint
ALTER TABLE `erp_bookings` DROP FOREIGN KEY `erp_bookings_acting_account_id_accounts_id_fk`;
--> statement-breakpoint
ALTER TABLE `erp_bookings` DROP FOREIGN KEY `erp_bookings_invoice_branch_fk`;
--> statement-breakpoint
ALTER TABLE `erp_bookings` DROP INDEX `erp_bookings_invoice_unique`;
--> statement-breakpoint
ALTER TABLE `report_exports` MODIFY COLUMN `report_type` enum('branches','employees','devices','shifts','weekly-day-off','attendance','payroll','bonuses','deductions','advances','erp-sales','erp-payment-methods','erp-services','erp-products','erp-employees','erp-commissions','erp-discounts','erp-refunds','erp-voids','erp-expenses','erp-purchases','erp-transfers','erp-stock','erp-profit','erp-client-history','erp-receivables','erp-service-queue','erp-service-completions','erp-consumable-usage','erp-consumable-ledger','erp-service-exceptions','erp-invoice','erp-expiry-data','erp-bookings') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `method` enum('cash','visa','instapay','vodafone_cash','booking_credit') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD `status` enum('pending','sold','cancelled') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD `invoice_id` int;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD `invoice_line_id` int;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD `changed_at` timestamp(3);
--> statement-breakpoint
-- Backfill: bookings converted under the old single-invoice model mark their sold services,
-- matching each booked service to its invoice line before the old column disappears.
UPDATE `erp_booking_services` `s`
JOIN `erp_bookings` `b` ON `b`.`id` = `s`.`booking_id` AND `b`.`branch_id` = `s`.`branch_id`
SET
	`s`.`status` = 'sold',
	`s`.`invoice_id` = `b`.`invoice_id`,
	`s`.`invoice_line_id` = (SELECT MIN(`l`.`id`) FROM `erp_invoice_lines` `l` WHERE `l`.`invoice_id` = `b`.`invoice_id` AND `l`.`service_id` = `s`.`service_id` AND `l`.`item_type` = 'service'),
	`s`.`changed_at` = (SELECT `i`.`sold_at` FROM `erp_invoices` `i` WHERE `i`.`id` = `b`.`invoice_id`)
WHERE `b`.`invoice_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `booking_id` int;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_invoice_line_unique` UNIQUE(`invoice_line_id`);--> statement-breakpoint
ALTER TABLE `erp_booking_payments` ADD CONSTRAINT `erp_booking_payments_booking_branch_fk` FOREIGN KEY (`booking_id`,`branch_id`) REFERENCES `erp_bookings`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_booking_payments` ADD CONSTRAINT `erp_booking_payments_session_branch_fk` FOREIGN KEY (`cashier_session_id`,`branch_id`) REFERENCES `erp_cashier_sessions`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_booking_payments` ADD CONSTRAINT `erp_booking_payments_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_booking_payments_session_created_idx` ON `erp_booking_payments` (`cashier_session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `erp_booking_payments_branch_created_idx` ON `erp_booking_payments` (`branch_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_sold_invoice_pair` CHECK ((`erp_booking_services`.`status` = 'sold') = (`erp_booking_services`.`invoice_id` is not null and `erp_booking_services`.`invoice_line_id` is not null));--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_booking_credit_consistent` CHECK ((`erp_invoice_payments`.`method` = 'booking_credit') = (`erp_invoice_payments`.`booking_id` is not null));--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_invoice_branch_fk` FOREIGN KEY (`invoice_id`,`branch_id`) REFERENCES `erp_invoices`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_invoice_line_fk` FOREIGN KEY (`invoice_line_id`) REFERENCES `erp_invoice_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_acting_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_booking_fk` FOREIGN KEY (`booking_id`) REFERENCES `erp_bookings`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` DROP COLUMN `invoice_id`;
