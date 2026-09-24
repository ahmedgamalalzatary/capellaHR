CREATE TABLE `erp_service_queue_reassignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_queue_entry_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`from_employee_id` int NOT NULL,
	`to_employee_id` int NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`operation_reference` varchar(36) NOT NULL,
	`acting_account_id` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_service_queue_reassignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_service_queue_reassignments_operation_unique` UNIQUE(`operation_reference`),
	CONSTRAINT `erp_service_queue_reassignments_employee_changed` CHECK(`erp_service_queue_reassignments`.`from_employee_id` <> `erp_service_queue_reassignments`.`to_employee_id`),
	CONSTRAINT `erp_service_queue_reassignments_reason_required` CHECK(CHAR_LENGTH(TRIM(`erp_service_queue_reassignments`.`reason`)) > 0)
);
--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` DROP CONSTRAINT `erp_commission_ledger_entry_consistent`;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD `service_queue_entry_id` int;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD `service_queue_reassignment_id` int;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD `employee_id` int;--> statement-breakpoint
UPDATE `erp_service_queue_entries` queue
INNER JOIN `erp_invoice_lines` line ON line.id = queue.invoice_line_id
SET queue.employee_id = COALESCE((
  SELECT reassignment.to_employee_id
  FROM `erp_invoice_line_reassignments` reassignment
  WHERE reassignment.invoice_line_id = line.id
  ORDER BY reassignment.created_at DESC, reassignment.id DESC
  LIMIT 1
), line.employee_id);--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` MODIFY `employee_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_service_queue_reassignments` ADD CONSTRAINT `erp_service_queue_reassignments_entry_fk` FOREIGN KEY (`service_queue_entry_id`) REFERENCES `erp_service_queue_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_reassignments` ADD CONSTRAINT `erp_service_queue_reassignments_from_employee_branch_fk` FOREIGN KEY (`from_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_reassignments` ADD CONSTRAINT `erp_service_queue_reassignments_to_employee_branch_fk` FOREIGN KEY (`to_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_reassignments` ADD CONSTRAINT `erp_service_queue_reassignments_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_service_queue_reassignments_entry_created_idx` ON `erp_service_queue_reassignments` (`service_queue_entry_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_entry_consistent` CHECK ((entry_type = 'earned' and reverses_entry_id is null and invoice_reversal_id is null and invoice_line_reassignment_id is null and service_queue_reassignment_id is null) or (entry_type = 'reversal' and reverses_entry_id is not null and invoice_reversal_id is not null and invoice_line_reassignment_id is null and service_queue_reassignment_id is null) or (entry_type in ('reassignment_out', 'reassignment_in') and reverses_entry_id is null and invoice_reversal_id is null and ((invoice_line_reassignment_id is not null and service_queue_reassignment_id is null) or (invoice_line_reassignment_id is null and service_queue_reassignment_id is not null))));--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_queue_entry_fk` FOREIGN KEY (`service_queue_entry_id`) REFERENCES `erp_service_queue_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_queue_reassignment_fk` FOREIGN KEY (`service_queue_reassignment_id`) REFERENCES `erp_service_queue_reassignments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_employee_branch_fk` FOREIGN KEY (`employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;
