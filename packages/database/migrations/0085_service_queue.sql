CREATE TABLE `erp_service_queue_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`invoice_line_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`cashier_session_id` int NOT NULL,
	`service_id` int NOT NULL,
	`queue_number` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_service_queue_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_service_queue_session_service_number_unique` UNIQUE(`cashier_session_id`,`service_id`,`queue_number`),
	CONSTRAINT `erp_service_queue_line_number_unique` UNIQUE(`invoice_line_id`,`queue_number`),
	CONSTRAINT `erp_service_queue_number_positive` CHECK(`erp_service_queue_entries`.`queue_number` > 0)
);
--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_line_invoice_branch_fk` FOREIGN KEY (`invoice_line_id`,`invoice_id`,`branch_id`) REFERENCES `erp_invoice_lines`(`id`,`invoice_id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_session_branch_fk` FOREIGN KEY (`cashier_session_id`,`branch_id`) REFERENCES `erp_cashier_sessions`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_queue_entries` ADD CONSTRAINT `erp_service_queue_service_branch_fk` FOREIGN KEY (`service_id`,`branch_id`) REFERENCES `erp_services`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_service_queue_session_created_idx` ON `erp_service_queue_entries` (`cashier_session_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `report_exports` MODIFY COLUMN `report_type` enum('branches','employees','devices','shifts','weekly-day-off','attendance','payroll','bonuses','deductions','advances','erp-sales','erp-payment-methods','erp-services','erp-products','erp-employees','erp-commissions','erp-discounts','erp-taxes','erp-refunds','erp-voids','erp-expenses','erp-purchases','erp-stock','erp-profit','erp-client-history','erp-receivables','erp-service-queue','erp-invoice') NOT NULL;
--> statement-breakpoint
INSERT INTO `erp_service_queue_entries` (
  `invoice_id`, `invoice_line_id`, `branch_id`, `cashier_session_id`,
  `service_id`, `queue_number`, `created_at`
)
SELECT expanded.invoice_id, expanded.invoice_line_id, expanded.branch_id,
  expanded.cashier_session_id, expanded.service_id,
  ROW_NUMBER() OVER (
    PARTITION BY expanded.cashier_session_id, expanded.service_id
    ORDER BY expanded.sold_at, expanded.invoice_id, expanded.line_number, expanded.unit_number
  ) queue_number,
  expanded.sold_at
FROM (
  SELECT invoice.id invoice_id, line.id invoice_line_id, invoice.branch_id,
    invoice.cashier_session_id, line.service_id, invoice.sold_at,
    line.line_number, unit_numbers.unit_number
  FROM `erp_invoice_lines` line
  INNER JOIN `erp_invoices` invoice
    ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
  INNER JOIN (
    WITH RECURSIVE unit_numbers AS (
      SELECT 1 unit_number
      UNION ALL
      SELECT unit_number + 1 FROM unit_numbers WHERE unit_number < 100
    )
    SELECT unit_number FROM unit_numbers
  ) unit_numbers ON line.quantity >= unit_numbers.unit_number
  WHERE line.item_type = 'service' AND invoice.status <> 'draft'
) expanded;
