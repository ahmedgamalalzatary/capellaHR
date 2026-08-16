ALTER TABLE `clients` MODIFY COLUMN `full_name` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` MODIFY COLUMN `phone` varchar(11);--> statement-breakpoint
ALTER TABLE `erp_invoices` MODIFY COLUMN `client_name_snapshot` varchar(255);--> statement-breakpoint
ALTER TABLE `erp_invoices` MODIFY COLUMN `client_phone_snapshot` varchar(11);--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_identity_present` CHECK (`clients`.`full_name` is not null or `clients`.`phone` is not null);--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_client_identity_present` CHECK (`erp_invoices`.`client_name_snapshot` is not null or `erp_invoices`.`client_phone_snapshot` is not null);