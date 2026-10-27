CREATE TABLE `erp_booking_operations` (
	`operation_reference` varchar(36) NOT NULL,
	`booking_id` int NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_booking_operations_operation_reference` PRIMARY KEY(`operation_reference`)
);
--> statement-breakpoint
ALTER TABLE `erp_booking_operations` ADD CONSTRAINT `erp_booking_operations_booking_id_erp_bookings_id_fk` FOREIGN KEY (`booking_id`) REFERENCES `erp_bookings`(`id`) ON DELETE no action ON UPDATE no action;