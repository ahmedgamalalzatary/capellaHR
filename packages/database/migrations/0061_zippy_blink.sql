ALTER TABLE `clients` MODIFY COLUMN `full_name` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` MODIFY COLUMN `phone` varchar(11);--> statement-breakpoint
ALTER TABLE `erp_invoices` MODIFY COLUMN `client_name_snapshot` varchar(255);--> statement-breakpoint
ALTER TABLE `erp_invoices` MODIFY COLUMN `client_phone_snapshot` varchar(11);--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_identity_present` CHECK (`clients`.`full_name` is not null or `clients`.`phone` is not null);