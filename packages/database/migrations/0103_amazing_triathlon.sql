CREATE TABLE `erp_invoice_global_sequence` (
	`id` int NOT NULL,
	`last_value` int NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_invoice_global_sequence_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_global_sequence_singleton` CHECK(`erp_invoice_global_sequence`.`id` = 1),
	CONSTRAINT `erp_invoice_global_sequence_value_positive` CHECK(`erp_invoice_global_sequence`.`last_value` > 0)
);
