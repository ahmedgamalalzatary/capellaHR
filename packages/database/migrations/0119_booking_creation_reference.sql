ALTER TABLE `erp_bookings` ADD `creation_reference` varchar(36);--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD `creation_fingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_creation_reference_unique` UNIQUE(`creation_reference`);