ALTER TABLE `erp_invoice_reversal_payments` DROP FOREIGN KEY `erp_reversal_payments_reversal_fk`;
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` DROP FOREIGN KEY `erp_reversal_payments_payment_fk`;
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` DROP FOREIGN KEY `erp_invoice_reversals_session_fk`;
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD `invoice_id` int;--> statement-breakpoint
UPDATE `erp_invoice_reversal_payments` `rp`
  JOIN `erp_invoice_reversals` `r` ON `r`.`id` = `rp`.`reversal_id`
  SET `rp`.`invoice_id` = `r`.`invoice_id`
  WHERE `rp`.`invoice_id` IS NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` MODIFY COLUMN `invoice_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_id_invoice_unique` UNIQUE(`id`,`invoice_id`);--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_id_invoice_unique` UNIQUE(`id`,`invoice_id`);--> statement-breakpoint
ALTER TABLE `employee_terminations` ADD CONSTRAINT `employee_terminations_shortfall_single_outcome` CHECK (`employee_terminations`.`cash_collected_amount` = 0 or `employee_terminations`.`debt_recorded_amount` = 0);--> statement-breakpoint
ALTER TABLE `employee_terminations` ADD CONSTRAINT `employee_terminations_statement_reconciles` CHECK (`employee_terminations`.`net_salary_before_settlement` - `employee_terminations`.`advances_recovered` + `employee_terminations`.`write_off_amount`
      - `employee_terminations`.`forfeited_salary_amount` + `employee_terminations`.`cash_collected_amount` = `employee_terminations`.`final_net_salary`);--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD CONSTRAINT `erp_reversal_payments_reversal_invoice_fk` FOREIGN KEY (`reversal_id`,`invoice_id`) REFERENCES `erp_invoice_reversals`(`id`,`invoice_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD CONSTRAINT `erp_reversal_payments_payment_invoice_fk` FOREIGN KEY (`invoice_payment_id`,`invoice_id`) REFERENCES `erp_invoice_payments`(`id`,`invoice_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_session_branch_fk` FOREIGN KEY (`cashier_session_id`,`branch_id`) REFERENCES `erp_cashier_sessions`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;
